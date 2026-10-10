-- Wochenplanung: Planungsregeln (Prüfregeln), Fingerabdruck, atomares und idempotentes Speichern
-- eines geprüften Vorschlags (manuelle Einzeltermine bleiben), geprüftes, idempotentes
-- Veröffentlichen und Verwerfen. Alle Daten frei erfunden (Beispiel).
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
        'authenticated', 'authenticated', 'planer@tagestakt.test', '', now(), now()),
       ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
        'authenticated', 'authenticated', 'fremd@tagestakt.test', '', now(), now());

-- Veröffentlichte Version 1 der Woche 12.10.2026 mit einem Eintrag (als Tabelleneigentümer).
insert into public.schedule_weeks (id, owner_id, week_start, version, status)
values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', '33333333-3333-4333-8333-333333333333',
        '2026-10-12', 1, 'draft');
insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
values ('33333333-3333-4333-8333-333333333333', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
        'Bisheriger Block (Beispiel)', 'business', '2026-10-12 18:00+02', '2026-10-12 20:00+02');
update public.schedule_weeks set status = 'published' where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

-- -----------------------------------------------------------------------------
-- 1. Planungsregeln: Prüfregeln der Tabellen
-- -----------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.planning_preferences (business_earliest_start, business_latest_end,
       business_min_block_minutes, business_max_block_minutes, business_max_daily_minutes,
       business_saturday_max_minutes, business_sunday_max_minutes, buffer_minutes)
     values ('08:00', '21:30', 60, 180, 300, 120, 0, 15) $$,
  'Planungsregeln anlegen (owner_id per Standardwert)');
select throws_ok(
  $$ update public.planning_preferences set business_latest_end = '07:00' $$,
  '23514', null, 'Gewerbe-Rahmen: Ende muss nach dem Beginn liegen');
select throws_ok(
  $$ update public.planning_preferences set business_max_block_minutes = 30 $$,
  '23514', null, 'Höchstdauer eines Blocks nicht unter der Mindestdauer');
select throws_ok(
  $$ update public.planning_preferences set business_saturday_max_minutes = 30 $$,
  '23514', null, 'Wochenende: 0 oder mindestens eine Blocklänge');
select throws_ok(
  $$ update public.planning_preferences set buffer_minutes = 200 $$,
  '23514', null, 'Pause höchstens 120 Minuten');
select lives_ok(
  $$ insert into public.planning_goal_slots (goal_category, weekday, requirement, title,
       duration_minutes, window_start, window_end)
     values ('sport', 1, 'required', 'Training (Beispiel)', 90, '17:00', '20:00'),
            ('relationship', 5, 'required', 'Zeit zu zweit (Beispiel)', 180, '12:30', '22:00') $$,
  'Zeitfenster für Sport und Beziehung anlegen');
select throws_ok(
  $$ insert into public.planning_goal_slots (goal_category, weekday, requirement, title,
       duration_minutes, window_start, window_end)
     values ('sport', 1, 'optional', 'Zweites Training (Beispiel)', 60, '06:00', '07:00') $$,
  '23505', null, 'höchstens ein Zeitfenster je Ziel und Wochentag');
select throws_ok(
  $$ insert into public.planning_goal_slots (goal_category, weekday, requirement, title,
       duration_minutes, window_start, window_end)
     values ('sport', 2, 'required', 'Zu kurz (Beispiel)', 120, '17:00', '18:00') $$,
  '23514', null, 'Zeitfenster muss die Dauer fassen');
select throws_ok(
  $$ insert into public.planning_goal_slots (goal_category, weekday, requirement, title,
       duration_minutes, window_start, window_end)
     values ('business', 3, 'required', 'Gewerbe (Beispiel)', 60, '17:00', '19:00') $$,
  '23514', null, 'Zeitfenster nur für Sport und Beziehung');
select throws_ok(
  $$ insert into public.planning_goal_slots (goal_category, weekday, requirement, title,
       duration_minutes, window_start, window_end)
     values ('sport', 4, 'immer', 'Unbekannt (Beispiel)', 60, '17:00', '19:00') $$,
  '23514', null, 'Verbindlichkeit nur required oder optional');

-- -----------------------------------------------------------------------------
-- 2. Fingerabdruck
-- -----------------------------------------------------------------------------
select matches(
  public.schedule_week_fingerprint('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  '^[0-9a-f]{64}$',
  'Fingerabdruck ist eine SHA-256-Prüfsumme');
select is(
  public.schedule_week_fingerprint('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  public.schedule_week_fingerprint('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'Fingerabdruck ist stabil');
select throws_ok(
  $$ select public.schedule_week_fingerprint('99999999-9999-4999-8999-999999999999') $$,
  'P0002', null, 'unbekannte Woche: kein Fingerabdruck');

-- -----------------------------------------------------------------------------
-- 3. Erzeugten Vorschlag speichern
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ select public.save_generated_schedule_draft('2026-10-13', null, null,
       '[{"title":"x","category":"business","start_at":"2026-10-13T07:00:00Z","end_at":"2026-10-13T08:00:00Z","source":"agent"}]') $$,
  '22023', null, 'Wochenbeginn muss ein Montag sein');
select throws_ok(
  $$ select public.save_generated_schedule_draft('2026-10-12', null, null, '[]') $$,
  '22023', null, 'leerer Vorschlag wird abgelehnt');
select throws_ok(
  $$ select public.save_generated_schedule_draft('2026-10-12', null, null,
       '[{"title":"x","category":"business","start_at":"2026-10-13T07:00:00Z","end_at":"2026-10-13T08:00:00Z","source":"manual"}]') $$,
  '22023', null, 'nur Herkunft recurring/agent erlaubt');
select throws_ok(
  $$ select public.save_generated_schedule_draft('2026-10-12', null, null,
       '[{"title":"x","category":"business","start_at":"2026-10-20T07:00:00Z","end_at":"2026-10-20T08:00:00Z","source":"agent"}]') $$,
  '23514', null, 'Eintrag außerhalb der Woche wird von den Planregeln abgewiesen');
select is(
  (select count(*)::int from public.schedule_weeks where week_start = '2026-10-12'),
  1,
  'nach einem Fehler entsteht keine Teilversion');

select is(
  (public.save_generated_schedule_draft('2026-10-12', null, null,
     '[{"title":"Dienst (Beispiel)","category":"duty","start_at":"2026-10-13T05:00:00Z","end_at":"2026-10-13T14:30:00Z","source":"recurring"},
       {"title":"Gewerbe-Fokus (Beispiel)","category":"business","start_at":"2026-10-13T15:00:00Z","end_at":"2026-10-13T17:00:00Z","source":"agent","note":"Begründung (Beispiel)"}]',
     'Mit Claude geplant (Beispiel)')).version,
  2,
  'neuer Entwurf als nächste Version');
select results_eq(
  $$ select status, planning_note from public.schedule_weeks where week_start = '2026-10-12' order by version $$,
  $$ values ('published'::text, null::text), ('draft', 'Mit Claude geplant (Beispiel)') $$,
  'veröffentlichte Version bleibt bestehen, Entwurf trägt den Planungshinweis');
select is(
  (select count(*)::int from public.schedule_entries e join public.schedule_weeks w on w.id = e.schedule_week_id
    where w.status = 'draft'),
  3,
  'Entwurf: Vorschlag ersetzt geplante Einträge, Einzeltermin der Kopie bleibt');
select is(
  (select string_agg(e.title, ',') from public.schedule_entries e
     join public.schedule_weeks w on w.id = e.schedule_week_id
    where w.status = 'draft' and e.source = 'manual'),
  'Bisheriger Block (Beispiel)',
  'manueller Einzeltermin bleibt im Entwurf unverändert erhalten');
select is(
  (select title from public.schedule_entries where schedule_week_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  'Bisheriger Block (Beispiel)',
  'der veröffentlichte Plan bleibt unverändert');
select throws_ok(
  $$ select public.save_generated_schedule_draft('2026-10-12', null, null,
       '[{"title":"x","category":"business","start_at":"2026-10-14T07:00:00Z","end_at":"2026-10-14T08:00:00Z","source":"agent"}]') $$,
  'TT008', null, 'inzwischen entstandener Entwurf wird nicht überschrieben');

create temporary table planer_stand on commit drop as
  select id, public.schedule_week_fingerprint(id) as fingerprint
    from public.schedule_weeks where week_start = '2026-10-12' and status = 'draft';

select throws_ok(
  $$ select public.save_generated_schedule_draft('2026-10-12',
       (select id from planer_stand), repeat('0', 64),
       '[{"title":"x","category":"business","start_at":"2026-10-14T07:00:00Z","end_at":"2026-10-14T08:00:00Z","source":"agent"}]') $$,
  'TT008', null, 'veralteter Fingerabdruck: nichts wird ersetzt');
select is(
  (select (public.save_generated_schedule_draft('2026-10-12', id, fingerprint,
     '[{"title":"Neu geplant (Beispiel)","category":"business","start_at":"2026-10-14T07:00:00Z","end_at":"2026-10-14T09:00:00Z","source":"agent"}]')).version
     from planer_stand),
  2,
  'Neu planen ersetzt den eigenen, unveränderten Entwurf (gleiche Version)');
select is(
  (select string_agg(title, ',' order by title) from public.schedule_entries e
     join public.schedule_weeks w on w.id = e.schedule_week_id where w.status = 'draft'),
  'Bisheriger Block (Beispiel),Neu geplant (Beispiel)',
  'Entwurf: neuer Vorschlag und unveränderter Einzeltermin');

create temporary table nach_speichern on commit drop as
  select id, public.schedule_week_fingerprint(id) as fingerprint
    from public.schedule_weeks where week_start = '2026-10-12' and status = 'draft';
select is(
  (select (public.save_generated_schedule_draft('2026-10-12', id, fingerprint,
     '[{"title":"Neu geplant (Beispiel)","category":"business","start_at":"2026-10-14T07:00:00Z","end_at":"2026-10-14T09:00:00Z","source":"agent"}]')).id
     from planer_stand),
  (select id from nach_speichern),
  'Wiederholung desselben Vorschlags mit veraltetem Stand: Entwurf unverändert zurück');
select is(
  (select public.schedule_week_fingerprint(id) from nach_speichern),
  (select fingerprint from nach_speichern),
  'idempotent: Fingerabdruck nach der Wiederholung unverändert');

-- -----------------------------------------------------------------------------
-- 4. Geprüft veröffentlichen
-- -----------------------------------------------------------------------------
create temporary table geprueft on commit drop as
  select id, public.schedule_week_fingerprint(id) as fingerprint
    from public.schedule_weeks where week_start = '2026-10-12' and status = 'draft';

select throws_ok(
  $$ select public.publish_reviewed_schedule_week((select id from geprueft), 'kein-fingerabdruck') $$,
  '22023', null, 'ungültiger Prüfstand wird abgelehnt');
select throws_ok(
  $$ select public.publish_reviewed_schedule_week((select id from geprueft), repeat('0', 64)) $$,
  'TT008', null, 'geänderter Stand wird nicht veröffentlicht');

update public.schedule_entries set title = 'Nachträglich geändert (Beispiel)'
 where schedule_week_id = (select id from geprueft);
select throws_ok(
  $$ select public.publish_reviewed_schedule_week((select id from geprueft), (select fingerprint from geprueft)) $$,
  'TT008', null, 'Änderung nach der Prüfung verhindert das Veröffentlichen');
select is(
  (select status from public.schedule_weeks where id = (select id from geprueft)),
  'draft',
  'ungeprüfter Stand bleibt Entwurf');

update geprueft set fingerprint = public.schedule_week_fingerprint(id);
select is(
  (select (public.publish_reviewed_schedule_week(id, fingerprint)).status from geprueft),
  'published',
  'geprüfter Stand wird veröffentlicht');
select results_eq(
  $$ select version, status from public.schedule_weeks where week_start = '2026-10-12' order by version $$,
  $$ values (1, 'archived'::text), (2, 'published') $$,
  'bisherige Veröffentlichung archiviert, neue veröffentlicht');
select is(
  (select (public.publish_reviewed_schedule_week(id, fingerprint)).status from geprueft),
  'published',
  'doppelter Klick: derselbe Stand bleibt veröffentlicht (idempotent)');
select is(
  (select count(*)::int from public.schedule_weeks where week_start = '2026-10-12' and status = 'published'),
  1,
  'genau eine veröffentlichte Version');
select throws_ok(
  $$ select public.publish_reviewed_schedule_week('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
       public.schedule_week_fingerprint('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1')) $$,
  'P0001', null, 'archivierte Versionen können nicht erneut veröffentlicht werden');

-- -----------------------------------------------------------------------------
-- 5. Eigenen Entwurf verwerfen
-- -----------------------------------------------------------------------------
select is(
  (public.save_generated_schedule_draft('2026-10-19', null, null,
     '[{"title":"Gewerbe (Beispiel)","category":"business","start_at":"2026-10-19T15:00:00Z","end_at":"2026-10-19T17:00:00Z","source":"agent"}]')).status,
  'draft',
  'Entwurf für die Folgewoche');
create temporary table verwerfen on commit drop as
  select id, public.schedule_week_fingerprint(id) as fingerprint
    from public.schedule_weeks where week_start = '2026-10-19';

select throws_ok(
  $$ select public.discard_reviewed_schedule_draft((select id from verwerfen), 'kein-fingerabdruck') $$,
  '22023', null, 'Verwerfen: ungültiger Prüfstand wird abgelehnt');
select throws_ok(
  $$ select public.discard_reviewed_schedule_draft((select id from verwerfen), repeat('0', 64)) $$,
  'TT008', null, 'Verwerfen nur im gesehenen Stand');
select throws_ok(
  $$ select public.discard_reviewed_schedule_draft((select id from geprueft), (select fingerprint from geprueft)) $$,
  'P0001', null, 'veröffentlichte Versionen können nicht verworfen werden');

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select throws_ok(
  $$ select public.discard_reviewed_schedule_draft((select id from verwerfen), (select fingerprint from verwerfen)) $$,
  'P0002', null, 'fremder Entwurf: nicht gefunden (Verwerfen)');
select throws_ok(
  $$ select public.publish_reviewed_schedule_week((select id from verwerfen), (select fingerprint from verwerfen)) $$,
  'P0002', null, 'fremder Entwurf: nicht gefunden (Veröffentlichen)');
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select ok(
  (select public.discard_reviewed_schedule_draft(id, fingerprint) from verwerfen),
  'eigener, unveränderter Entwurf wird verworfen');
select is(
  (select count(*)::int from public.schedule_weeks where week_start = '2026-10-19'),
  0,
  'verworfener Entwurf ist samt Einträgen entfernt');

select * from finish();
rollback;

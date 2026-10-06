-- Negative und positive Zugriffstests:
--   * anonymer Zugriff wird abgewiesen
--   * ein anderer angemeldeter Benutzer kann fremde Daten weder lesen noch verändern
--   * der Eigentümer kann seine eigenen Daten bearbeiten
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- -----------------------------------------------------------------------------
-- Testdaten (als postgres; Tabelleneigentümer umgeht RLS)
-- -----------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'eigentuemer@tagestakt.test', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'fremd@tagestakt.test', '', now(), now());

insert into public.user_settings (owner_id) values ('11111111-1111-4111-8111-111111111111');

insert into public.recurring_commitments (id, owner_id, title, category, weekday, start_time, end_time)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
        'Beispiel', 'duty', 1, '08:00', '16:00');

insert into public.schedule_weeks (id, owner_id, week_start)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', '2026-10-05');

insert into public.schedule_entries (id, owner_id, schedule_week_id, title, category, start_at, end_at)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Beispiel', 'business',
        '2026-10-05 09:00+02', '2026-10-05 12:00+02');

-- -----------------------------------------------------------------------------
-- 1. Anonym
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select * from public.user_settings $$, '42501', null,
  'anon: kein Lesezugriff auf user_settings');
select throws_ok($$ select * from public.recurring_commitments $$, '42501', null,
  'anon: kein Lesezugriff auf recurring_commitments');
select throws_ok($$ select * from public.schedule_weeks $$, '42501', null,
  'anon: kein Lesezugriff auf schedule_weeks');
select throws_ok($$ select * from public.schedule_entries $$, '42501', null,
  'anon: kein Lesezugriff auf schedule_entries');
select throws_ok(
  $$ insert into public.schedule_weeks (owner_id, week_start)
     values ('11111111-1111-4111-8111-111111111111', '2026-10-12') $$,
  '42501', null, 'anon: kann keine Wochenpläne anlegen');
select throws_ok(
  $$ update public.schedule_entries set title = 'x' where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  '42501', null, 'anon: kann keine Einträge ändern');
select throws_ok(
  $$ delete from public.recurring_commitments $$,
  '42501', null, 'anon: kann keine Wiederholungen löschen');
select throws_ok(
  $$ select public.publish_schedule_week('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  '42501', null, 'anon: kann keine Wochenpläne veröffentlichen');
select throws_ok(
  $$ select public.create_schedule_draft('2026-10-12') $$,
  '42501', null, 'anon: kann keine Entwürfe anlegen');

reset role;

-- -----------------------------------------------------------------------------
-- 2. Anderer angemeldeter Benutzer
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

select is_empty($$ select * from public.user_settings $$,
  'fremd: sieht keine fremden Einstellungen');
select is_empty($$ select * from public.recurring_commitments $$,
  'fremd: sieht keine fremden Wiederholungen');
select is_empty($$ select * from public.schedule_weeks $$,
  'fremd: sieht keine fremden Wochenpläne');
select is_empty($$ select * from public.schedule_entries $$,
  'fremd: sieht keine fremden Einträge');

select is_empty(
  $$ update public.schedule_entries set title = 'Übernommen'
      where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' returning id $$,
  'fremd: kann fremde Einträge nicht ändern');
select is_empty(
  $$ delete from public.schedule_entries
      where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' returning id $$,
  'fremd: kann fremde Einträge nicht löschen');
select is_empty(
  $$ update public.schedule_weeks set planning_note = 'x'
      where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning id $$,
  'fremd: kann fremde Wochenpläne nicht ändern');
select is_empty(
  $$ delete from public.schedule_weeks returning id $$,
  'fremd: kann fremde Wochenpläne nicht löschen');
select is_empty(
  $$ update public.recurring_commitments set active = false returning id $$,
  'fremd: kann fremde Wiederholungen nicht ändern');
select is_empty(
  $$ update public.user_settings set weekly_business_target_minutes = 0 returning owner_id $$,
  'fremd: kann fremde Einstellungen nicht ändern');

select throws_ok(
  $$ insert into public.schedule_weeks (owner_id, week_start)
     values ('11111111-1111-4111-8111-111111111111', '2026-10-12') $$,
  '42501', null, 'fremd: kann keine Wochenpläne im Namen eines anderen anlegen');
select throws_ok(
  $$ insert into public.recurring_commitments (owner_id, title, category, weekday, start_time, end_time)
     values ('11111111-1111-4111-8111-111111111111', 'x', 'other', 1, '08:00', '09:00') $$,
  '42501', null, 'fremd: kann keine Wiederholungen im Namen eines anderen anlegen');
select throws_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
             'x', 'other', '2026-10-06 09:00+02', '2026-10-06 10:00+02') $$,
  '23503', null, 'fremd: kann keinen Eintrag in einen fremden Wochenplan schmuggeln');
select throws_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
             'x', 'other', '2026-10-06 09:00+02', '2026-10-06 10:00+02') $$,
  null, null, 'fremd: kann keinen Eintrag mit fremder owner_id anlegen');
select throws_ok(
  $$ select public.publish_schedule_week('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  'P0002', null, 'fremd: kann fremde Wochenpläne nicht veröffentlichen');
select throws_ok(
  $$ select public.add_schedule_entries('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       '[{"title":"x","category":"other","start_at":"2026-10-06T07:00:00Z","end_at":"2026-10-06T08:00:00Z"}]') $$,
  'P0002', null, 'fremd: kann keine Einträge per RPC in fremde Pläne schreiben');

-- Eigene Daten anlegen funktioniert; owner_id kann nicht auf einen anderen umgeschrieben werden
select lives_ok(
  $$ insert into public.user_settings default values $$,
  'fremd: darf eigene Einstellungen anlegen (owner_id = auth.uid())');
select throws_ok(
  $$ update public.user_settings set owner_id = '11111111-1111-4111-8111-111111111111' $$,
  null, null, 'fremd: kann eigene Zeilen nicht einem anderen Benutzer zuschieben');

reset role;

select is(
  (select title from public.schedule_entries where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'Beispiel',
  'Eintrag des Eigentümers ist nach den Angriffen unverändert'
);
select is(
  (select weekly_business_target_minutes from public.user_settings
    where owner_id = '11111111-1111-4111-8111-111111111111'),
  1200,
  'Einstellungen des Eigentümers sind unverändert (Standardziel 1200 Minuten)'
);

-- -----------------------------------------------------------------------------
-- 3. Eigentümer
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select is((select count(*)::int from public.schedule_entries), 1,
  'Eigentümer: sieht seine Einträge');
select is((select count(*)::int from public.schedule_weeks), 1,
  'Eigentümer: sieht seine Wochenpläne');

select lives_ok(
  $$ update public.schedule_entries set title = 'Geändert'
      where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  'Eigentümer: kann Einträge im Entwurf ändern');
select lives_ok(
  $$ insert into public.schedule_entries (schedule_week_id, title, category, start_at, end_at)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Neu', 'sport',
             '2026-10-06 18:00+02', '2026-10-06 19:00+02') $$,
  'Eigentümer: kann Einträge anlegen (owner_id per Standardwert)');
select is(
  public.add_schedule_entries('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '[{"title":"Per RPC","category":"meal","start_at":"2026-10-07T10:00:00Z","end_at":"2026-10-07T10:30:00Z","source":"recurring"}]'),
  1,
  'Eigentümer: kann Einträge per RPC hinzufügen');
select lives_ok(
  $$ update public.recurring_commitments set active = false $$,
  'Eigentümer: kann Wiederholungen deaktivieren');
select lives_ok(
  $$ update public.user_settings set weekly_business_target_minutes = 900 $$,
  'Eigentümer: kann sein Wochenziel ändern');

select is(
  (public.publish_schedule_week('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).status,
  'published',
  'Eigentümer: kann seinen Entwurf veröffentlichen');

select throws_ok(
  $$ update public.schedule_entries set title = 'Nachträglich'
      where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  '23514', null, 'veröffentlichte Einträge sind inhaltlich schreibgeschützt');
select lives_ok(
  $$ update public.schedule_entries set completion_status = 'completed'
      where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  'Erledigt-Status ist auch im veröffentlichten Plan änderbar');
select throws_ok(
  $$ delete from public.schedule_entries where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  '23514', null, 'Einträge veröffentlichter Pläne können nicht gelöscht werden');
select throws_ok(
  $$ delete from public.schedule_weeks where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $$,
  '23514', null, 'veröffentlichte Wochenpläne können nicht gelöscht werden');

select isnt_empty(
  $$ delete from public.recurring_commitments returning id $$,
  'Eigentümer: kann seine Wiederholungen löschen');

select * from finish();
rollback;

-- Fokus-Erfassung: Starten, Beenden, Korrigieren, Überschneidungen, Bezug zu Planblöcken,
-- Zielfelder in user_settings.
begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- -----------------------------------------------------------------------------
-- Testdaten (als postgres)
-- -----------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
        'authenticated', 'authenticated', 'fokus@tagestakt.test', '', now(), now());

insert into public.user_settings (owner_id) values ('44444444-4444-4444-8444-444444444444');

-- Aktuelle Woche (veröffentlicht) mit einem Gewerbe- und einem Sportblock,
-- nächste Woche als Entwurf mit einem Gewerbeblock.
insert into public.schedule_weeks (id, owner_id, week_start)
values
  ('eeeeeeee-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444',
   date_trunc('week', now() at time zone 'Europe/Berlin')::date),
  ('eeeeeeee-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444',
   date_trunc('week', now() at time zone 'Europe/Berlin')::date + 7);

insert into public.schedule_entries (id, owner_id, schedule_week_id, title, category, start_at, end_at)
select v.id::uuid, '44444444-4444-4444-8444-444444444444', v.week::uuid, v.title, v.category,
       ((date_trunc('week', now() at time zone 'Europe/Berlin')::date + v.day_offset) + time '09:00')
         at time zone 'Europe/Berlin',
       ((date_trunc('week', now() at time zone 'Europe/Berlin')::date + v.day_offset) + time '11:00')
         at time zone 'Europe/Berlin'
  from (values
    ('eeeeeeee-1111-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',
     'Kundenprojekt (Beispiel)', 'business', 0),
    ('eeeeeeee-1111-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001',
     'Krafttraining (Beispiel)', 'sport', 1),
    ('eeeeeeee-1111-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000002',
     'Entwurfsblock (Beispiel)', 'business', 7)
  ) as v(id, week, title, category, day_offset);

update public.schedule_weeks set status = 'published'
 where id = 'eeeeeeee-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------------
-- Als Eigentümer
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

-- Starten und Beenden (Serverzeit)
select is((public.start_activity_session('business')).title, 'Aktivität',
  'Start ohne Titel und ohne Planblock erhält einen neutralen Titel');
select throws_ok($$ select public.start_activity_session('sport') $$,
  'TT001', null, 'zweiter Start wird abgewiesen, solange eine Aktivität läuft');
select isnt((public.stop_activity_session()).ended_at, null,
  'Beenden setzt das Ende');
select is(
  (select corrected_at from public.activity_sessions where title = 'Aktivität'), null,
  'normales Starten/Beenden gilt nicht als Korrektur');
select throws_ok($$ select public.stop_activity_session() $$,
  'TT002', null, 'Beenden ohne laufende Aktivität wird abgewiesen');

-- Korrigieren
select lives_ok(
  $$ select public.correct_activity_session(
       (select id from public.activity_sessions where title = 'Aktivität'),
       now() - interval '10 hours', now() - interval '9 hours') $$,
  'eigene Aktivität lässt sich korrigieren');
select isnt(
  (select corrected_at from public.activity_sessions where title = 'Aktivität'), null,
  'korrigierte Aktivität ist gekennzeichnet');

-- Start mit Planblock übernimmt dessen Titel
select is(
  (public.start_activity_session('business', null, 'eeeeeeee-1111-4000-8000-000000000001')).title,
  'Kundenprojekt (Beispiel)',
  'Start zu einem veröffentlichten Planblock übernimmt dessen Titel');
select lives_ok($$ select public.stop_activity_session() $$,
  'Aktivität mit Planblock lässt sich beenden');
select lives_ok(
  $$ select public.correct_activity_session(
       (select id from public.activity_sessions where title = 'Kundenprojekt (Beispiel)'),
       now() - interval '8 hours', now() - interval '7 hours') $$,
  'Aktivität mit Planblock lässt sich korrigieren');

-- Nachtragen: corrected_at lässt sich nicht fälschen, Titel wird getrimmt
insert into public.activity_sessions (id, goal_category, title, started_at, ended_at, corrected_at)
values ('ffffffff-0000-4000-8000-000000000001', 'sport', '  Laufen (Beispiel)  ',
        now() - interval '6 hours', now() - interval '5 hours', null);
select isnt(
  (select corrected_at from public.activity_sessions where id = 'ffffffff-0000-4000-8000-000000000001'),
  null, 'nachgetragene Aktivität wird als korrigiert gekennzeichnet');
select is(
  (select title from public.activity_sessions where id = 'ffffffff-0000-4000-8000-000000000001'),
  'Laufen (Beispiel)', 'Titel wird getrimmt');

-- Überschneidungen und ungültige Zeiten
select throws_ok(
  $$ insert into public.activity_sessions (goal_category, title, started_at, ended_at)
     values ('business', 'x', now() - interval '330 minutes', now() - interval '4 hours') $$,
  'TT004', null, 'überschneidende Aktivität wird abgewiesen');
select throws_ok(
  $$ select public.correct_activity_session('ffffffff-0000-4000-8000-000000000001',
       now() - interval '570 minutes', now() - interval '510 minutes') $$,
  'TT004', null, 'Korrektur in eine andere Aktivität hinein wird abgewiesen');
select throws_ok(
  $$ select public.correct_activity_session('ffffffff-0000-4000-8000-000000000001',
       now() - interval '5 hours', now() - interval '6 hours') $$,
  'TT006', null, 'Ende vor Beginn wird abgewiesen');
select throws_ok(
  $$ select public.correct_activity_session('ffffffff-0000-4000-8000-000000000001',
       now() - interval '50 hours', now() - interval '25 hours') $$,
  'TT006', null, 'Aktivitäten über 24 Stunden werden abgewiesen');
select throws_ok(
  $$ select public.correct_activity_session('ffffffff-0000-4000-8000-000000000001',
       now() - interval '1 hour', now() + interval '2 hours') $$,
  'TT006', null, 'Ende in der Zukunft wird abgewiesen');

-- Bezug zu Planblöcken
select throws_ok(
  $$ insert into public.activity_sessions (goal_category, title, schedule_entry_id, started_at, ended_at)
     values ('business', 'x', 'eeeeeeee-1111-4000-8000-000000000003',
             now() - interval '4 hours', now() - interval '210 minutes') $$,
  'TT005', null, 'Planblöcke aus Entwürfen sind nicht erlaubt');
select throws_ok(
  $$ insert into public.activity_sessions (goal_category, title, schedule_entry_id, started_at, ended_at)
     values ('business', 'x', 'eeeeeeee-1111-4000-8000-000000000002',
             now() - interval '4 hours', now() - interval '210 minutes') $$,
  'TT005', null, 'Planblock eines anderen Ziels wird abgewiesen');
select lives_ok(
  $$ insert into public.activity_sessions (goal_category, title, schedule_entry_id, started_at, ended_at)
     values ('sport', 'Krafttraining (Beispiel)', 'eeeeeeee-1111-4000-8000-000000000002',
             now() - interval '4 hours', now() - interval '3 hours') $$,
  'Planblock desselben Ziels aus veröffentlichter Woche ist erlaubt');

-- Weitere Regeln
select throws_ok(
  $$ update public.activity_sessions set ended_at = null
      where id = 'ffffffff-0000-4000-8000-000000000001' $$,
  'TT006', null, 'beendete Aktivitäten können nicht wieder gestartet werden');
select throws_ok($$ select public.start_activity_session('duty') $$,
  '22023', null, 'unbekanntes Ziel wird abgewiesen');
select throws_ok(
  $$ insert into public.activity_sessions (goal_category, title, started_at, ended_at)
     values ('duty', 'x', now() - interval '2 hours', now() - interval '90 minutes') $$,
  '23514', null, 'nur die drei Zielkategorien sind erlaubt');
select throws_ok(
  $$ insert into public.activity_sessions (goal_category, title, started_at)
     values ('business', 'x', now() - interval '25 hours') $$,
  'TT006', null, 'laufende Aktivität darf höchstens 24 Stunden zurückliegen');
select throws_ok(
  $$ insert into public.activity_sessions (goal_category, title, started_at)
     values ('business', 'x', now() + interval '1 hour') $$,
  'TT006', null, 'Beginn in der Zukunft wird abgewiesen');

-- Zielfelder in user_settings
select throws_ok(
  $$ update public.user_settings set weekly_sport_target_minutes = 0 $$,
  '23514', null, 'Sportziel 0 ist nicht erlaubt (kein Ziel = NULL)');
select lives_ok(
  $$ update public.user_settings set weekly_sport_target_minutes = 90,
                                    weekly_relationship_target_minutes = null $$,
  'Sportziel setzen und Beziehungsziel leer lassen');
select throws_ok(
  $$ update public.user_settings set reminder_scope = 'unbekannt' $$,
  '23514', null, 'unbekannter Erinnerungsumfang wird abgewiesen');
select throws_ok(
  $$ update public.user_settings set reminder_minutes_before = 0 $$,
  '23514', null, 'Vorlauf 0 wird abgewiesen (keine Vorab-Erinnerung = NULL)');

reset role;

-- -----------------------------------------------------------------------------
-- Als postgres: Regeln, die nicht vom Trigger allein abhängen
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ update public.activity_sessions set owner_id = '11111111-1111-4111-8111-111111111111'
      where id = 'ffffffff-0000-4000-8000-000000000001' $$,
  '23514', null, 'Eigentümer einer Aktivität ist unveränderlich');

-- Eine vergessene Aktivität (läuft seit über 24 Stunden) – nur ohne Trigger anlegbar.
alter table public.activity_sessions disable trigger activity_sessions_guard;
insert into public.activity_sessions (id, owner_id, goal_category, title, started_at)
values ('ffffffff-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444',
        'business', 'Vergessen (Beispiel)', now() - interval '30 hours');
select throws_ok(
  $$ insert into public.activity_sessions (owner_id, goal_category, title, started_at)
     values ('44444444-4444-4444-8444-444444444444', 'sport', 'x', now() - interval '29 hours') $$,
  '23505', null, 'eindeutiger Teilindex verhindert eine zweite laufende Aktivität');
alter table public.activity_sessions enable trigger activity_sessions_guard;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

select throws_ok($$ select public.stop_activity_session() $$,
  'TT003', null, 'über 24 Stunden laufende Aktivität verlangt eine Korrektur');
select lives_ok(
  $$ select public.correct_activity_session('ffffffff-0000-4000-8000-000000000002',
       now() - interval '30 hours', now() - interval '29 hours') $$,
  'vergessene Aktivität lässt sich mit Ende nachtragen');
select is(
  (select ended_at - started_at from public.activity_sessions
    where id = 'ffffffff-0000-4000-8000-000000000002'),
  interval '1 hour',
  'nachgetragene Dauer wird übernommen');

select * from finish();
rollback;

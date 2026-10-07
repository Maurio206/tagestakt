-- Atomarer Wechsel der laufenden Aktivität (switch_activity_session):
-- Fehlerfälle lassen die alte Aktivität unverändert, nie zwei laufende Aktivitäten,
-- RLS gegenüber anderen Benutzern, kein Zugriff für anon.
begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- -----------------------------------------------------------------------------
-- Testdaten (als postgres): Eigentümer A und ein anderer Benutzer B
-- -----------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555',
   'authenticated', 'authenticated', 'wechsel@tagestakt.test', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666',
   'authenticated', 'authenticated', 'wechsel-fremd@tagestakt.test', '', now(), now());

-- A: aktuelle Woche veröffentlicht (Gewerbe- und Sportblock), nächste Woche als Entwurf.
-- B: eigene veröffentlichte Woche mit einem Sportblock.
insert into public.schedule_weeks (id, owner_id, week_start)
values
  ('aaaa0000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555',
   date_trunc('week', now() at time zone 'Europe/Berlin')::date),
  ('aaaa0000-0000-4000-8000-000000000002', '55555555-5555-4555-8555-555555555555',
   date_trunc('week', now() at time zone 'Europe/Berlin')::date + 7),
  ('bbbb0000-0000-4000-8000-000000000001', '66666666-6666-4666-8666-666666666666',
   date_trunc('week', now() at time zone 'Europe/Berlin')::date);

insert into public.schedule_entries (id, owner_id, schedule_week_id, title, category, start_at, end_at)
select v.id::uuid, v.owner::uuid, v.week::uuid, v.title, v.category,
       ((date_trunc('week', now() at time zone 'Europe/Berlin')::date + v.day_offset) + time '09:00')
         at time zone 'Europe/Berlin',
       ((date_trunc('week', now() at time zone 'Europe/Berlin')::date + v.day_offset) + time '11:00')
         at time zone 'Europe/Berlin'
  from (values
    ('aaaa1111-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555',
     'aaaa0000-0000-4000-8000-000000000001', 'Kundenprojekt (Beispiel)', 'business', 0),
    ('aaaa1111-0000-4000-8000-000000000002', '55555555-5555-4555-8555-555555555555',
     'aaaa0000-0000-4000-8000-000000000001', 'Krafttraining (Beispiel)', 'sport', 1),
    ('aaaa1111-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555',
     'aaaa0000-0000-4000-8000-000000000002', 'Entwurfsblock (Beispiel)', 'business', 7),
    ('bbbb1111-0000-4000-8000-000000000001', '66666666-6666-4666-8666-666666666666',
     'bbbb0000-0000-4000-8000-000000000001', 'Fremder Block (Beispiel)', 'sport', 1)
  ) as v(id, owner, week, title, category, day_offset);

update public.schedule_weeks set status = 'published'
 where id in ('aaaa0000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001');

-- -----------------------------------------------------------------------------
-- Struktur und Rechte
-- -----------------------------------------------------------------------------
select function_privs_are('public', 'switch_activity_session',
  array['uuid', 'text', 'text', 'uuid'], 'anon', array[]::text[]);
select function_privs_are('public', 'switch_activity_session',
  array['uuid', 'text', 'text', 'uuid'], 'authenticated', array['EXECUTE']);
select is(
  (select prosecdef from pg_proc
    where oid = 'public.switch_activity_session(uuid, text, text, uuid)'::regprocedure),
  false, 'switch_activity_session läuft als SECURITY INVOKER');
select is(
  (select proconfig from pg_proc
    where oid = 'public.switch_activity_session(uuid, text, text, uuid)'::regprocedure),
  array['search_path=""'], 'switch_activity_session hat einen leeren search_path');
select ok(
  (select prosrc from pg_proc
    where oid = 'public.switch_activity_session(uuid, text, text, uuid)'::regprocedure)
    like '%pg_advisory_xact_lock(%tagestakt.activity_sessions:%',
  'switch_activity_session nutzt dieselbe Advisory-Sperre wie Start und Trigger');

-- -----------------------------------------------------------------------------
-- Anonym
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$ select public.switch_activity_session(gen_random_uuid(), 'sport') $$,
  '42501', null, 'anon: kann keine Aktivität wechseln');
reset role;

-- -----------------------------------------------------------------------------
-- Eigentümer A
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);

select throws_ok(
  $$ select public.switch_activity_session(gen_random_uuid(), 'sport') $$,
  'TT002', null, 'Wechsel ohne laufende Aktivität wird abgewiesen');

select is((public.start_activity_session('business', 'Erste (Beispiel)')).title, 'Erste (Beispiel)',
  'Ausgangslage: eine Aktivität läuft');

select throws_ok(
  $$ select public.switch_activity_session(null, 'sport') $$,
  '22023', null, 'Wechsel ohne Angabe der laufenden Aktivität wird abgewiesen');
select throws_ok(
  $$ select public.switch_activity_session(
       (select id from public.activity_sessions where ended_at is null), 'duty') $$,
  '22023', null, 'ungültige neue Kategorie wird abgewiesen');
select throws_ok(
  $$ select public.switch_activity_session(
       (select id from public.activity_sessions where ended_at is null),
       'business', null, 'aaaa1111-0000-4000-8000-000000000003') $$,
  'TT005', null, 'Planblock aus einem Entwurf wird abgewiesen');
select throws_ok(
  $$ select public.switch_activity_session(
       (select id from public.activity_sessions where ended_at is null),
       'sport', null, 'bbbb1111-0000-4000-8000-000000000001') $$,
  'TT005', null, 'fremder Planblock wird abgewiesen');
select throws_ok(
  $$ select public.switch_activity_session(
       (select id from public.activity_sessions where ended_at is null),
       'business', null, 'aaaa1111-0000-4000-8000-000000000002') $$,
  'TT005', null, 'Planblock eines anderen Ziels wird abgewiesen');

-- Nach allen Fehlversuchen: alte Aktivität läuft unverändert, nichts wurde angelegt.
select is(
  (select count(*)::int from public.activity_sessions), 1,
  'fehlgeschlagene Wechsel legen keine Aktivität an');
select is(
  (select ended_at from public.activity_sessions where title = 'Erste (Beispiel)'), null,
  'fehlgeschlagene Wechsel lassen die alte Aktivität laufen (vollständiges Zurückrollen)');

-- Erfolgreicher Wechsel zu einem eigenen, veröffentlichten Planblock.
select is(
  (public.switch_activity_session(
     (select id from public.activity_sessions where ended_at is null),
     'sport', null, 'aaaa1111-0000-4000-8000-000000000002')).title,
  'Krafttraining (Beispiel)',
  'Wechsel startet die neue Aktivität mit dem Titel des Planblocks');
select is(
  (select count(*)::int from public.activity_sessions where ended_at is null), 1,
  'nach dem Wechsel läuft genau eine Aktivität');
select is(
  (select goal_category from public.activity_sessions where ended_at is null), 'sport',
  'die laufende Aktivität ist die neue');
select is(
  (select schedule_entry_id from public.activity_sessions where ended_at is null),
  'aaaa1111-0000-4000-8000-000000000002'::uuid,
  'die neue Aktivität ist mit dem Planblock verknüpft');
select isnt(
  (select ended_at from public.activity_sessions where title = 'Erste (Beispiel)'), null,
  'die alte Aktivität ist beendet');
select is(
  (select ended_at from public.activity_sessions where title = 'Erste (Beispiel)'),
  (select started_at from public.activity_sessions where ended_at is null),
  'Ende der alten = Beginn der neuen Aktivität (keine Lücke, keine Überschneidung)');
select is(
  (select count(*)::int from public.activity_sessions where corrected_at is not null), 0,
  'ein Wechsel gilt nicht als Korrektur');

-- Veralteter Stand (z. B. zweites Gerät, gleichzeitiger Wechsel): wird abgewiesen.
select throws_ok(
  $$ select public.switch_activity_session(
       (select id from public.activity_sessions where title = 'Erste (Beispiel)'), 'relationship') $$,
  'TT002', null, 'Wechsel mit veralteter Aktivität wird abgewiesen');
select is(
  (select count(*)::int from public.activity_sessions where ended_at is null), 1,
  'auch danach läuft höchstens eine Aktivität');

reset role;

-- ID der laufenden Aktivität von A für den Angriff durch B festhalten (B kann sie nicht lesen).
select set_config('tagestakt.test_running_session',
  (select id::text from public.activity_sessions
    where owner_id = '55555555-5555-4555-8555-555555555555' and ended_at is null), true);

-- -----------------------------------------------------------------------------
-- Anderer Benutzer B (RLS)
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);

select throws_ok(
  $$ select public.switch_activity_session(
       current_setting('tagestakt.test_running_session')::uuid, 'business') $$,
  'TT002', null, 'fremd: kann die laufende Aktivität von A nicht wechseln');
select is_empty($$ select * from public.activity_sessions $$,
  'fremd: sieht keine Aktivitäten von A');

reset role;

select is(
  (select goal_category from public.activity_sessions
    where owner_id = '55555555-5555-4555-8555-555555555555' and ended_at is null),
  'sport', 'Aktivität von A läuft nach dem Versuch von B unverändert');

-- Über 24 Stunden laufende Aktivität: Wechsel verlangt zuerst eine Korrektur.
alter table public.activity_sessions disable trigger activity_sessions_guard;
update public.activity_sessions set started_at = now() - interval '30 hours'
 where owner_id = '55555555-5555-4555-8555-555555555555' and ended_at is null;
alter table public.activity_sessions enable trigger activity_sessions_guard;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select throws_ok(
  $$ select public.switch_activity_session(
       (select id from public.activity_sessions where ended_at is null), 'business') $$,
  'TT003', null, 'über 24 Stunden laufende Aktivität verlangt vor dem Wechsel eine Korrektur');
select is(
  (select count(*)::int from public.activity_sessions where ended_at is null), 1,
  'abgewiesener Wechsel lässt die laufende Aktivität bestehen');
reset role;

select * from finish();
rollback;

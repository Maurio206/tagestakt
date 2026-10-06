-- Constraints, Trigger und Versionierung.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
        'authenticated', 'authenticated', 'integritaet@tagestakt.test', '', now(), now());

insert into public.schedule_weeks (id, owner_id, week_start)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '33333333-3333-4333-8333-333333333333', '2026-10-19');

-- -----------------------------------------------------------------------------
-- Wochenpläne
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.schedule_weeks (owner_id, week_start)
     values ('33333333-3333-4333-8333-333333333333', '2026-10-20') $$,
  '23514', null, 'Wochenbeginn muss ein Montag sein');
select throws_ok(
  $$ insert into public.schedule_weeks (owner_id, week_start, version)
     values ('33333333-3333-4333-8333-333333333333', '2026-10-26', 0) $$,
  '23514', null, 'Version muss positiv sein');
select throws_ok(
  $$ insert into public.schedule_weeks (owner_id, week_start, version)
     values ('33333333-3333-4333-8333-333333333333', '2026-10-19', 2) $$,
  '23505', null, 'pro Woche höchstens ein Entwurf');
select throws_ok(
  $$ insert into public.schedule_weeks (owner_id, week_start, status, published_at)
     values ('33333333-3333-4333-8333-333333333333', '2026-11-02', 'published', now()) $$,
  '23514', null, 'neue Wochenpläne können nicht direkt veröffentlicht angelegt werden');
select throws_ok(
  $$ update public.schedule_weeks set version = 5
      where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' $$,
  '23514', null, 'Version ist unveränderlich');

-- -----------------------------------------------------------------------------
-- Einträge
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             'x', 'other', '2026-10-20 10:00+02', '2026-10-20 09:00+02') $$,
  '23514', null, 'Endzeit muss nach der Startzeit liegen');
select throws_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             'x', 'other', '2026-10-20 08:00+02', '2026-10-21 08:01+02') $$,
  '23514', null, 'Einträge dürfen höchstens 24 Stunden dauern');
select throws_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             'x', 'party', '2026-10-20 08:00+02', '2026-10-20 09:00+02') $$,
  '23514', null, 'nur bekannte Kategorien');
select throws_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             '   ', 'other', '2026-10-20 08:00+02', '2026-10-20 09:00+02') $$,
  '23514', null, 'Titel darf nicht leer sein');

-- Wochengrenzen in Europe/Berlin (Woche vom 19.10.2026 endet nach der Zeitumstellung)
select throws_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             'x', 'other', '2026-10-18 23:59+02', '2026-10-19 00:30+02') $$,
  '23514', null, 'Eintrag vor Montag 00:00 Berliner Zeit gehört nicht in die Woche');
select lives_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             'Montag früh', 'sleep', '2026-10-19 00:00+02', '2026-10-19 06:00+02') $$,
  'Eintrag ab Montag 00:00 Berliner Zeit gehört in die Woche');
select lives_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             'Sonntag spät', 'sleep', '2026-10-25 23:30+01', '2026-10-26 06:30+01') $$,
  'Eintrag Sonntag 23:30 (nach Zeitumstellung) darf in die nächste Woche hineinragen');
select throws_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             'x', 'other', '2026-10-26 00:00+01', '2026-10-26 01:00+01') $$,
  '23514', null, 'Eintrag ab Montag 00:00 der Folgewoche gehört nicht mehr in die Woche');
select lives_ok(
  $$ insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
     values ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
             'Überschneidung', 'appointment', '2026-10-19 05:00+02', '2026-10-19 05:30+02') $$,
  'Überschneidungen werden in der Datenbank bewusst nicht verhindert');

-- updated_at
update public.schedule_entries set title = 'Montag früh (geändert)', updated_at = '2000-01-01'
 where title = 'Montag früh';
select is(
  (select updated_at from public.schedule_entries where title = 'Montag früh (geändert)'),
  now(),
  'updated_at wird bei jeder Änderung gesetzt');

-- -----------------------------------------------------------------------------
-- Wiederholungen und Einstellungen
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.recurring_commitments (owner_id, title, category, weekday, start_time, end_time)
     values ('33333333-3333-4333-8333-333333333333', 'x', 'other', 8, '08:00', '09:00') $$,
  '23514', null, 'Wochentag 1–7');
select throws_ok(
  $$ insert into public.recurring_commitments (owner_id, title, category, weekday, start_time, end_time)
     values ('33333333-3333-4333-8333-333333333333', 'x', 'other', 1, '08:00', '08:00') $$,
  '23514', null, 'Start- und Endzeit einer Wiederholung dürfen nicht gleich sein');
select throws_ok(
  $$ insert into public.user_settings (owner_id, timezone)
     values ('33333333-3333-4333-8333-333333333333', 'UTC') $$,
  '23514', null, 'MVP: nur Europe/Berlin');
select throws_ok(
  $$ insert into public.user_settings (owner_id, weekly_business_target_minutes)
     values ('33333333-3333-4333-8333-333333333333', -5) $$,
  '23514', null, 'Wochenziel darf nicht negativ sein');

-- -----------------------------------------------------------------------------
-- Versionierung über die RPC-Funktionen (als Eigentümer)
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select public.publish_schedule_week('dddddddd-dddd-4ddd-8ddd-dddddddddddd');

select is(
  (public.create_schedule_draft('2026-10-19')).version,
  2,
  'neuer Entwurf erhält die nächste Version');
select is(
  (select count(*)::int from public.schedule_entries e
     join public.schedule_weeks w on w.id = e.schedule_week_id
    where w.week_start = '2026-10-19' and w.status = 'draft'),
  3,
  'Entwurf übernimmt die Einträge der veröffentlichten Version');
select is(
  (public.create_schedule_draft('2026-10-19')).version,
  2,
  'erneuter Aufruf liefert denselben Entwurf (idempotent)');

select public.publish_schedule_week(
  (select id from public.schedule_weeks where week_start = '2026-10-19' and status = 'draft'));

select results_eq(
  $$ select version, status from public.schedule_weeks
      where week_start = '2026-10-19' order by version $$,
  $$ values (1, 'archived'::text), (2, 'published'::text) $$,
  'Veröffentlichen archiviert die vorherige Version');
select throws_ok(
  $$ update public.schedule_weeks set status = 'draft' where version = 2 $$,
  '23514', null, 'veröffentlichte Version kann nicht zurück zum Entwurf');

select * from finish();
rollback;

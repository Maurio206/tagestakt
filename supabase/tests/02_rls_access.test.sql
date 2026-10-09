-- Negative und positive Zugriffstests:
--   * anonymer Zugriff wird abgewiesen
--   * ein anderer angemeldeter Benutzer kann fremde Daten weder lesen noch verändern
--   * der Eigentümer kann seine eigenen Daten bearbeiten
begin;
create extension if not exists pgtap with schema extensions;

select plan(83);

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

insert into public.activity_sessions (id, owner_id, goal_category, title, started_at, ended_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111',
        'business', 'Beispiel', now() - interval '3 hours', now() - interval '2 hours');

insert into public.daily_notes (id, owner_id, note_date, content)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111',
        '2026-10-05', 'Beispielnotiz');

insert into public.planning_preferences (owner_id, business_earliest_start, business_latest_end,
  business_min_block_minutes, business_max_block_minutes, business_max_daily_minutes, buffer_minutes)
values ('11111111-1111-4111-8111-111111111111', '08:00', '21:00', 60, 180, 240, 15);

insert into public.planning_goal_slots (id, owner_id, goal_category, weekday, requirement, title,
  duration_minutes, window_start, window_end)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111', 'sport', 1,
        'required', 'Training (Beispiel)', 60, '17:00', '20:00');

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
select throws_ok($$ select * from public.activity_sessions $$, '42501', null,
  'anon: kein Lesezugriff auf activity_sessions');
select throws_ok(
  $$ insert into public.activity_sessions (owner_id, goal_category, title)
     values ('11111111-1111-4111-8111-111111111111', 'business', 'x') $$,
  '42501', null, 'anon: kann keine Aktivitäten anlegen');
select throws_ok(
  $$ select public.start_activity_session('business') $$,
  '42501', null, 'anon: kann keine Aktivität starten');
select throws_ok($$ select * from public.daily_notes $$, '42501', null,
  'anon: kein Lesezugriff auf daily_notes');
select throws_ok(
  $$ insert into public.daily_notes (owner_id, note_date, content)
     values ('11111111-1111-4111-8111-111111111111', '2026-10-06', 'x') $$,
  '42501', null, 'anon: kann keine Tagesnotizen anlegen');
select throws_ok(
  $$ select * from public.save_daily_note('2026-10-06', 'x') $$,
  '42501', null, 'anon: kann keine Tagesnotiz per RPC speichern');
select throws_ok($$ select * from public.planning_preferences $$, '42501', null,
  'anon: kein Lesezugriff auf planning_preferences');
select throws_ok($$ select * from public.planning_goal_slots $$, '42501', null,
  'anon: kein Lesezugriff auf planning_goal_slots');
select throws_ok(
  $$ select public.schedule_week_fingerprint('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  '42501', null, 'anon: kein Fingerabdruck fremder Wochen');
select throws_ok(
  $$ select public.save_generated_schedule_draft('2026-10-12', null, null,
       '[{"title":"x","category":"business","start_at":"2026-10-12T07:00:00Z","end_at":"2026-10-12T08:00:00Z","source":"agent"}]') $$,
  '42501', null, 'anon: kann keinen Planer-Entwurf speichern');
select throws_ok(
  $$ select public.publish_reviewed_schedule_week('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       repeat('a', 64)) $$,
  '42501', null, 'anon: kann nicht geprüft veröffentlichen');

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

select is_empty($$ select * from public.activity_sessions $$,
  'fremd: sieht keine fremden Aktivitäten');
select is_empty(
  $$ update public.activity_sessions set title = 'Übernommen' returning id $$,
  'fremd: kann fremde Aktivitäten nicht ändern');
select is_empty(
  $$ delete from public.activity_sessions returning id $$,
  'fremd: kann fremde Aktivitäten nicht löschen');
select throws_ok(
  $$ select public.correct_activity_session('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
       now() - interval '5 hours', now() - interval '4 hours') $$,
  'P0002', null, 'fremd: kann fremde Aktivitäten nicht korrigieren');
select throws_ok(
  $$ select public.stop_activity_session('dddddddd-dddd-4ddd-8ddd-dddddddddddd') $$,
  'TT002', null, 'fremd: kann fremde Aktivitäten nicht beenden');
select throws_ok(
  $$ insert into public.activity_sessions (owner_id, goal_category, title)
     values ('11111111-1111-4111-8111-111111111111', 'business', 'x') $$,
  '42501', null, 'fremd: kann keine Aktivität im Namen eines anderen anlegen');
select throws_ok(
  $$ select public.start_activity_session('business', null, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  'TT005', null, 'fremd: kann keine Aktivität an einen fremden Planblock hängen');

select is_empty($$ select * from public.daily_notes $$,
  'fremd: sieht keine fremden Tagesnotizen');
select is_empty(
  $$ update public.daily_notes set content = 'Übernommen' returning id $$,
  'fremd: kann fremde Tagesnotizen nicht ändern');
select is_empty(
  $$ delete from public.daily_notes returning id $$,
  'fremd: kann fremde Tagesnotizen nicht löschen');
select throws_ok(
  $$ insert into public.daily_notes (owner_id, note_date, content)
     values ('11111111-1111-4111-8111-111111111111', '2026-10-06', 'x') $$,
  '42501', null, 'fremd: kann keine Tagesnotiz im Namen eines anderen anlegen');
select throws_ok(
  $$ select * from public.save_daily_note('2026-10-05', 'Übernommen',
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1) $$,
  'TT007', null, 'fremd: kann eine fremde Tagesnotiz nicht per RPC überschreiben');

select is_empty($$ select * from public.planning_preferences $$,
  'fremd: sieht keine fremden Planungsregeln');
select is_empty($$ select * from public.planning_goal_slots $$,
  'fremd: sieht keine fremden Zeitfenster');
select is_empty(
  $$ update public.planning_preferences set buffer_minutes = 0 returning owner_id $$,
  'fremd: kann fremde Planungsregeln nicht ändern');
select is_empty(
  $$ delete from public.planning_goal_slots returning id $$,
  'fremd: kann fremde Zeitfenster nicht löschen');
select throws_ok(
  $$ insert into public.planning_goal_slots (owner_id, goal_category, weekday, requirement, title,
       duration_minutes, window_start, window_end)
     values ('11111111-1111-4111-8111-111111111111', 'sport', 2, 'required', 'x', 60, '17:00', '19:00') $$,
  '42501', null, 'fremd: kann keine Zeitfenster im Namen eines anderen anlegen');
select throws_ok(
  $$ select public.schedule_week_fingerprint('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  'P0002', null, 'fremd: kein Fingerabdruck fremder Wochen');
select throws_ok(
  $$ select public.publish_reviewed_schedule_week('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       repeat('a', 64)) $$,
  'P0002', null, 'fremd: kann fremde Wochen nicht geprüft veröffentlichen');
select is(
  (public.save_generated_schedule_draft('2026-10-05', null, null,
     '[{"title":"Fremd (Beispiel)","category":"business","start_at":"2026-10-06T07:00:00Z","end_at":"2026-10-06T08:00:00Z","source":"agent"}]')).owner_id,
  '22222222-2222-4222-8222-222222222222'::uuid,
  'fremd: Planer-Entwurf entsteht nur im eigenen Konto (nie in einer fremden Woche)');

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
select is(
  (select title from public.activity_sessions where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  'Beispiel',
  'Aktivität des Eigentümers ist nach den Angriffen unverändert'
);
select is(
  (select content from public.daily_notes where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  'Beispielnotiz',
  'Tagesnotiz des Eigentümers ist nach den Angriffen unverändert'
);
select is(
  (select buffer_minutes from public.planning_preferences
    where owner_id = '11111111-1111-4111-8111-111111111111'),
  15::smallint,
  'Planungsregeln des Eigentümers sind nach den Angriffen unverändert'
);
select is(
  (select count(*)::int from public.schedule_entries
    where schedule_week_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1,
  'Woche des Eigentümers ist nach dem fremden Planer-Aufruf unverändert'
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
select is((select count(*)::int from public.activity_sessions), 1,
  'Eigentümer: sieht seine Aktivitäten');
select is((select count(*)::int from public.planning_goal_slots), 1,
  'Eigentümer: sieht seine Zeitfenster');
select is((select count(*)::int from public.schedule_weeks), 1,
  'Eigentümer: sieht den fremden Planer-Entwurf nicht');
select lives_ok(
  $$ select public.start_activity_session('sport', 'Laufen (Beispiel)') $$,
  'Eigentümer: kann eine Aktivität starten');
select throws_ok(
  $$ select public.start_activity_session('business') $$,
  'TT001', null, 'Eigentümer: höchstens eine laufende Aktivität');
select lives_ok(
  $$ select public.stop_activity_session() $$,
  'Eigentümer: kann die laufende Aktivität beenden');

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

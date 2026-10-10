-- Strukturelle Sicherheitsprüfungen: RLS, Policies, Grants, keine Views.
begin;
create extension if not exists pgtap with schema extensions;

select plan(58);

-- RLS überall aktiv
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'RLS ist auf jeder Tabelle im public-Schema aktiviert'
);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public'),
  8,
  'public enthält genau die acht erwarteten Tabellen (neue Tabellen brauchen neue Tests)'
);

-- Jede Tabelle besitzt eine owner_id
select is(
  (select count(*)::int
     from pg_tables t
    where t.schemaname = 'public'
      and not exists (
        select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t.tablename and c.column_name = 'owner_id'
      )),
  0,
  'jede Tabelle besitzt eine owner_id-Spalte'
);

-- Keine Views, die RLS umgehen könnten
select is(
  (select count(*)::int from pg_views where schemaname = 'public'),
  0,
  'keine Views im public-Schema'
);
select is(
  (select count(*)::int from pg_matviews where schemaname = 'public'),
  0,
  'keine Materialized Views im public-Schema'
);

-- Keine SECURITY-DEFINER-Funktionen im exponierten Schema
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef),
  0,
  'keine SECURITY-DEFINER-Funktionen im public-Schema'
);

-- Policies: genau vier pro Tabelle, ausschließlich für authenticated
select policies_are('public', 'user_settings', array[
  'user_settings: eigene lesen', 'user_settings: eigene anlegen',
  'user_settings: eigene ändern', 'user_settings: eigene löschen'
]);
select policies_are('public', 'recurring_commitments', array[
  'recurring_commitments: eigene lesen', 'recurring_commitments: eigene anlegen',
  'recurring_commitments: eigene ändern', 'recurring_commitments: eigene löschen'
]);
select policies_are('public', 'schedule_weeks', array[
  'schedule_weeks: eigene lesen', 'schedule_weeks: eigene anlegen',
  'schedule_weeks: eigene ändern', 'schedule_weeks: eigene löschen'
]);
select policies_are('public', 'schedule_entries', array[
  'schedule_entries: eigene lesen', 'schedule_entries: eigene anlegen',
  'schedule_entries: eigene ändern', 'schedule_entries: eigene löschen'
]);
select policies_are('public', 'activity_sessions', array[
  'activity_sessions: eigene lesen', 'activity_sessions: eigene anlegen',
  'activity_sessions: eigene ändern', 'activity_sessions: eigene löschen'
]);
select policies_are('public', 'daily_notes', array[
  'daily_notes: eigene lesen', 'daily_notes: eigene anlegen',
  'daily_notes: eigene ändern', 'daily_notes: eigene löschen'
]);
select policies_are('public', 'planning_preferences', array[
  'planning_preferences: eigene lesen', 'planning_preferences: eigene anlegen',
  'planning_preferences: eigene ändern', 'planning_preferences: eigene löschen'
]);
select policies_are('public', 'planning_goal_slots', array[
  'planning_goal_slots: eigene lesen', 'planning_goal_slots: eigene anlegen',
  'planning_goal_slots: eigene ändern', 'planning_goal_slots: eigene löschen'
]);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and roles <> '{authenticated}'),
  0,
  'alle Policies gelten ausschließlich für die Rolle authenticated'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and cmd = 'ALL'),
  0,
  'keine Sammel-Policies (FOR ALL) – je Operation eine eigene Policy'
);

-- Grants: anon hat nichts
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'PUBLIC')),
  0,
  'anon und PUBLIC haben keinerlei Tabellenrechte im public-Schema'
);

-- Grants: authenticated nur CRUD
select table_privs_are('public', 'user_settings', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('public', 'recurring_commitments', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('public', 'schedule_weeks', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('public', 'schedule_entries', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('public', 'activity_sessions', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('public', 'daily_notes', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('public', 'planning_preferences', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('public', 'planning_goal_slots', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);

-- Funktionsrechte
select function_privs_are('public', 'publish_schedule_week', array['uuid'], 'anon', array[]::text[]);
select function_privs_are('public', 'publish_schedule_week', array['uuid'], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'create_schedule_draft', array['date'], 'anon', array[]::text[]);
select function_privs_are('public', 'add_schedule_entries', array['uuid', 'jsonb', 'boolean'], 'anon', array[]::text[]);
select function_privs_are('public', 'start_activity_session', array['text', 'text', 'uuid'],
  'anon', array[]::text[]);
select function_privs_are('public', 'start_activity_session', array['text', 'text', 'uuid'],
  'authenticated', array['EXECUTE']);
select function_privs_are('public', 'stop_activity_session', array['uuid'], 'anon', array[]::text[]);
select function_privs_are('public', 'stop_activity_session', array['uuid'],
  'authenticated', array['EXECUTE']);
select function_privs_are('public', 'correct_activity_session',
  array['uuid', 'timestamp with time zone', 'timestamp with time zone'], 'anon', array[]::text[]);
select function_privs_are('public', 'correct_activity_session',
  array['uuid', 'timestamp with time zone', 'timestamp with time zone'],
  'authenticated', array['EXECUTE']);
select function_privs_are('private', 'guard_activity_session', array[]::text[],
  'authenticated', array[]::text[]);
select function_privs_are('public', 'save_daily_note', array['date', 'text', 'uuid', 'integer'],
  'anon', array[]::text[]);
select function_privs_are('public', 'save_daily_note', array['date', 'text', 'uuid', 'integer'],
  'authenticated', array['EXECUTE']);
select function_privs_are('private', 'guard_daily_note', array[]::text[],
  'authenticated', array[]::text[]);
select function_privs_are('public', 'schedule_week_fingerprint', array['uuid'],
  'anon', array[]::text[]);
select function_privs_are('public', 'schedule_week_fingerprint', array['uuid'],
  'authenticated', array['EXECUTE']);
select function_privs_are('public', 'save_generated_schedule_draft',
  array['date', 'uuid', 'text', 'jsonb', 'text'], 'anon', array[]::text[]);
select function_privs_are('public', 'save_generated_schedule_draft',
  array['date', 'uuid', 'text', 'jsonb', 'text'], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'publish_reviewed_schedule_week', array['uuid', 'text'],
  'anon', array[]::text[]);
select function_privs_are('public', 'publish_reviewed_schedule_week', array['uuid', 'text'],
  'authenticated', array['EXECUTE']);
select function_privs_are('public', 'discard_reviewed_schedule_draft', array['uuid', 'text'],
  'anon', array[]::text[]);
select function_privs_are('public', 'discard_reviewed_schedule_draft', array['uuid', 'text'],
  'authenticated', array['EXECUTE']);

-- Das interne Schema ist nicht erreichbar
select schema_privs_are('private', 'anon', array[]::text[]);
select schema_privs_are('private', 'authenticated', array[]::text[]);

-- Das Connector-Schema (OAuth, Bestätigungen) ist für die API-Rollen nicht erreichbar
select schema_privs_are('connector', 'anon', array[]::text[]);
select schema_privs_are('connector', 'authenticated', array[]::text[]);
select schema_privs_are('connector', 'service_role', array[]::text[]);

-- Indizes für RLS-Spalten und Fremdschlüssel
select has_index('public', 'schedule_entries', 'schedule_entries_week_owner_idx',
  'Index für den zusammengesetzten Fremdschlüssel schedule_entries → schedule_weeks');
select has_index('public', 'activity_sessions', 'activity_sessions_owner_started_idx',
  'Index für owner_id/started_at der erfassten Zeiten');
select has_index('public', 'activity_sessions', 'activity_sessions_entry_owner_idx',
  'Index für den zusammengesetzten Fremdschlüssel activity_sessions → schedule_entries');
select has_index('public', 'activity_sessions', 'activity_sessions_one_active_idx',
  'Eindeutiger Teilindex: höchstens eine laufende Aktivität pro Benutzer');
select has_index('public', 'daily_notes', 'daily_notes_owner_date_key',
  'Eindeutiger Index (owner_id, note_date) – zugleich Index für RLS auf owner_id');
select has_index('public', 'planning_goal_slots', 'planning_goal_slots_owner_goal_weekday_key',
  'Eindeutiger Index (owner_id, goal_category, weekday) – zugleich Index für RLS auf owner_id');

select * from finish();
rollback;

-- Strukturelle Sicherheitsprüfungen: RLS, Policies, Grants, keine Views.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- RLS überall aktiv
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'RLS ist auf jeder Tabelle im public-Schema aktiviert'
);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public'),
  4,
  'public enthält genau die vier erwarteten Tabellen (neue Tabellen brauchen neue Tests)'
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

-- Funktionsrechte
select function_privs_are('public', 'publish_schedule_week', array['uuid'], 'anon', array[]::text[]);
select function_privs_are('public', 'publish_schedule_week', array['uuid'], 'authenticated', array['EXECUTE']);
select function_privs_are('public', 'create_schedule_draft', array['date'], 'anon', array[]::text[]);
select function_privs_are('public', 'add_schedule_entries', array['uuid', 'jsonb', 'boolean'], 'anon', array[]::text[]);

-- Das interne Schema ist nicht erreichbar
select schema_privs_are('private', 'anon', array[]::text[]);
select schema_privs_are('private', 'authenticated', array[]::text[]);

-- Indizes für RLS-Spalten und Fremdschlüssel
select has_index('public', 'schedule_entries', 'schedule_entries_week_owner_idx',
  'Index für den zusammengesetzten Fremdschlüssel schedule_entries → schedule_weeks');

select * from finish();
rollback;

-- =============================================================================
-- TagesTakt – Vorprüfung vor den Migrationen 20261007120000 und 20261008120000 (nur lesend)
--
-- Ausgabe ohne Inhalte: Version, vorhandene Objekte, Migrationsverlauf.
-- Bricht ab, wenn PostgreSQL älter als 15 ist (benötigt für
-- "on delete set null (schedule_entry_id)").
--
-- Lokal:      Teil von `pnpm db:upgrade-test`
-- Produktion: nur gemeinsam mit dem Benutzer, siehe docs/production-migration-runbook.md
-- =============================================================================
begin transaction read only;

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'PostgreSQL % ist zu alt – benötigt wird Version 15 oder neuer.',
      current_setting('server_version');
  end if;
end;
$$;

select 'postgres_version=' || current_setting('server_version');

select 'activity_sessions_vorhanden=' || (to_regclass('public.activity_sessions') is not null);

select 'daily_notes_vorhanden=' || (to_regclass('public.daily_notes') is not null);

select 'neue_user_settings_spalten=' || count(*)
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'user_settings'
   and column_name in ('weekly_sport_target_minutes', 'weekly_relationship_target_minutes',
                       'reminder_minutes_before', 'remind_at_start', 'remind_if_not_started',
                       'reminder_scope');

select 'migrationsverlauf_vorhanden='
       || (to_regclass('supabase_migrations.schema_migrations') is not null);

-- Entscheidet den Weg im Runbook (Abschnitt 4). Die Abfrage auf die Verlaufstabelle läuft
-- dynamisch (query_to_xml), damit die Prüfung auch ohne diese Tabelle funktioniert.
--   1 = Verlaufstabelle fehlt
--   2 = Tabelle vorhanden, Initialmigration 20261006120000 aber nicht eingetragen
--       (z. B. im SQL-Editor ausgeführt) – `supabase db push` würde sie erneut ausführen!
--   3 = Initialmigration korrekt eingetragen
select 'migrationsverlauf_fall=' ||
       case
         when to_regclass('supabase_migrations.schema_migrations') is null
           then '1-tabelle-fehlt'
         when (xpath('/row/n/text()', query_to_xml(
                 'select count(*) as n from supabase_migrations.schema_migrations
                   where version = ''20261006120000''', false, true, '')))[1]::text::integer = 0
           then '2-initialmigration-nicht-eingetragen'
         else '3-initialmigration-eingetragen'
       end;

-- Eingetragene Versionen als Hinweis (dynamisch, weil die Tabelle fehlen kann – z. B. wenn
-- die Initialmigration im SQL-Editor statt mit der Supabase-CLI eingespielt wurde).
do $$
declare
  v_versions text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'eingetragene_versionen=(kein Migrationsverlauf)';
  else
    execute 'select coalesce(string_agg(version, '','' order by version), '''')
               from supabase_migrations.schema_migrations'
      into v_versions;
    raise notice 'eingetragene_versionen=%', v_versions;
  end if;
end;
$$;

-- Die folgenden Abfragen lesen nur Systemkataloge (ohne to_regclass/information_schema),
-- damit sie auch bei fehlenden Schema-Rechten ein Ergebnis statt eines Fehlers liefern.

-- Spalten der Verlaufstabelle: Die Migrationen werden dort mit (version, name) eingetragen.
select 'migrationsverlauf_spalten=' || coalesce(string_agg(a.attname, ',' order by a.attnum), '')
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'supabase_migrations' and c.relname = 'schema_migrations'
   and a.attnum > 0 and not a.attisdropped;

-- Rechte der ausführenden Rolle (im Coolify-Terminal `psql -U postgres`): Die Migrationen
-- ändern user_settings und schedule_entries (Eigentümer nötig), legen Objekte in public und
-- private an, verweisen auf auth.users und nutzen private.set_updated_at() als Trigger.
-- Fehlt ein Recht, scheitert die Migration – in ihrer Transaktion, also ohne Teiländerung.
select 'ausfuehrende_rolle=' || current_user;

select 'eigentuemer_bestehender_tabellen=' || coalesce(string_agg(distinct pg_get_userbyid(c.relowner), ','), '')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('user_settings', 'schedule_entries', 'schedule_weeks', 'recurring_commitments');

with objekt as (
  select
    (select c.relowner from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'user_settings') as user_settings_owner,
    (select c.relowner from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'schedule_entries') as schedule_entries_owner,
    (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relname = 'users') as auth_users,
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'set_updated_at' and p.pronargs = 0)
      as set_updated_at,
    (select oid from pg_namespace where nspname = 'public') as schema_public,
    (select oid from pg_namespace where nspname = 'private') as schema_private,
    (select oid from pg_namespace where nspname = 'auth') as schema_auth
),
pruefung(recht, ok) as (
  select 'eigentuemer_user_settings', pg_has_role(current_user, user_settings_owner, 'member')
    from objekt
  union all
  select 'eigentuemer_schedule_entries', pg_has_role(current_user, schedule_entries_owner, 'member')
    from objekt
  union all
  -- Mehrere Rechte in einem Aufruf wären ein ODER – daher einzeln.
  select 'create_public',
         has_schema_privilege(schema_public, 'usage') and has_schema_privilege(schema_public, 'create')
    from objekt
  union all
  select 'create_private',
         has_schema_privilege(schema_private, 'usage')
         and has_schema_privilege(schema_private, 'create')
    from objekt
  union all
  select 'usage_auth', has_schema_privilege(schema_auth, 'usage') from objekt
  union all
  select 'references_auth_users', has_table_privilege(auth_users, 'references') from objekt
  union all
  select 'execute_set_updated_at', has_function_privilege(set_updated_at, 'execute') from objekt
)
select 'fehlende_rechte=' || coalesce(string_agg(recht, ',' order by recht), '')
       || E'\nrechte_fuer_migration=' || (count(*) = 0)
  from pruefung
 where not coalesce(ok, false);

commit;

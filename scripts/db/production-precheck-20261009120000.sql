-- =============================================================================
-- TagesTakt – Vorprüfung vor Migration 20261009120000 (Wochenplanung, Connector; nur lesend)
--
-- Studio-Form: Im SQL-Editor als eigene Query vollständig ausführen. Die erste Anweisung macht
-- die Transaktion schreibgeschützt; das Ergebnis der letzten Anweisung zeigt alle Werte.
-- Ausgabe ohne Inhalte: Version, vorhandene Objekte, Rechte der ausführenden Rolle.
--
-- Lokal:      Teil von `pnpm db:upgrade-test`
-- Produktion: nur gemeinsam mit dem Benutzer, siehe docs/production-migration-20261009.md
-- =============================================================================
set transaction read only;

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'PostgreSQL % ist zu alt – benötigt wird Version 15 oder neuer.',
      current_setting('server_version');
  end if;
end;
$$;

with objekte as (
  select
    to_regclass('public.activity_sessions') is not null
      and to_regclass('public.daily_notes') is not null
      and to_regprocedure('public.save_daily_note(date, text, uuid, integer)') is not null
      as vorherige_migrationen,
    to_regclass('public.planning_preferences') is not null as planning_preferences,
    to_regclass('public.planning_goal_slots') is not null as planning_goal_slots,
    (to_regprocedure('public.schedule_week_fingerprint(uuid)') is not null)::integer
      + (to_regprocedure('public.save_generated_schedule_draft(date, uuid, text, jsonb, text)')
           is not null)::integer
      + (to_regprocedure('public.publish_reviewed_schedule_week(uuid, text)') is not null)::integer
      + (to_regprocedure('public.discard_reviewed_schedule_draft(uuid, text)') is not null)::integer
      as neue_funktionen,
    exists (select 1 from pg_namespace where nspname = 'connector') as connector_schema,
    exists (select 1 from pg_roles where rolname = 'tagestakt_connector') as connector_rolle,
    (to_regprocedure('public.create_schedule_draft(date)') is not null)::integer
      + (to_regprocedure('public.add_schedule_entries(uuid, jsonb, boolean)') is not null)::integer
      + (to_regprocedure('public.publish_schedule_week(uuid)') is not null)::integer
      + (to_regprocedure('private.set_updated_at()') is not null)::integer
      as basisfunktionen
),
-- Nur Systemkataloge, damit fehlende Rechte ein Ergebnis statt eines Fehlers liefern.
ids as (
  select
    (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relname = 'users') as auth_users,
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'set_updated_at' and p.pronargs = 0)
      as set_updated_at,
    (select oid from pg_namespace where nspname = 'public') as schema_public,
    (select oid from pg_namespace where nspname = 'private') as schema_private,
    (select oid from pg_namespace where nspname = 'auth') as schema_auth,
    (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'schedule_weeks') as schedule_weeks
),
rechte(recht, ok) as (
  select 'create_public',
         has_schema_privilege(schema_public, 'usage') and has_schema_privilege(schema_public, 'create')
    from ids
  union all
  select 'usage_private', has_schema_privilege(schema_private, 'usage') from ids
  union all
  select 'execute_set_updated_at', has_function_privilege(set_updated_at, 'execute') from ids
  union all
  select 'usage_auth', has_schema_privilege(schema_auth, 'usage') from ids
  union all
  select 'references_auth_users', has_table_privilege(auth_users, 'references') from ids
  union all
  select 'references_schedule_weeks', has_table_privilege(schedule_weeks, 'references') from ids
  union all
  select 'create_schema', has_database_privilege(current_database(), 'create')
  union all
  select 'create_role', (select rolsuper or rolcreaterole from pg_roles where rolname = current_user)
  union all
  select 'grant_authenticated', pg_has_role('authenticated', 'member with admin option')
),
fehlend as (
  select coalesce(string_agg(recht, ',' order by recht), '') as liste, count(*) = 0 as alle_da
    from rechte
   where not coalesce(ok, false)
)
select zeile
  from (
    select 1 as nr, 'postgres_version=' || current_setting('server_version') as zeile
    union all
    select 2, 'ausfuehrende_rolle=' || current_user
    union all
    select 3, 'vorherige_migrationen_angewendet=' || vorherige_migrationen from objekte
    union all
    select 4, 'basisfunktionen=' || basisfunktionen || '/4' from objekte
    union all
    select 5, 'planungsregeln_vorhanden=' || (planning_preferences or planning_goal_slots)
      from objekte
    union all
    select 6, 'neue_funktionen_vorhanden=' || neue_funktionen from objekte
    union all
    select 7, 'connector_schema_vorhanden=' || connector_schema from objekte
    union all
    select 8, 'connector_rolle_vorhanden=' || connector_rolle from objekte
    union all
    select 9, 'migrationsverlauf_vorhanden='
              || (to_regclass('supabase_migrations.schema_migrations') is not null)
    union all
    select 10, 'fehlende_rechte=' || liste from fehlend
    union all
    select 11, 'bereit_fuer_20261009120000='
              || (o.vorherige_migrationen and o.basisfunktionen = 4
                  and not o.planning_preferences and not o.planning_goal_slots
                  and o.neue_funktionen = 0 and not o.connector_schema and not o.connector_rolle
                  and f.alle_da)
      from objekte o cross join fehlend f
  ) ausgabe
 order by nr;

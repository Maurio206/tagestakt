-- =============================================================================
-- TagesTakt – Vorprüfung vor der Migration 20261007120000 (nur lesend)
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

select 'neue_user_settings_spalten=' || count(*)
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'user_settings'
   and column_name in ('weekly_sport_target_minutes', 'weekly_relationship_target_minutes',
                       'reminder_minutes_before', 'remind_at_start', 'remind_if_not_started',
                       'reminder_scope');

select 'migrationsverlauf_vorhanden='
       || (to_regclass('supabase_migrations.schema_migrations') is not null);

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

commit;

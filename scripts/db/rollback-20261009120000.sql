-- =============================================================================
-- TagesTakt – Rückfall für Migration 20261009120000 (Planungsregeln, Entwürfe, Claude-Connector)
--
-- NUR im Notfall und NUR gemeinsam mit dem Benutzer (docs/production-migration-runbook.md).
-- Die Migration ist rein additiv; die bisherige Website läuft auch mit migrierter Datenbank.
-- Ein Rückfall ist deshalb normalerweise NICHT nötig – stattdessen die vorherige Website-Version
-- erneut deployen.
--
-- Entfernt ausschließlich die Objekte dieser Migration. Wochenpläne, Einträge (auch über den
-- Connector gespeicherte Entwürfe), Wiederholungen, Ziele, erfasste Aktivitäten und Tagesnotizen
-- bleiben unverändert (per Fingerabdruck prüfbar).
-- Das Schema connector (OAuth-Freigaben, Token-Hashes, Bestätigungen) und die Rolle
-- tagestakt_connector werden entfernt; Claude muss danach neu verbunden werden. Vorher die
-- Website-Variable CONNECTOR_DATABASE_URL entfernen bzw. die Website zurückrollen.
-- ACHTUNG: Gespeicherte Planungsregeln gehen verloren. Sind bereits welche vorhanden, bricht das
-- Skript ab – außer es wurde vorher in derselben Sitzung ausdrücklich bestätigt:
--
--   set tagestakt.rollback_discard_planning_rules = 'ja';
--
-- Ausführung in einer Transaktion: psql -v ON_ERROR_STOP=1 -f rollback-20261009120000.sql
-- =============================================================================
begin;

do $$
declare
  v_count bigint := 0;
  v_slots bigint := 0;
begin
  if to_regclass('public.planning_preferences') is not null then
    execute 'select count(*) from public.planning_preferences' into v_count;
  end if;
  if to_regclass('public.planning_goal_slots') is not null then
    execute 'select count(*) from public.planning_goal_slots' into v_slots;
  end if;
  if v_count + v_slots > 0
     and coalesce(current_setting('tagestakt.rollback_discard_planning_rules', true), '') <> 'ja' then
    raise exception 'Es sind % Planungsregeln gespeichert. Erst sichern und ausdrücklich bestätigen.',
      v_count + v_slots;
  end if;
end;
$$;

drop schema if exists connector cascade;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tagestakt_connector') then
    execute 'revoke authenticated from tagestakt_connector';
    execute 'drop role tagestakt_connector';
  end if;
end;
$$;

drop function if exists public.discard_reviewed_schedule_draft(uuid, text);
drop function if exists public.publish_reviewed_schedule_week(uuid, text);
drop function if exists public.save_generated_schedule_draft(date, uuid, text, jsonb, text);
drop function if exists public.schedule_week_fingerprint(uuid);
drop table if exists public.planning_goal_slots;
drop table if exists public.planning_preferences;

-- Migrationsverlauf der Supabase-CLI angleichen (falls vorhanden).
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'delete from supabase_migrations.schema_migrations where version = ''20261009120000''';
  end if;
end;
$$;

commit;

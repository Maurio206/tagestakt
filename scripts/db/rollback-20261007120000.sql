-- =============================================================================
-- TagesTakt – Rückfall für Migration 20261007120000 (Fokus-Erfassung und Ziele)
--
-- NUR im Notfall und NUR gemeinsam mit dem Benutzer (docs/production-migration-runbook.md).
-- Die Migration ist rein additiv; die bisherige Website läuft auch mit migrierter Datenbank.
-- Ein Rückfall ist deshalb normalerweise NICHT nötig – stattdessen die vorherige Website-Version
-- erneut deployen.
--
-- Entfernt ausschließlich die Objekte der Migration. Bestehende Wochenpläne, Einträge,
-- Wiederholungen und das Gewerbeziel bleiben unverändert (per Fingerabdruck prüfbar).
-- ACHTUNG: Erfasste Aktivitäten sowie Ziele für Sport/Laila und Erinnerungs-Vorgaben gehen
-- verloren. Sind bereits Aktivitäten erfasst, bricht das Skript ab – außer es wurde vorher
-- ausdrücklich bestätigt:
--
--   set tagestakt.rollback_discard_sessions = 'ja';
--
-- Ausführung in einer Transaktion: psql -v ON_ERROR_STOP=1 -f rollback-20261007120000.sql
-- =============================================================================
begin;

do $$
declare
  v_count bigint := 0;
begin
  if to_regclass('public.activity_sessions') is not null then
    execute 'select count(*) from public.activity_sessions' into v_count;
  end if;
  if v_count > 0
     and coalesce(current_setting('tagestakt.rollback_discard_sessions', true), '') <> 'ja' then
    raise exception 'Es sind % erfasste Aktivitäten vorhanden. Erst sichern und ausdrücklich bestätigen.',
      v_count;
  end if;
end;
$$;

drop function if exists public.switch_activity_session(uuid, text, text, uuid);
drop function if exists public.correct_activity_session(uuid, timestamptz, timestamptz);
drop function if exists public.stop_activity_session(uuid);
drop function if exists public.start_activity_session(text, text, uuid);
drop table if exists public.activity_sessions;
drop function if exists private.guard_activity_session();

alter table public.schedule_entries drop constraint if exists schedule_entries_id_owner_key;

alter table public.user_settings
  drop constraint if exists user_settings_sport_target_check,
  drop constraint if exists user_settings_relationship_target_check,
  drop constraint if exists user_settings_reminder_minutes_check,
  drop constraint if exists user_settings_reminder_scope_check,
  drop column if exists weekly_sport_target_minutes,
  drop column if exists weekly_relationship_target_minutes,
  drop column if exists reminder_minutes_before,
  drop column if exists remind_at_start,
  drop column if exists remind_if_not_started,
  drop column if exists reminder_scope;

-- Migrationsverlauf der Supabase-CLI angleichen (falls vorhanden).
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'delete from supabase_migrations.schema_migrations where version = ''20261007120000''';
  end if;
end;
$$;

commit;

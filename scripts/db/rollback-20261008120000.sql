-- =============================================================================
-- TagesTakt – Rückfall für Migration 20261008120000 (Tagesnotizen)
--
-- NUR im Notfall und NUR gemeinsam mit dem Benutzer (docs/production-migration-runbook.md).
-- Die Migration ist rein additiv; die bisherige Website läuft auch mit migrierter Datenbank.
-- Ein Rückfall ist deshalb normalerweise NICHT nötig – stattdessen die vorherige Website-Version
-- erneut deployen.
--
-- Entfernt ausschließlich die Objekte dieser Migration. Wochenpläne, Einträge, Wiederholungen,
-- Ziele und erfasste Aktivitäten bleiben unverändert (per Fingerabdruck prüfbar).
-- ACHTUNG: Gespeicherte Tagesnotizen gehen verloren. Sind bereits Notizen vorhanden, bricht das
-- Skript ab – außer es wurde vorher in derselben Sitzung ausdrücklich bestätigt:
--
--   set tagestakt.rollback_discard_notes = 'ja';
--
-- Reihenfolge bei einem vollständigen Rückfall: zuerst dieses Skript, danach
-- rollback-20261007120000.sql.
--
-- Ausführung in einer Transaktion: psql -v ON_ERROR_STOP=1 -f rollback-20261008120000.sql
-- =============================================================================
begin;

do $$
declare
  v_count bigint := 0;
begin
  if to_regclass('public.daily_notes') is not null then
    execute 'select count(*) from public.daily_notes' into v_count;
  end if;
  if v_count > 0
     and coalesce(current_setting('tagestakt.rollback_discard_notes', true), '') <> 'ja' then
    raise exception 'Es sind % Tagesnotizen vorhanden. Erst sichern und ausdrücklich bestätigen.',
      v_count;
  end if;
end;
$$;

drop function if exists public.save_daily_note(date, text, uuid, integer);
drop table if exists public.daily_notes;
drop function if exists private.guard_daily_note();

-- Migrationsverlauf der Supabase-CLI angleichen (falls vorhanden).
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'delete from supabase_migrations.schema_migrations where version = ''20261008120000''';
  end if;
end;
$$;

commit;

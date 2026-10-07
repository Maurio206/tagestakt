-- =============================================================================
-- TagesTakt – Fingerabdruck der bestehenden Fachdaten (nur lesend)
--
-- Gibt je Tabelle die Zeilenzahl und eine MD5-Prüfsumme über alle Spalten der
-- Initialmigration aus – keine Inhalte. Vor und nach einer Migration ausführen und
-- vergleichen: Die Ausgabe muss identisch sein.
--
-- Lokal:      pnpm db:upgrade-test (führt das automatisch aus)
-- Produktion: siehe docs/production-migration-runbook.md (nur gemeinsam mit dem Benutzer)
-- =============================================================================
select 'user_settings' as tabelle,
       count(*) as zeilen,
       md5(coalesce(string_agg(
         row(owner_id, timezone, locale, weekly_business_target_minutes, created_at, updated_at)::text,
         '|' order by owner_id), '')) as pruefsumme
  from public.user_settings
union all
select 'recurring_commitments',
       count(*),
       md5(coalesce(string_agg(
         row(id, owner_id, title, category, weekday, start_time, end_time, location, note, active,
             created_at, updated_at)::text,
         '|' order by id), ''))
  from public.recurring_commitments
union all
select 'schedule_weeks',
       count(*),
       md5(coalesce(string_agg(
         row(id, owner_id, week_start, version, status, planning_note, published_at, created_at,
             updated_at)::text,
         '|' order by id), ''))
  from public.schedule_weeks
union all
select 'schedule_entries',
       count(*),
       md5(coalesce(string_agg(
         row(id, owner_id, schedule_week_id, title, category, start_at, end_at, location, note, source,
             completion_status, created_at, updated_at)::text,
         '|' order by id), ''))
  from public.schedule_entries
order by 1;

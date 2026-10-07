-- =============================================================================
-- TagesTakt – Upgrade-Test: Prüfungen nach der Migration (NUR lokal)
--
-- Läuft als angemeldeter Fixture-Benutzer (Rolle authenticated, RLS aktiv) in einer
-- Transaktion, die am Ende zurückgerollt wird. Jede fehlgeschlagene Prüfung bricht ab.
-- =============================================================================
begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"0d3e0000-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);

do $$
declare
  v_settings public.user_settings;
  v_published uuid;
  v_draft uuid;
  v_business_entry uuid;
  v_session public.activity_sessions;
  v_count integer;
begin
  -- 1. Bestehende Einstellungen bleiben, neue Felder haben neutrale Standardwerte.
  select * into strict v_settings from public.user_settings;
  assert v_settings.weekly_business_target_minutes = 1200, 'Gewerbeziel verändert';
  assert v_settings.weekly_sport_target_minutes is null, 'Sportziel nicht leer';
  assert v_settings.weekly_relationship_target_minutes is null, 'Beziehungsziel nicht leer';
  assert v_settings.reminder_minutes_before = 10, 'Vorlauf-Standard falsch';
  assert v_settings.remind_at_start and not v_settings.remind_if_not_started,
    'Erinnerungs-Standards falsch';
  assert v_settings.reminder_scope = 'important', 'Erinnerungsumfang falsch';

  -- 2. Wiederholung und veröffentlichte KW 42 sind unverändert sichtbar.
  select count(*) into v_count from public.recurring_commitments where active;
  assert v_count = 1, 'Wiederholung fehlt';
  select id into strict v_published
    from public.schedule_weeks
   where week_start = date '2026-10-12' and status = 'published' and version = 1;
  select count(*) into v_count from public.schedule_entries where schedule_week_id = v_published;
  assert v_count = 5, 'Einträge der KW 42 fehlen';

  -- 3. Bestehende Abläufe funktionieren weiter: Entwurf aus veröffentlichter Woche, Veröffentlichen.
  v_draft := (public.create_schedule_draft(date '2026-10-12')).id;
  select count(*) into v_count from public.schedule_entries where schedule_week_id = v_draft;
  assert v_count = 5, 'Entwurf übernimmt die Einträge nicht';
  perform public.publish_schedule_week(v_draft);
  assert (select status from public.schedule_weeks where id = v_published) = 'archived',
    'Version 1 wurde nicht archiviert';

  -- 4. Neue Funktionen: Aktivität zu einem (jetzt archivierten) Gewerbeblock starten und beenden.
  select id into strict v_business_entry
    from public.schedule_entries
   where schedule_week_id = v_published and category = 'business';
  v_session := public.start_activity_session('business', null, v_business_entry);
  assert v_session.ended_at is null and v_session.title = 'Kundenprojekt (Beispiel)',
    'Start fehlerhaft';
  -- Atomarer Wechsel: danach läuft genau eine Aktivität (die neue).
  v_session := public.switch_activity_session(v_session.id, 'sport', 'Laufen (Beispiel)');
  select count(*) into v_count from public.activity_sessions where ended_at is null;
  assert v_count = 1 and v_session.goal_category = 'sport', 'Wechsel fehlerhaft';
  v_session := public.stop_activity_session(v_session.id);
  assert v_session.ended_at > v_session.started_at, 'Beenden fehlerhaft';
  select count(*) into v_count from public.activity_sessions where corrected_at is not null;
  assert v_count = 0, 'Normale Erfassung als korrigiert markiert';

  -- 5. Nachtragen wird als Korrektur gekennzeichnet.
  insert into public.activity_sessions (goal_category, title, started_at, ended_at)
  values ('sport', 'Laufen (Beispiel)', now() - interval '26 hours', now() - interval '25 hours')
  returning * into v_session;
  assert v_session.corrected_at is not null, 'Nachtrag nicht gekennzeichnet';

  raise notice 'Upgrade-Nachprüfung erfolgreich';
end;
$$;

rollback;

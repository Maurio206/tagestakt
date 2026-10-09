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
  v_note public.daily_notes;
  v_count integer;
  v_week public.schedule_weeks;
  v_live uuid;
  v_fingerprint text;
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

  -- 2a. Tagesnotiz für einen Tag der KW 42 anlegen (gehört zum Tag, nicht zur Planversion).
  select * into strict v_note
    from public.save_daily_note(date '2026-10-14', E'Beispielnotiz\nZweite Zeile');
  assert v_note.revision = 1 and v_note.content = E'Beispielnotiz\nZweite Zeile',
    'Tagesnotiz nicht gespeichert';

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

  -- 4a. Die Tagesnotiz hat den Versionswechsel unverändert überstanden.
  assert (select revision = 1 and content = v_note.content
            from public.daily_notes where id = v_note.id),
    'Tagesnotiz durch neue Planversion verändert';

  -- 4b. Speichern nur auf dem zuletzt gelesenen Stand; leerer Inhalt entfernt die Notiz.
  select * into strict v_note
    from public.save_daily_note(date '2026-10-14', 'Geändert (Beispiel)', v_note.id, 1);
  assert v_note.revision = 2, 'Fassung nicht erhöht';
  begin
    perform * from public.save_daily_note(date '2026-10-14', 'Veraltet', v_note.id, 1);
    raise exception 'veralteter Stand nicht erkannt';
  exception when sqlstate 'TT007' then
    null;
  end;
  perform * from public.save_daily_note(date '2026-10-14', '   ', v_note.id, 2);
  assert not exists (select 1 from public.daily_notes where note_date = date '2026-10-14'),
    'leere Notiz nicht entfernt';

  -- 5. Nachtragen wird als Korrektur gekennzeichnet.
  insert into public.activity_sessions (goal_category, title, started_at, ended_at)
  values ('sport', 'Laufen (Beispiel)', now() - interval '26 hours', now() - interval '25 hours')
  returning * into v_session;
  assert v_session.corrected_at is not null, 'Nachtrag nicht gekennzeichnet';

  -- 6. Wochenplaner (20261009120000): Regeln speichern (owner_id setzt die Datenbank),
  --    Entwurf atomar erzeugen, veröffentlichte Version bleibt bis zur Freigabe unverändert.
  insert into public.planning_preferences (
    business_earliest_start, business_latest_end, business_min_block_minutes,
    business_max_block_minutes, business_max_daily_minutes, business_saturday_max_minutes,
    business_sunday_max_minutes, buffer_minutes)
  values ('08:00', '20:00', 60, 180, 240, 0, 0, 15);
  insert into public.planning_goal_slots (goal_category, weekday, requirement, title,
                                          duration_minutes, window_start, window_end)
  values ('sport', 2, 'required', 'Training (Beispiel)', 60, '18:00', '21:00');
  assert (select count(*) from public.planning_goal_slots
           where owner_id = '0d3e0000-0000-4000-8000-0000000000a1') = 1,
    'Zeitfenster nicht dem Benutzer zugeordnet';

  select id into strict v_live
    from public.schedule_weeks where week_start = date '2026-10-12' and status = 'published';
  v_week := public.save_generated_schedule_draft(
    date '2026-10-12', null, null,
    '[{"title":"Gewerbe-Fokus","category":"business","start_at":"2026-10-13T07:00:00Z",
       "end_at":"2026-10-13T10:00:00Z","location":null,"note":"Beispiel","source":"agent"}]'::jsonb,
    'Vorschlag des Claude-Wochenplaners (Beispiel)');
  assert v_week.status = 'draft', 'Planer-Entwurf ist kein Entwurf';
  assert (select count(*) from public.schedule_entries where schedule_week_id = v_week.id) = 1,
    'Planer-Entwurf ersetzt die Einträge nicht';
  assert (select status from public.schedule_weeks where id = v_live) = 'published',
    'veröffentlichte Version durch den Entwurf verändert';
  select count(*) into v_count from public.schedule_entries where schedule_week_id = v_live;
  assert v_count = 5, 'Einträge der veröffentlichten Version verändert';

  v_fingerprint := public.schedule_week_fingerprint(v_week.id);
  perform public.publish_reviewed_schedule_week(v_week.id, v_fingerprint);
  -- Doppelklick: zweites Veröffentlichen ist harmlos.
  perform public.publish_reviewed_schedule_week(v_week.id, v_fingerprint);
  assert (select status from public.schedule_weeks where id = v_live) = 'archived',
    'bisherige Version nicht archiviert';
  select count(*) into v_count
    from public.schedule_weeks where week_start = date '2026-10-12' and status = 'published';
  assert v_count = 1, 'nicht genau eine veröffentlichte Version';

  raise notice 'Upgrade-Nachprüfung erfolgreich';
end;
$$;

rollback;

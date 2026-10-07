-- =============================================================================
-- TagesTakt – NUR für die lokale Entwicklung (`supabase db reset`).
--
-- Enthält ausschließlich frei erfundene, neutrale Beispieldaten.
-- Niemals echte Termine, Namen oder Orte eintragen und niemals gegen das
-- Produktivprojekt ausführen.
--
-- Der Demo-Benutzer erhält ein zufälliges, unbekanntes Passwort. Ein eigenes
-- lokales Passwort setzt du wie in docs/setup.md beschrieben.
-- =============================================================================

do $$
declare
  v_user constant uuid := '0d3e0000-0000-4000-8000-000000000001';
  v_email constant text := 'demo@tagestakt.test';
  v_tz constant text := 'Europe/Berlin';
  v_monday date := date_trunc('week', now() at time zone v_tz)::date;
  v_current_week uuid;
  v_next_week uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user, v_user::text,
    jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.user_settings (owner_id) values (v_user);

  -- Wiederkehrende Beispieltermine
  insert into public.recurring_commitments (owner_id, title, category, weekday, start_time, end_time)
  select v_user, 'Dienst (Beispiel)', 'duty', d, time '08:00', time '14:00' from generate_series(1, 5) d
  union all
  select v_user, 'Gewerbe-Fokusblock (Beispiel)', 'business', d, time '15:30', time '19:30' from generate_series(1, 5) d
  union all
  select v_user, 'Training (Beispiel)', 'sport', d, time '19:45', time '20:45' from unnest(array[1, 3, 5]) d
  union all
  select v_user, 'Schlaf (Beispiel)', 'sleep', d, time '22:30', time '06:30' from generate_series(1, 7) d;

  -- Aktuelle Woche: Entwurf anlegen, befüllen, veröffentlichen
  insert into public.schedule_weeks (owner_id, week_start, planning_note)
  values (v_user, v_monday, 'Beispielwoche – frei erfundene Daten')
  returning id into v_current_week;

  insert into public.schedule_entries (
    owner_id, schedule_week_id, title, category, start_at, end_at, source, completion_status
  )
  select
    v_user,
    v_current_week,
    t.title,
    t.category,
    ((v_monday + d.day_offset) + t.start_time) at time zone v_tz,
    ((v_monday + d.day_offset + case when t.next_day then 1 else 0 end) + t.end_time) at time zone v_tz,
    t.source,
    case
      when t.category = 'business'
       and ((v_monday + d.day_offset + case when t.next_day then 1 else 0 end) + t.end_time)
           at time zone v_tz < now()
      then 'completed'
      else 'planned'
    end
  from generate_series(0, 6) as d(day_offset)
  join (values
    -- Wochentage: 1-5 = Mo–Fr, 6-7 = Sa–So
    (array[1,2,3,4,5,6,7], 'Morgenroutine (Beispiel)',        'hygiene',      time '06:30', time '07:00', false, 'manual'),
    (array[1,2,3,4,5],     'Fahrt zum Dienst (Beispiel)',     'commute',      time '07:15', time '07:45', false, 'manual'),
    (array[1,2,3,4,5],     'Dienst (Beispiel)',               'duty',         time '08:00', time '14:00', false, 'recurring'),
    (array[1,2,3,4,5],     'Rückfahrt (Beispiel)',            'commute',      time '14:15', time '14:45', false, 'manual'),
    (array[1,2,3,4,5],     'Mittagessen (Beispiel)',          'meal',         time '15:00', time '15:30', false, 'manual'),
    (array[1,2,3,4,5],     'Gewerbe-Fokusblock (Beispiel)',   'business',     time '15:30', time '19:30', false, 'recurring'),
    (array[1,3,5],         'Training (Beispiel)',             'sport',        time '19:45', time '20:45', false, 'recurring'),
    (array[2],             'Wocheneinkauf (Beispiel)',        'shopping',     time '19:45', time '20:30', false, 'manual'),
    (array[3],             'Beispieltermin mit Überschneidung', 'appointment', time '12:00', time '12:30', false, 'manual'),
    (array[1,2,3,4,5,6,7], 'Abendessen (Beispiel)',           'meal',         time '21:00', time '21:45', false, 'manual'),
    (array[6,7],           'Frühstück (Beispiel)',            'meal',         time '09:00', time '10:00', false, 'manual'),
    (array[6,7],           'Gemeinsame Zeit (Beispiel)',      'relationship', time '11:00', time '17:00', false, 'manual'),
    (array[6,7],           'Freizeit (Beispiel)',             'leisure',      time '18:00', time '20:00', false, 'manual'),
    (array[1,2,3,4,5,6,7], 'Abendroutine (Beispiel)',         'hygiene',      time '22:00', time '22:30', false, 'manual'),
    (array[1,2,3,4,5,6,7], 'Schlaf (Beispiel)',               'sleep',        time '22:30', time '06:30', true,  'recurring')
  ) as t(weekdays, title, category, start_time, end_time, next_day, source)
    on (d.day_offset + 1) = any (t.weekdays);

  update public.schedule_weeks set status = 'published' where id = v_current_week;

  -- Nächste Woche: nur ein Entwurf
  insert into public.schedule_weeks (owner_id, week_start, planning_note)
  values (v_user, v_monday + 7, 'Entwurf – noch nicht veröffentlicht')
  returning id into v_next_week;

  insert into public.schedule_entries (owner_id, schedule_week_id, title, category, start_at, end_at)
  values
    (v_user, v_next_week, 'Dienst (Beispiel)', 'duty',
      ((v_monday + 7) + time '08:00') at time zone v_tz, ((v_monday + 7) + time '14:00') at time zone v_tz),
    (v_user, v_next_week, 'Gewerbe-Fokusblock (Beispiel)', 'business',
      ((v_monday + 7) + time '15:30') at time zone v_tz, ((v_monday + 7) + time '19:30') at time zone v_tz);

  -- Erfasste Zeiten (Plan vs. Ist) für bereits vergangene Zielblöcke der aktuellen Woche.
  -- Nur wenn die Tabelle existiert (der Upgrade-Test setzt auf die Initialmigration zurück).
  -- Der Integritäts-Trigger wird kurz deaktiviert, damit die Beispielzeiten nicht als
  -- „nachgetragen“ markiert werden – ausschließlich in dieser lokalen Seed-Datei.
  if to_regclass('public.activity_sessions') is not null then
    alter table public.activity_sessions disable trigger activity_sessions_guard;

    insert into public.activity_sessions (
      owner_id, schedule_entry_id, goal_category, title, started_at, ended_at
    )
    select v_user, e.id, e.category, e.title,
           e.start_at + interval '10 minutes',
           e.end_at - case e.category when 'business' then interval '25 minutes'
                                      else interval '5 minutes' end
      from public.schedule_entries e
     where e.schedule_week_id = v_current_week
       and e.category in ('business', 'sport', 'relationship')
       and e.end_at < now();

    alter table public.activity_sessions enable trigger activity_sessions_guard;
  end if;
end;
$$;

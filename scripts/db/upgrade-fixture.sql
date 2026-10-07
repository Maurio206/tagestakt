-- =============================================================================
-- TagesTakt – Upgrade-Test: Daten in der Form des Produktionsstands (frei erfunden)
--
-- NUR lokal. Wird von scripts/db-upgrade-test.mjs nach `supabase db reset --version
-- 20261006120000` ausgeführt, also auf dem Schema der Initialmigration. Bildet die Form der
-- produktiven Daten nach (Einstellungen mit 20-h-Ziel, aktive Wiederholung am Montag
-- 07:00–16:30, KW 42 als veröffentlichte Version 1) – ohne echte Inhalte.
-- =============================================================================
do $$
declare
  v_user constant uuid := '0d3e0000-0000-4000-8000-0000000000a1';
  v_email constant text := 'upgrade@tagestakt.test';
  v_tz constant text := 'Europe/Berlin';
  v_monday constant date := date '2026-10-12';
  v_week uuid;
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

  insert into public.user_settings (owner_id, weekly_business_target_minutes)
  values (v_user, 1200);

  insert into public.recurring_commitments (owner_id, title, category, weekday, start_time, end_time)
  values (v_user, 'Dienst (Beispiel)', 'duty', 1, time '07:00', time '16:30');

  insert into public.schedule_weeks (owner_id, week_start, planning_note)
  values (v_user, v_monday, 'Upgrade-Test (Beispiel)')
  returning id into v_week;

  insert into public.schedule_entries (
    owner_id, schedule_week_id, title, category, start_at, end_at, source
  ) values
    (v_user, v_week, 'Dienst (Beispiel)', 'duty',
      (v_monday + time '07:00') at time zone v_tz, (v_monday + time '16:30') at time zone v_tz,
      'recurring'),
    (v_user, v_week, 'Kundenprojekt (Beispiel)', 'business',
      (v_monday + time '17:30') at time zone v_tz, (v_monday + time '19:30') at time zone v_tz,
      'manual'),
    (v_user, v_week, 'Krafttraining (Beispiel)', 'sport',
      ((v_monday + 1) + time '18:00') at time zone v_tz,
      ((v_monday + 1) + time '19:00') at time zone v_tz, 'manual'),
    (v_user, v_week, 'Gemeinsamer Abend (Beispiel)', 'relationship',
      ((v_monday + 5) + time '18:00') at time zone v_tz,
      ((v_monday + 5) + time '22:00') at time zone v_tz, 'manual'),
    (v_user, v_week, 'Schlaf (Beispiel)', 'sleep',
      ((v_monday + 6) + time '23:00') at time zone v_tz,
      ((v_monday + 7) + time '06:30') at time zone v_tz, 'manual');

  update public.schedule_weeks set status = 'published' where id = v_week;
end;
$$;

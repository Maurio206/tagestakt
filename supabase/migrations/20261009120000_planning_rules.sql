-- =============================================================================
-- TagesTakt – Planungsregeln und geprüftes Veröffentlichen (Claude-Wochenplaner)
--
-- Rein additiv:
--   * neue Tabelle planning_preferences (eine Zeile je Benutzer): Rahmen für Gewerbeblöcke
--     und Pausen zwischen Blöcken,
--   * neue Tabelle planning_goal_slots: Zeitfenster für Sport- und Beziehungsblöcke je
--     Wochentag (verbindlich oder optional, mit fester Dauer),
--   * neue RPCs schedule_week_fingerprint, save_generated_schedule_draft und
--     publish_reviewed_schedule_week,
--   * keine bestehende Tabelle, Spalte, Funktion oder Policy wird geändert.
--
-- Der Planer speichert ausschließlich Entwürfe. Ein erzeugter Vorschlag ersetzt höchstens den
-- eigenen Entwurf der Woche – und nur, wenn dieser seit dem Start der Planung unverändert ist
-- (Fingerabdruck). Veröffentlicht wird nur genau der geprüfte Stand. Veröffentlichte und
-- archivierte Versionen bleiben unberührt (bestehende Trigger).
--
-- Grundsätze wie bisher: RLS mit vier getrennten Policies, explizite Grants (anon erhält
-- nichts), RPCs als SECURITY INVOKER mit leerem search_path, keine Inhalte in Fehlermeldungen.
-- =============================================================================

-- =============================================================================
-- 1. Tabellen
-- =============================================================================
create table public.planning_preferences (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Gewerbe nur innerhalb dieses täglichen Rahmens (Ortszeit Europe/Berlin, gleicher Tag).
  business_earliest_start time not null,
  business_latest_end time not null,
  business_min_block_minutes smallint not null,
  business_max_block_minutes smallint not null,
  -- Höchstens so viel Gewerbe je Werktag (Montag–Freitag).
  business_max_daily_minutes smallint not null,
  -- Gewerbe am Wochenende: 0 = keines.
  business_saturday_max_minutes smallint not null default 0,
  business_sunday_max_minutes smallint not null default 0,
  -- Pause bzw. Wechselzeit zwischen zwei Blöcken.
  buffer_minutes smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_preferences_business_window_check
    check (business_latest_end > business_earliest_start),
  constraint planning_preferences_block_min_check
    check (business_min_block_minutes between 15 and 480),
  constraint planning_preferences_block_max_check
    check (business_max_block_minutes between business_min_block_minutes and 720),
  constraint planning_preferences_daily_max_check
    check (business_max_daily_minutes between business_min_block_minutes and 960),
  constraint planning_preferences_window_length_check
    check (extract(epoch from (business_latest_end - business_earliest_start)) / 60
           >= business_min_block_minutes),
  constraint planning_preferences_saturday_check
    check (business_saturday_max_minutes = 0
           or business_saturday_max_minutes between business_min_block_minutes and 960),
  constraint planning_preferences_sunday_check
    check (business_sunday_max_minutes = 0
           or business_sunday_max_minutes between business_min_block_minutes and 960),
  constraint planning_preferences_buffer_check check (buffer_minutes between 0 and 120)
);

comment on table public.planning_preferences is
  'Persönlicher Rahmen für den Wochenplaner: Gewerbezeiten, Blocklängen, Tageshöchstwerte, Pausen.';

create table public.planning_goal_slots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_category text not null,
  weekday smallint not null,
  -- required = muss geplant werden; optional = nur bei ausreichend freier Zeit.
  requirement text not null,
  -- Sichtbarer Titel des geplanten Blocks (wird nicht an das Sprachmodell übertragen).
  title text not null,
  duration_minutes smallint not null,
  window_start time not null,
  window_end time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Höchstens ein Block je Ziel und Wochentag (dient zugleich als Index für owner_id).
  constraint planning_goal_slots_owner_goal_weekday_key unique (owner_id, goal_category, weekday),
  constraint planning_goal_slots_goal_check check (goal_category in ('sport', 'relationship')),
  constraint planning_goal_slots_weekday_check check (weekday between 1 and 7),
  constraint planning_goal_slots_requirement_check check (requirement in ('required', 'optional')),
  constraint planning_goal_slots_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint planning_goal_slots_duration_check check (duration_minutes between 15 and 720),
  constraint planning_goal_slots_window_check check (window_end > window_start),
  constraint planning_goal_slots_window_length_check
    check (extract(epoch from (window_end - window_start)) / 60 >= duration_minutes)
);

comment on table public.planning_goal_slots is
  'Zeitfenster je Wochentag für Sport- und Beziehungsblöcke (Dauer fest, Lage wählt der Planer).';

create trigger planning_preferences_set_updated_at
  before update on public.planning_preferences
  for each row execute function private.set_updated_at();

create trigger planning_goal_slots_set_updated_at
  before update on public.planning_goal_slots
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 2. Grants und Row Level Security
-- =============================================================================
revoke all on table public.planning_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.planning_preferences to authenticated;
grant all on table public.planning_preferences to service_role;

revoke all on table public.planning_goal_slots from public, anon, authenticated;
grant select, insert, update, delete on table public.planning_goal_slots to authenticated;
grant all on table public.planning_goal_slots to service_role;

alter table public.planning_preferences enable row level security;
alter table public.planning_goal_slots enable row level security;

create policy "planning_preferences: eigene lesen" on public.planning_preferences
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "planning_preferences: eigene anlegen" on public.planning_preferences
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "planning_preferences: eigene ändern" on public.planning_preferences
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "planning_preferences: eigene löschen" on public.planning_preferences
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "planning_goal_slots: eigene lesen" on public.planning_goal_slots
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "planning_goal_slots: eigene anlegen" on public.planning_goal_slots
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "planning_goal_slots: eigene ändern" on public.planning_goal_slots
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "planning_goal_slots: eigene löschen" on public.planning_goal_slots
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- =============================================================================
-- 3. RPC: Fingerabdruck einer Wochenversion (nur lesend)
-- =============================================================================
-- Prüfsumme über Woche, Version und alle Einträge (inklusive updated_at). Ändert sich ein
-- Eintrag, kommt einer hinzu oder fällt einer weg, ändert sich der Fingerabdruck. Der Status
-- gehört bewusst nicht dazu: Veröffentlichen ändert den Fingerabdruck nicht.
create function public.schedule_week_fingerprint(p_week_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_week public.schedule_weeks;
  v_payload text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;

  select * into v_week
    from public.schedule_weeks
   where id = p_week_id and owner_id = auth.uid();
  if not found then
    raise exception 'Wochenplan nicht gefunden' using errcode = 'no_data_found';
  end if;

  select coalesce(string_agg(
           concat_ws('|', e.id::text, e.title, e.category,
                     extract(epoch from e.start_at)::text, extract(epoch from e.end_at)::text,
                     coalesce(e.location, ''), coalesce(e.note, ''), e.source,
                     e.completion_status, extract(epoch from e.updated_at)::text),
           E'\n' order by e.start_at, e.end_at, e.id), '')
    into v_payload
    from public.schedule_entries e
   where e.schedule_week_id = v_week.id;

  return encode(
    sha256(convert_to(
      v_week.id::text || ':' || v_week.week_start::text || ':' || v_week.version::text
        || E'\n' || v_payload,
      'UTF8')),
    'hex');
end;
$$;

-- =============================================================================
-- 4. RPC: erzeugten Vorschlag als Entwurf speichern (atomar)
-- =============================================================================
-- Legt bei Bedarf den Entwurf der Woche an (nächste Version, Kopie der veröffentlichten) und
-- ersetzt dessen Einträge vollständig durch den geprüften Vorschlag – alles in einer
-- Transaktion. Bestand beim Start der Planung bereits ein Entwurf, muss er unverändert sein
-- (ID + Fingerabdruck); sonst wird nichts geschrieben (SQLSTATE TT008). Bestand keiner, darf
-- inzwischen auch keiner entstanden sein. Erlaubte Herkunft: recurring und agent.
create function public.save_generated_schedule_draft(
  p_week_start date,
  p_expected_draft_id uuid,
  p_expected_fingerprint text,
  p_entries jsonb,
  p_planning_note text default null
)
returns public.schedule_weeks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_draft public.schedule_weeks;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Der Wochenbeginn muss ein Montag sein' using errcode = 'invalid_parameter_value';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array'
     or jsonb_array_length(p_entries) not between 1 and 300 then
    raise exception 'Der Vorschlag muss 1 bis 300 Einträge enthalten'
      using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) as e(item)
     where jsonb_typeof(e.item) <> 'object'
        or coalesce(e.item ->> 'source', '') not in ('recurring', 'agent')
  ) then
    raise exception 'Ungültige Herkunft eines Eintrags' using errcode = 'invalid_parameter_value';
  end if;
  if (p_expected_draft_id is null) <> (p_expected_fingerprint is null) then
    raise exception 'Ungültiger Bearbeitungsstand' using errcode = 'invalid_parameter_value';
  end if;

  -- Gleichzeitige Planungen bzw. Veröffentlichungen derselben Woche nacheinander verarbeiten.
  perform pg_advisory_xact_lock(
    hashtextextended('tagestakt.schedule_week:' || v_owner::text || ':' || p_week_start::text, 0)
  );

  select * into v_draft
    from public.schedule_weeks
   where owner_id = v_owner and week_start = p_week_start and status = 'draft'
     for update;

  if found then
    if p_expected_draft_id is distinct from v_draft.id
       or p_expected_fingerprint is distinct from public.schedule_week_fingerprint(v_draft.id) then
      raise exception 'Der Entwurf wurde inzwischen geändert.' using errcode = 'TT008';
    end if;
  else
    if p_expected_draft_id is not null then
      raise exception 'Der Entwurf wurde inzwischen geändert.' using errcode = 'TT008';
    end if;
    select * into v_draft from public.create_schedule_draft(p_week_start);
  end if;

  perform public.add_schedule_entries(v_draft.id, p_entries, true);

  update public.schedule_weeks
     set planning_note = p_planning_note
   where id = v_draft.id
  returning * into v_draft;

  return v_draft;
end;
$$;

-- =============================================================================
-- 5. RPC: geprüften Stand veröffentlichen (atomar, idempotent)
-- =============================================================================
-- Veröffentlicht den Entwurf nur, wenn sein Fingerabdruck dem geprüften Stand entspricht
-- (sonst TT008). Ist genau dieser Stand bereits veröffentlicht (doppelter Klick), wird er
-- unverändert zurückgegeben. Archivieren und Veröffentlichen übernimmt publish_schedule_week.
create function public.publish_reviewed_schedule_week(p_week_id uuid, p_expected_fingerprint text)
returns public.schedule_weeks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_week public.schedule_weeks;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  if p_expected_fingerprint is null or p_expected_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Ungültiger Prüfstand' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_week
    from public.schedule_weeks
   where id = p_week_id and owner_id = v_owner;
  if not found then
    raise exception 'Wochenplan nicht gefunden' using errcode = 'no_data_found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('tagestakt.schedule_week:' || v_owner::text || ':' || v_week.week_start::text, 0)
  );

  select * into v_week
    from public.schedule_weeks
   where id = p_week_id and owner_id = v_owner
     for update;

  if public.schedule_week_fingerprint(v_week.id) <> p_expected_fingerprint then
    raise exception 'Der Entwurf wurde seit der Prüfung geändert.' using errcode = 'TT008';
  end if;
  if v_week.status = 'published' then
    return v_week;
  end if;
  if v_week.status <> 'draft' then
    raise exception 'Nur Entwürfe können veröffentlicht werden' using errcode = 'raise_exception';
  end if;

  select * into v_week from public.publish_schedule_week(v_week.id);
  return v_week;
end;
$$;

revoke all on function public.schedule_week_fingerprint(uuid) from public, anon;
revoke all on function public.save_generated_schedule_draft(date, uuid, text, jsonb, text)
  from public, anon;
revoke all on function public.publish_reviewed_schedule_week(uuid, text) from public, anon;

grant execute on function public.schedule_week_fingerprint(uuid) to authenticated, service_role;
grant execute on function public.save_generated_schedule_draft(date, uuid, text, jsonb, text)
  to authenticated, service_role;
grant execute on function public.publish_reviewed_schedule_week(uuid, text)
  to authenticated, service_role;

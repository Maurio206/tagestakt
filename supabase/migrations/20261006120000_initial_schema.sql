-- =============================================================================
-- TagesTakt – initiales Schema
--
-- Grundsätze:
--   * Jede fachliche Zeile hat eine owner_id (auth.users.id).
--   * RLS ist auf jeder Tabelle aktiv; getrennte Policies für SELECT/INSERT/UPDATE/DELETE.
--   * Explizite Grants: anon erhält nichts, authenticated nur CRUD auf die eigenen Tabellen.
--   * Keine Views, keine SECURITY-DEFINER-Funktionen im exponierten Schema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Härtung der Standardrechte: neue Objekte in "public" sind nicht automatisch
-- für anon/authenticated erreichbar. Jede neue Tabelle braucht explizite Grants.
-- -----------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Internes Schema für Trigger-Funktionen; wird nicht über die Data API exponiert.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Hilfsfunktion: updated_at zuverlässig setzen
-- -----------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- user_settings
-- =============================================================================
create table public.user_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  timezone text not null default 'Europe/Berlin',
  locale text not null default 'de-DE',
  weekly_business_target_minutes integer not null default 1200,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- MVP: Die gesamte Zeitlogik ist auf Europe/Berlin ausgelegt.
  constraint user_settings_timezone_check check (timezone = 'Europe/Berlin'),
  constraint user_settings_locale_check check (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  constraint user_settings_target_check
    check (weekly_business_target_minutes between 0 and 10080)
);

comment on table public.user_settings is
  'Persönliche Einstellungen (genau eine Zeile pro Benutzer).';
comment on column public.user_settings.weekly_business_target_minutes is
  'Wöchentliches Gewerbeziel in Minuten (Standard 1200 = 20 Stunden).';

-- =============================================================================
-- recurring_commitments
-- =============================================================================
create table public.recurring_commitments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  category text not null,
  weekday smallint not null,
  start_time time not null,
  end_time time not null,
  location text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_commitments_title_check
    check (char_length(btrim(title)) between 1 and 120),
  constraint recurring_commitments_category_check check (category in (
    'duty', 'business', 'relationship', 'sport', 'shopping', 'meal',
    'hygiene', 'commute', 'leisure', 'sleep', 'appointment', 'other'
  )),
  -- ISO-Wochentag: 1 = Montag … 7 = Sonntag
  constraint recurring_commitments_weekday_check check (weekday between 1 and 7),
  -- end_time <= start_time bedeutet bewusst: endet am Folgetag (z. B. Schlaf).
  constraint recurring_commitments_time_check check (end_time <> start_time),
  constraint recurring_commitments_location_check
    check (location is null or char_length(location) <= 120),
  constraint recurring_commitments_note_check
    check (note is null or char_length(note) <= 1000)
);

comment on table public.recurring_commitments is
  'Wiederkehrende Termine als Vorlage für Wochenentwürfe.';
comment on column public.recurring_commitments.end_time is
  'Liegt end_time vor oder auf start_time, endet der Block am Folgetag.';

create index recurring_commitments_owner_weekday_idx
  on public.recurring_commitments (owner_id, weekday, start_time);

-- =============================================================================
-- schedule_weeks
-- =============================================================================
create table public.schedule_weeks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start date not null,
  version integer not null default 1,
  status text not null default 'draft',
  planning_note text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_weeks_week_start_monday_check check (extract(isodow from week_start) = 1),
  constraint schedule_weeks_version_check check (version > 0),
  constraint schedule_weeks_status_check check (status in ('draft', 'published', 'archived')),
  constraint schedule_weeks_published_at_check
    check (status = 'draft' or published_at is not null),
  constraint schedule_weeks_planning_note_check
    check (planning_note is null or char_length(planning_note) <= 2000),
  constraint schedule_weeks_owner_week_version_key unique (owner_id, week_start, version),
  -- Ziel des zusammengesetzten Fremdschlüssels aus schedule_entries.
  constraint schedule_weeks_id_owner_key unique (id, owner_id)
);

comment on table public.schedule_weeks is
  'Versionierte Wochenpläne. Pro Woche höchstens ein Entwurf und eine veröffentlichte Version.';

create unique index schedule_weeks_one_published_idx
  on public.schedule_weeks (owner_id, week_start)
  where status = 'published';

create unique index schedule_weeks_one_draft_idx
  on public.schedule_weeks (owner_id, week_start)
  where status = 'draft';

-- =============================================================================
-- schedule_entries
-- =============================================================================
create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  schedule_week_id uuid not null,
  title text not null,
  category text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text,
  note text,
  source text not null default 'manual',
  completion_status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Zusammengesetzter Fremdschlüssel: ein Eintrag kann nur einem Wochenplan
  -- desselben Eigentümers zugeordnet werden.
  constraint schedule_entries_week_owner_fkey foreign key (schedule_week_id, owner_id)
    references public.schedule_weeks (id, owner_id) on delete cascade,
  constraint schedule_entries_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint schedule_entries_category_check check (category in (
    'duty', 'business', 'relationship', 'sport', 'shopping', 'meal',
    'hygiene', 'commute', 'leisure', 'sleep', 'appointment', 'other'
  )),
  constraint schedule_entries_time_order_check check (end_at > start_at),
  constraint schedule_entries_max_duration_check check (end_at - start_at <= interval '24 hours'),
  constraint schedule_entries_source_check check (source in ('manual', 'recurring', 'agent')),
  constraint schedule_entries_completion_check
    check (completion_status in ('planned', 'completed', 'skipped')),
  constraint schedule_entries_location_check
    check (location is null or char_length(location) <= 120),
  constraint schedule_entries_note_check check (note is null or char_length(note) <= 1000)
);

comment on table public.schedule_entries is
  'Zeitblöcke eines Wochenplans. Überschneidungen sind erlaubt und werden in der UI gewarnt.';

create index schedule_entries_week_owner_idx
  on public.schedule_entries (schedule_week_id, owner_id);
create index schedule_entries_owner_start_idx
  on public.schedule_entries (owner_id, start_at);

-- =============================================================================
-- Integritäts-Trigger
-- =============================================================================

-- Statusmodell der Wochenpläne:
--   * neu angelegt wird immer als Entwurf (auch ein späterer Agent kann nichts direkt veröffentlichen)
--   * erlaubte Wechsel: draft → published, published → archived
--   * Eigentümer, Woche und Version sind unveränderlich
--   * nur Entwürfe dürfen gelöscht werden (Ausnahme: Kaskade beim Löschen des Benutzers)
create function private.guard_schedule_week()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Neue Wochenpläne müssen als Entwurf angelegt werden'
        using errcode = 'check_violation';
    end if;
    new.published_at := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- pg_trigger_depth() > 1: Löschung über ON DELETE CASCADE (z. B. Benutzer gelöscht).
    if old.status <> 'draft' and pg_trigger_depth() = 1 then
      raise exception 'Nur Entwürfe können gelöscht werden'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.owner_id <> old.owner_id
     or new.week_start <> old.week_start
     or new.version <> old.version then
    raise exception 'Eigentümer, Wochenbeginn und Version eines Wochenplans sind unveränderlich'
      using errcode = 'check_violation';
  end if;

  if new.status <> old.status then
    if not ((old.status = 'draft' and new.status = 'published')
         or (old.status = 'published' and new.status = 'archived')) then
      raise exception 'Unzulässiger Statuswechsel von % nach %', old.status, new.status
        using errcode = 'check_violation';
    end if;
    if new.status = 'published' then
      new.published_at := now();
    else
      new.published_at := old.published_at;
    end if;
  else
    new.published_at := old.published_at;
  end if;

  return new;
end;
$$;

-- Regeln für Einträge:
--   * Wochenplan muss existieren und für den Aufrufer sichtbar sein (RLS greift auch hier)
--   * Beginn muss in der Woche liegen (Planungszeitzone)
--   * nur Entwürfe sind inhaltlich änderbar; in veröffentlichten/archivierten Plänen
--     darf ausschließlich completion_status geändert werden
create function private.guard_schedule_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_week record;
  v_timezone text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 then
      select w.status into v_week
        from public.schedule_weeks w
       where w.id = old.schedule_week_id;
      if found and v_week.status <> 'draft' then
        raise exception 'Einträge veröffentlichter oder archivierter Wochenpläne können nicht gelöscht werden'
          using errcode = 'check_violation';
      end if;
    end if;
    return old;
  end if;

  select w.owner_id, w.week_start, w.status into v_week
    from public.schedule_weeks w
   where w.id = new.schedule_week_id;

  if not found or v_week.owner_id <> new.owner_id then
    raise exception 'Wochenplan nicht gefunden'
      using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.schedule_week_id <> old.schedule_week_id or new.owner_id <> old.owner_id then
      raise exception 'Einträge können nicht in einen anderen Wochenplan verschoben werden'
        using errcode = 'check_violation';
    end if;

    if v_week.status <> 'draft' then
      if (new.title, new.category, new.start_at, new.end_at, new.location, new.note, new.source)
         is distinct from
         (old.title, old.category, old.start_at, old.end_at, old.location, old.note, old.source) then
        raise exception 'In veröffentlichten Wochenplänen kann nur der Erledigt-Status geändert werden'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
  elsif v_week.status <> 'draft' then
    raise exception 'Einträge können nur zu Entwürfen hinzugefügt werden'
      using errcode = 'check_violation';
  end if;

  select coalesce(
           (select s.timezone from public.user_settings s where s.owner_id = new.owner_id),
           'Europe/Berlin'
         )
    into v_timezone;

  if new.start_at < (v_week.week_start::timestamp at time zone v_timezone)
     or new.start_at >= ((v_week.week_start + 7)::timestamp at time zone v_timezone) then
    raise exception 'Der Eintrag beginnt außerhalb der Woche ab %', v_week.week_start
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.guard_schedule_week() from public, anon, authenticated;
revoke all on function private.guard_schedule_entry() from public, anon, authenticated;

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function private.set_updated_at();

create trigger recurring_commitments_set_updated_at
  before update on public.recurring_commitments
  for each row execute function private.set_updated_at();

create trigger schedule_weeks_guard
  before insert or update or delete on public.schedule_weeks
  for each row execute function private.guard_schedule_week();

create trigger schedule_weeks_set_updated_at
  before update on public.schedule_weeks
  for each row execute function private.set_updated_at();

create trigger schedule_entries_guard
  before insert or update or delete on public.schedule_entries
  for each row execute function private.guard_schedule_entry();

create trigger schedule_entries_set_updated_at
  before update on public.schedule_entries
  for each row execute function private.set_updated_at();

-- =============================================================================
-- Grants: anon erhält nichts, authenticated nur CRUD. RLS schränkt zusätzlich ein.
-- =============================================================================
revoke all on table
  public.user_settings,
  public.recurring_commitments,
  public.schedule_weeks,
  public.schedule_entries
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.user_settings,
  public.recurring_commitments,
  public.schedule_weeks,
  public.schedule_entries
to authenticated;

grant all on table
  public.user_settings,
  public.recurring_commitments,
  public.schedule_weeks,
  public.schedule_entries
to service_role;

-- =============================================================================
-- Row Level Security: nur eigene Zeilen, getrennte Policies je Operation
-- =============================================================================
alter table public.user_settings enable row level security;
alter table public.recurring_commitments enable row level security;
alter table public.schedule_weeks enable row level security;
alter table public.schedule_entries enable row level security;

-- user_settings
create policy "user_settings: eigene lesen" on public.user_settings
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "user_settings: eigene anlegen" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "user_settings: eigene ändern" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "user_settings: eigene löschen" on public.user_settings
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- recurring_commitments
create policy "recurring_commitments: eigene lesen" on public.recurring_commitments
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "recurring_commitments: eigene anlegen" on public.recurring_commitments
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "recurring_commitments: eigene ändern" on public.recurring_commitments
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "recurring_commitments: eigene löschen" on public.recurring_commitments
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- schedule_weeks
create policy "schedule_weeks: eigene lesen" on public.schedule_weeks
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "schedule_weeks: eigene anlegen" on public.schedule_weeks
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "schedule_weeks: eigene ändern" on public.schedule_weeks
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "schedule_weeks: eigene löschen" on public.schedule_weeks
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- schedule_entries
create policy "schedule_entries: eigene lesen" on public.schedule_entries
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "schedule_entries: eigene anlegen" on public.schedule_entries
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "schedule_entries: eigene ändern" on public.schedule_entries
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "schedule_entries: eigene löschen" on public.schedule_entries
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- =============================================================================
-- RPC-Funktionen (SECURITY INVOKER: RLS und Trigger gelten vollständig)
-- =============================================================================

-- Veröffentlicht einen Entwurf atomar; eine bisher veröffentlichte Version wird archiviert.
create function public.publish_schedule_week(p_week_id uuid)
returns public.schedule_weeks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_week public.schedule_weeks;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;

  select * into v_week
    from public.schedule_weeks
   where id = p_week_id and owner_id = auth.uid()
     for update;

  if not found then
    raise exception 'Wochenplan nicht gefunden' using errcode = 'no_data_found';
  end if;
  if v_week.status <> 'draft' then
    raise exception 'Nur Entwürfe können veröffentlicht werden' using errcode = 'raise_exception';
  end if;

  update public.schedule_weeks
     set status = 'archived'
   where owner_id = v_week.owner_id
     and week_start = v_week.week_start
     and status = 'published';

  update public.schedule_weeks
     set status = 'published'
   where id = v_week.id
  returning * into v_week;

  return v_week;
end;
$$;

-- Liefert den Entwurf einer Woche oder legt ihn als neue Version an.
-- Existiert eine veröffentlichte Version, wird sie in den Entwurf kopiert
-- (die veröffentlichte Version selbst bleibt unverändert).
create function public.create_schedule_draft(p_week_start date)
returns public.schedule_weeks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_draft public.schedule_weeks;
  v_published public.schedule_weeks;
  v_next_version integer;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Der Wochenbeginn muss ein Montag sein' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_draft
    from public.schedule_weeks
   where owner_id = v_owner and week_start = p_week_start and status = 'draft';
  if found then
    return v_draft;
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.schedule_weeks
   where owner_id = v_owner and week_start = p_week_start;

  select * into v_published
    from public.schedule_weeks
   where owner_id = v_owner and week_start = p_week_start and status = 'published';

  insert into public.schedule_weeks (owner_id, week_start, version, status, planning_note)
  values (
    v_owner,
    p_week_start,
    v_next_version,
    'draft',
    case when v_published.id is not null then v_published.planning_note end
  )
  returning * into v_draft;

  if v_published.id is not null then
    insert into public.schedule_entries (
      owner_id, schedule_week_id, title, category, start_at, end_at,
      location, note, source, completion_status
    )
    select owner_id, v_draft.id, title, category, start_at, end_at,
           location, note, source, completion_status
      from public.schedule_entries
     where schedule_week_id = v_published.id;
  end if;

  return v_draft;
end;
$$;

-- Fügt mehrere Einträge atomar in einen Entwurf ein; optional werden vorhandene
-- Einträge vorher entfernt (nur nach ausdrücklicher Bestätigung in der UI).
create function public.add_schedule_entries(
  p_week_id uuid,
  p_entries jsonb,
  p_replace_existing boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_status text;
  v_count integer;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Einträge müssen als Liste übergeben werden' using errcode = 'invalid_parameter_value';
  end if;

  select status into v_status
    from public.schedule_weeks
   where id = p_week_id and owner_id = v_owner
     for update;

  if not found then
    raise exception 'Wochenplan nicht gefunden' using errcode = 'no_data_found';
  end if;
  if v_status <> 'draft' then
    raise exception 'Einträge können nur zu Entwürfen hinzugefügt werden' using errcode = 'raise_exception';
  end if;

  if coalesce(p_replace_existing, false) then
    delete from public.schedule_entries where schedule_week_id = p_week_id;
  end if;

  insert into public.schedule_entries (
    owner_id, schedule_week_id, title, category, start_at, end_at, location, note, source
  )
  select v_owner, p_week_id, e.title, e.category, e.start_at, e.end_at, e.location, e.note,
         coalesce(e.source, 'manual')
    from jsonb_to_recordset(p_entries) as e(
      title text,
      category text,
      start_at timestamptz,
      end_at timestamptz,
      location text,
      note text,
      source text
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.publish_schedule_week(uuid) from public, anon;
revoke all on function public.create_schedule_draft(date) from public, anon;
revoke all on function public.add_schedule_entries(uuid, jsonb, boolean) from public, anon;

grant execute on function public.publish_schedule_week(uuid) to authenticated, service_role;
grant execute on function public.create_schedule_draft(date) to authenticated, service_role;
grant execute on function public.add_schedule_entries(uuid, jsonb, boolean)
  to authenticated, service_role;

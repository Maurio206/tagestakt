-- =============================================================================
-- TagesTakt – Planungsregeln, geprüfte Wochenentwürfe und Claude-Connector
--
-- Rein additiv:
--   * neue Tabelle planning_preferences (eine Zeile je Benutzer): Rahmen für Gewerbeblöcke
--     und Pausen zwischen Blöcken,
--   * neue Tabelle planning_goal_slots: Zeitfenster für Sport- und Beziehungsblöcke je
--     Wochentag (verbindlich oder optional, mit fester Dauer),
--   * neue RPCs schedule_week_fingerprint, save_generated_schedule_draft,
--     publish_reviewed_schedule_week und discard_reviewed_schedule_draft,
--   * neue Datenbankrolle tagestakt_connector (ohne Anmeldung angelegt) und neues, nicht
--     exponiertes Schema connector für die OAuth-Autorisierung des Remote-MCP-Connectors
--     (nur Hashes) und einmalige Veröffentlichungsbestätigungen,
--   * keine bestehende Tabelle, Spalte, Funktion oder Policy wird geändert.
--
-- Claude (geplante Aufgabe in der Claude-App) speichert über den Connector ausschließlich
-- Entwürfe. Ein Vorschlag ersetzt höchstens die geplanten Einträge des eigenen Entwurfs der
-- Woche – und nur, wenn dieser seit dem Lesen unverändert ist (Fingerabdruck); manuelle
-- Einzeltermine bleiben erhalten. Veröffentlicht wird nur genau der geprüfte Stand und nur nach
-- ausdrücklicher Bestätigung. Veröffentlichte und archivierte Versionen bleiben unberührt
-- (bestehende Trigger).
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
  'Persönlicher Rahmen für die Wochenplanung: Gewerbezeiten, Blocklängen, Tageshöchstwerte, Pausen.';

create table public.planning_goal_slots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_category text not null,
  weekday smallint not null,
  -- required = muss geplant werden; optional = nur bei ausreichend freier Zeit.
  requirement text not null,
  -- Sichtbarer Titel des geplanten Blocks (wird nicht an den Connector übertragen).
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
  'Zeitfenster je Wochentag für Sport- und Beziehungsblöcke (Dauer fest, Lage wird geplant).';

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
-- 4. RPC: geprüften Vorschlag als Entwurf speichern (atomar, idempotent)
-- =============================================================================
-- Legt bei Bedarf den Entwurf der Woche an (nächste Version, Kopie der veröffentlichten) und
-- ersetzt dessen geplante Einträge (Herkunft recurring/agent) durch den geprüften Vorschlag.
-- Manuelle Einträge (Einzeltermine) bleiben unverändert erhalten. Alles in einer Transaktion.
--   * Optimistische Nebenläufigkeit: Bestand beim Lesen bereits ein Entwurf, muss er unverändert
--     sein (ID + Fingerabdruck); bestand keiner, darf inzwischen auch keiner entstanden sein.
--     Sonst wird nichts geschrieben (SQLSTATE TT008).
--   * Idempotent: Enthält der Entwurf bereits genau diesen Vorschlag (z. B. Wiederholung nach
--     einer Zeitüberschreitung), wird er unverändert zurückgegeben.
--   * Veröffentlichte und archivierte Versionen werden nie verändert.
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
  v_current jsonb;
  v_requested jsonb;
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

  -- Gleichzeitige Speicher-, Verwerfen- und Veröffentlichungsaufrufe derselben Woche
  -- nacheinander verarbeiten.
  perform pg_advisory_xact_lock(
    hashtextextended('tagestakt.schedule_week:' || v_owner::text || ':' || p_week_start::text, 0)
  );

  select * into v_draft
    from public.schedule_weeks
   where owner_id = v_owner and week_start = p_week_start and status = 'draft'
     for update;

  if found then
    -- Wiederholung desselben Vorschlags: nichts ändern (Vergleich ohne IDs und Zeitstempel).
    select coalesce(jsonb_agg(x.item order by x.item), '[]'::jsonb) into v_current
      from (
        select jsonb_build_object(
                 'title', e.title, 'category', e.category,
                 'start_at', extract(epoch from e.start_at), 'end_at', extract(epoch from e.end_at),
                 'location', e.location, 'note', e.note, 'source', e.source) as item
          from public.schedule_entries e
         where e.schedule_week_id = v_draft.id and e.source <> 'manual'
      ) as x;
    select coalesce(jsonb_agg(x.item order by x.item), '[]'::jsonb) into v_requested
      from (
        select jsonb_build_object(
                 'title', e.title, 'category', e.category,
                 'start_at', extract(epoch from e.start_at), 'end_at', extract(epoch from e.end_at),
                 'location', e.location, 'note', e.note, 'source', e.source) as item
          from jsonb_to_recordset(p_entries) as e(
            title text, category text, start_at timestamptz, end_at timestamptz,
            location text, note text, source text)
      ) as x;
    if v_current = v_requested and v_draft.planning_note is not distinct from p_planning_note then
      return v_draft;
    end if;

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

  -- Nur geplante Einträge ersetzen; manuelle Einzeltermine bleiben erhalten.
  delete from public.schedule_entries
   where schedule_week_id = v_draft.id and source <> 'manual';
  perform public.add_schedule_entries(v_draft.id, p_entries, false);

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

-- =============================================================================
-- 6. RPC: eigenen, geprüften Entwurf verwerfen (atomar)
-- =============================================================================
-- Löscht ausschließlich den eigenen Entwurf, und nur in genau dem gesehenen Stand
-- (Fingerabdruck, sonst TT008). Veröffentlichte und archivierte Versionen bleiben unberührt.
create function public.discard_reviewed_schedule_draft(p_week_id uuid, p_expected_fingerprint text)
returns boolean
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
  if v_week.status <> 'draft' then
    raise exception 'Nur Entwürfe können verworfen werden' using errcode = 'raise_exception';
  end if;
  if public.schedule_week_fingerprint(v_week.id) <> p_expected_fingerprint then
    raise exception 'Der Entwurf wurde inzwischen geändert.' using errcode = 'TT008';
  end if;

  delete from public.schedule_weeks where id = v_week.id;
  return true;
end;
$$;

revoke all on function public.schedule_week_fingerprint(uuid) from public, anon;
revoke all on function public.save_generated_schedule_draft(date, uuid, text, jsonb, text)
  from public, anon;
revoke all on function public.publish_reviewed_schedule_week(uuid, text) from public, anon;
revoke all on function public.discard_reviewed_schedule_draft(uuid, text) from public, anon;

grant execute on function public.schedule_week_fingerprint(uuid) to authenticated, service_role;
grant execute on function public.save_generated_schedule_draft(date, uuid, text, jsonb, text)
  to authenticated, service_role;
grant execute on function public.publish_reviewed_schedule_week(uuid, text)
  to authenticated, service_role;
grant execute on function public.discard_reviewed_schedule_draft(uuid, text)
  to authenticated, service_role;

-- =============================================================================
-- 7. Claude-Connector: eigene Datenbankrolle und nicht exponiertes Schema
-- =============================================================================
-- Der Remote-MCP-Connector der Website verbindet sich mit einer eigenen, minimal berechtigten
-- Rolle direkt mit der Datenbank (kein Service-Role-Key, kein JWT-Secret):
--   * NOLOGIN hier; Anmeldung und Passwort setzt der Betreiber außerhalb des Repositorys,
--   * NOINHERIT + Mitglied von authenticated: Planungsdaten liest und schreibt der Connector
--     nur nach `set local role authenticated` mit den Claims des autorisierten Eigentümers –
--     also unter denselben RLS-Policies und RPCs wie die Website,
--   * eigene Rechte nur auf das Schema connector (OAuth-Codes, Freigaben, Token-Hashes,
--     Veröffentlichungsbestätigungen). Das Schema ist nicht über PostgREST exponiert;
--     anon, authenticated und service_role erhalten darauf keinerlei Rechte.
-- Gespeichert werden nur SHA-256-Hashes von Codes, Tokens und Bestätigungen, nie Klartext.
-- owner_id stammt immer aus der serverseitig geprüften Anmeldung bzw. aus der Freigabe des
-- vorgelegten Tokens – nie aus Eingaben von Claude. Ein Default auth.uid() entfällt bewusst:
-- die Connector-Rolle arbeitet auf diesem Schema ohne Supabase-JWT-Claims.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tagestakt_connector') then
    create role tagestakt_connector nologin noinherit;
  end if;
end;
$$;

grant authenticated to tagestakt_connector;

create schema connector;
revoke all on schema connector from public;
grant usage on schema connector to tagestakt_connector;

comment on schema connector is
  'Claude-Connector (Remote MCP): OAuth-Codes, Freigaben, Token-Hashes, Bestätigungen. Nicht exponiert.';

create table connector.oauth_authorization_codes (
  code_hash text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  client_name text not null,
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null,
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  -- Beim Einlösen erzeugte Freigabe (erneute Vorlage des Codes widerruft sie).
  grant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_authorization_codes_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_authorization_codes_client_check
    check (char_length(client_id) between 1 and 512 and char_length(client_name) between 1 and 200),
  constraint oauth_authorization_codes_redirect_check
    check (char_length(redirect_uri) between 1 and 512),
  constraint oauth_authorization_codes_challenge_check
    check (code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  constraint oauth_authorization_codes_scopes_check
    check (cardinality(scopes) between 1 and 3
           and scopes <@ array['planning:read', 'planning:draft', 'planning:publish']),
  constraint oauth_authorization_codes_resource_check check (char_length(resource) between 1 and 512)
);
create index oauth_authorization_codes_owner_idx on connector.oauth_authorization_codes (owner_id);

create table connector.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  client_name text not null,
  scopes text[] not null,
  resource text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_grants_client_check
    check (char_length(client_id) between 1 and 512 and char_length(client_name) between 1 and 200),
  constraint oauth_grants_scopes_check
    check (cardinality(scopes) between 1 and 3
           and scopes <@ array['planning:read', 'planning:draft', 'planning:publish']),
  constraint oauth_grants_resource_check check (char_length(resource) between 1 and 512)
);
create index oauth_grants_owner_idx on connector.oauth_grants (owner_id);

alter table connector.oauth_authorization_codes
  add constraint oauth_authorization_codes_grant_fkey foreign key (grant_id)
  references connector.oauth_grants (id) on delete cascade;
create index oauth_authorization_codes_grant_idx on connector.oauth_authorization_codes (grant_id);

create table connector.oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references connector.oauth_grants (id) on delete cascade,
  kind text not null,
  expires_at timestamptz not null,
  -- Refresh-Token wurde gegen ein neues getauscht (erneute Vorlage = Diebstahlverdacht).
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_tokens_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_tokens_kind_check check (kind in ('access', 'refresh'))
);
create index oauth_tokens_grant_idx on connector.oauth_tokens (grant_id);

create table connector.publish_confirmations (
  confirmation_hash text primary key,
  grant_id uuid not null references connector.oauth_grants (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  schedule_week_id uuid not null references public.schedule_weeks (id) on delete cascade,
  fingerprint text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publish_confirmations_hash_check check (confirmation_hash ~ '^[0-9a-f]{64}$'),
  constraint publish_confirmations_fingerprint_check check (fingerprint ~ '^[0-9a-f]{64}$')
);
create index publish_confirmations_grant_idx on connector.publish_confirmations (grant_id);
create index publish_confirmations_owner_idx on connector.publish_confirmations (owner_id);
create index publish_confirmations_week_idx on connector.publish_confirmations (schedule_week_id);

create trigger oauth_authorization_codes_set_updated_at
  before update on connector.oauth_authorization_codes
  for each row execute function private.set_updated_at();
create trigger oauth_grants_set_updated_at
  before update on connector.oauth_grants
  for each row execute function private.set_updated_at();
create trigger oauth_tokens_set_updated_at
  before update on connector.oauth_tokens
  for each row execute function private.set_updated_at();
create trigger publish_confirmations_set_updated_at
  before update on connector.publish_confirmations
  for each row execute function private.set_updated_at();

-- Nur die Connector-Rolle; anon, authenticated und service_role erhalten nichts. RLS ist
-- zusätzlich aktiv: ohne passende Policy sieht keine andere Rolle eine Zeile. Die Policies der
-- Connector-Rolle sind bewusst nicht auf einen Eigentümer eingeschränkt, weil Codes und Tokens
-- über ihren Hash nachgeschlagen werden, bevor der Eigentümer bekannt ist; die Bindung an den
-- Eigentümer prüft der Server bei jedem Zugriff.
revoke all on all tables in schema connector from public, anon, authenticated, service_role;
grant select, insert, update, delete on table
  connector.oauth_authorization_codes,
  connector.oauth_grants,
  connector.oauth_tokens,
  connector.publish_confirmations
  to tagestakt_connector;

alter table connector.oauth_authorization_codes enable row level security;
alter table connector.oauth_grants enable row level security;
alter table connector.oauth_tokens enable row level security;
alter table connector.publish_confirmations enable row level security;

create policy "oauth_authorization_codes: connector lesen" on connector.oauth_authorization_codes
  for select to tagestakt_connector using (true);
create policy "oauth_authorization_codes: connector anlegen" on connector.oauth_authorization_codes
  for insert to tagestakt_connector with check (true);
create policy "oauth_authorization_codes: connector ändern" on connector.oauth_authorization_codes
  for update to tagestakt_connector using (true) with check (true);
create policy "oauth_authorization_codes: connector löschen" on connector.oauth_authorization_codes
  for delete to tagestakt_connector using (true);

create policy "oauth_grants: connector lesen" on connector.oauth_grants
  for select to tagestakt_connector using (true);
create policy "oauth_grants: connector anlegen" on connector.oauth_grants
  for insert to tagestakt_connector with check (true);
create policy "oauth_grants: connector ändern" on connector.oauth_grants
  for update to tagestakt_connector using (true) with check (true);
create policy "oauth_grants: connector löschen" on connector.oauth_grants
  for delete to tagestakt_connector using (true);

create policy "oauth_tokens: connector lesen" on connector.oauth_tokens
  for select to tagestakt_connector using (true);
create policy "oauth_tokens: connector anlegen" on connector.oauth_tokens
  for insert to tagestakt_connector with check (true);
create policy "oauth_tokens: connector ändern" on connector.oauth_tokens
  for update to tagestakt_connector using (true) with check (true);
create policy "oauth_tokens: connector löschen" on connector.oauth_tokens
  for delete to tagestakt_connector using (true);

create policy "publish_confirmations: connector lesen" on connector.publish_confirmations
  for select to tagestakt_connector using (true);
create policy "publish_confirmations: connector anlegen" on connector.publish_confirmations
  for insert to tagestakt_connector with check (true);
create policy "publish_confirmations: connector ändern" on connector.publish_confirmations
  for update to tagestakt_connector using (true) with check (true);
create policy "publish_confirmations: connector löschen" on connector.publish_confirmations
  for delete to tagestakt_connector using (true);

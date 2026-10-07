-- =============================================================================
-- TagesTakt – Fokus-Erfassung und konfigurierbare Wochenziele
--
-- Rein additiv. Bestehende Zeilen bleiben unverändert gültig:
--   * user_settings erhält nur neue Spalten (nullable bzw. mit Standardwert),
--   * schedule_entries erhält nur einen zusätzlichen Unique-Constraint (id ist bereits PK),
--   * activity_sessions ist eine neue Tabelle,
--   * keine vorhandenen Daten werden gelöscht, umgeschrieben oder umgedeutet,
--   * neue Funktionen; keine bestehende Funktion, Policy oder Spalte wird geändert.
--
-- Grundsätze wie in der Initialmigration: RLS auf jeder Tabelle, getrennte Policies je
-- Operation, explizite Grants (anon erhält nichts), Trigger im nicht exponierten Schema
-- private, RPCs als SECURITY INVOKER mit leerem search_path.
-- =============================================================================

-- =============================================================================
-- 1. user_settings: Ziele für Sport und Beziehung, Erinnerungseinstellungen
-- =============================================================================
alter table public.user_settings
  add column weekly_sport_target_minutes integer,
  add column weekly_relationship_target_minutes integer,
  add column reminder_minutes_before smallint default 10,
  add column remind_at_start boolean not null default true,
  add column remind_if_not_started boolean not null default false,
  add column reminder_scope text not null default 'important';

alter table public.user_settings
  -- NULL = kein Ziel festgelegt. 0 ist bewusst nicht erlaubt (eindeutige Bedeutung).
  add constraint user_settings_sport_target_check
    check (weekly_sport_target_minutes is null
           or weekly_sport_target_minutes between 1 and 10080),
  add constraint user_settings_relationship_target_check
    check (weekly_relationship_target_minutes is null
           or weekly_relationship_target_minutes between 1 and 10080),
  -- NULL = keine Vorab-Erinnerung.
  add constraint user_settings_reminder_minutes_check
    check (reminder_minutes_before is null or reminder_minutes_before between 1 and 240),
  add constraint user_settings_reminder_scope_check
    check (reminder_scope in ('goals', 'important', 'all'));

comment on column public.user_settings.weekly_sport_target_minutes is
  'Wöchentliches Sportziel in Minuten; NULL = noch kein Ziel festgelegt.';
comment on column public.user_settings.weekly_relationship_target_minutes is
  'Wöchentliches Beziehungsziel (Kategorie relationship) in Minuten; NULL = noch kein Ziel festgelegt.';
comment on column public.user_settings.reminder_minutes_before is
  'Vorlauf lokaler Erinnerungen in Minuten; NULL = keine Vorab-Erinnerung.';
comment on column public.user_settings.remind_at_start is
  'Lokale Erinnerung zum geplanten Beginn.';
comment on column public.user_settings.remind_if_not_started is
  'Lokale Erinnerung, wenn ein Zielblock kurz nach Beginn noch nicht gestartet wurde.';
comment on column public.user_settings.reminder_scope is
  'Für welche Blöcke erinnert wird: goals (Ziele), important (Ziele, Dienst, Termine), all.';

-- =============================================================================
-- 2. schedule_entries: Ziel eines zusammengesetzten Fremdschlüssels
-- =============================================================================
-- id ist Primärschlüssel; (id, owner_id) ist damit ebenfalls eindeutig. Der Constraint
-- erlaubt einen Fremdschlüssel, der nur Planblöcke desselben Eigentümers akzeptiert.
alter table public.schedule_entries
  add constraint schedule_entries_id_owner_key unique (id, owner_id);

-- =============================================================================
-- 3. activity_sessions: tatsächlich erfasste Zeit
-- =============================================================================
create table public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Optionaler Bezug zum Planblock; NULL = spontane Aktivität ohne Planblock.
  schedule_entry_id uuid,
  goal_category text not null,
  title text not null,
  started_at timestamptz not null default now(),
  -- NULL = Aktivität läuft.
  ended_at timestamptz,
  -- Wird vom Trigger gesetzt, wenn Zeiten nachträglich eingetragen oder geändert wurden.
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Zusammengesetzter Fremdschlüssel: nur Planblöcke desselben Eigentümers. Verschwindet der
  -- Planblock (Kaskade), bleibt die erfasste Zeit erhalten und verliert nur den Bezug.
  constraint activity_sessions_entry_owner_fkey foreign key (schedule_entry_id, owner_id)
    references public.schedule_entries (id, owner_id) on delete set null (schedule_entry_id),
  constraint activity_sessions_goal_category_check
    check (goal_category in ('business', 'sport', 'relationship')),
  constraint activity_sessions_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint activity_sessions_time_order_check check (ended_at is null or ended_at > started_at),
  constraint activity_sessions_max_duration_check
    check (ended_at is null or ended_at - started_at <= interval '24 hours')
);

comment on table public.activity_sessions is
  'Tatsächlich erfasste Zeit für die Ziele Gewerbe, Sport und Beziehung. Geplante Zeit steht in schedule_entries.';
comment on column public.activity_sessions.ended_at is
  'NULL, solange die Aktivität läuft. Höchstens eine laufende Aktivität pro Benutzer.';
comment on column public.activity_sessions.corrected_at is
  'Zeitpunkt der letzten nachträglichen Korrektur oder des Nachtragens (vom Trigger gesetzt).';

-- Höchstens eine laufende Aktivität pro Benutzer – fängt auch konkurrierende Starts ab.
create unique index activity_sessions_one_active_idx
  on public.activity_sessions (owner_id)
  where ended_at is null;

create index activity_sessions_owner_started_idx
  on public.activity_sessions (owner_id, started_at);

create index activity_sessions_entry_owner_idx
  on public.activity_sessions (schedule_entry_id, owner_id);

-- =============================================================================
-- 4. Integritäts-Trigger für activity_sessions
-- =============================================================================
-- Regeln:
--   * Eigentümer unveränderlich; beendete Aktivitäten werden nicht wieder gestartet
--   * keine Zeiten in der Zukunft (Toleranz 1 Minute für abweichende Geräteuhren)
--   * eine laufende Aktivität beginnt höchstens 24 Stunden vor jetzt
--   * Bezug nur zu eigenen, veröffentlichten (oder archivierten) Planblöcken desselben Ziels
--   * keine Überschneidung mit anderen erfassten Aktivitäten (pro Benutzer serialisiert)
--   * corrected_at kennzeichnet nachgetragene oder geänderte Zeiten
create function private.guard_activity_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entry record;
  v_tolerance constant interval := interval '1 minute';
  v_max_running constant interval := interval '24 hours';
begin
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id then
      raise exception 'Der Eigentümer einer Aktivität ist unveränderlich'
        using errcode = 'check_violation';
    end if;
    if old.ended_at is not null and new.ended_at is null then
      raise exception 'Eine beendete Aktivität kann nicht wieder gestartet werden.'
        using errcode = 'TT006';
    end if;
  end if;

  new.title := btrim(new.title);

  if new.started_at > now() + v_tolerance then
    raise exception 'Der Beginn darf nicht in der Zukunft liegen.' using errcode = 'TT006';
  end if;
  if new.ended_at is not null and new.ended_at > now() + v_tolerance then
    raise exception 'Das Ende darf nicht in der Zukunft liegen.' using errcode = 'TT006';
  end if;
  if new.ended_at is null
     and (tg_op = 'INSERT' or new.started_at is distinct from old.started_at)
     and new.started_at < now() - v_max_running then
    raise exception 'Eine laufende Aktivität darf höchstens 24 Stunden zurückliegen.'
      using errcode = 'TT006';
  end if;

  if new.schedule_entry_id is not null
     and (tg_op = 'INSERT'
          or new.schedule_entry_id is distinct from old.schedule_entry_id
          or new.goal_category is distinct from old.goal_category) then
    -- SELECT als Aufrufer: RLS sorgt dafür, dass nur eigene Planblöcke sichtbar sind.
    select e.owner_id, e.category, w.status
      into v_entry
      from public.schedule_entries e
      join public.schedule_weeks w on w.id = e.schedule_week_id
     where e.id = new.schedule_entry_id;

    if not found or v_entry.owner_id <> new.owner_id then
      raise exception 'Planblock nicht gefunden.' using errcode = 'TT005';
    end if;
    if v_entry.status = 'draft' then
      raise exception 'Aktivitäten lassen sich nur zu veröffentlichten Planblöcken erfassen.'
        using errcode = 'TT005';
    end if;
    if v_entry.category <> new.goal_category then
      raise exception 'Der Planblock gehört zu einem anderen Ziel.' using errcode = 'TT005';
    end if;
  end if;

  -- Konkurrierende Schreibvorgänge desselben Benutzers nacheinander prüfen.
  perform pg_advisory_xact_lock(
    hashtextextended('tagestakt.activity_sessions:' || new.owner_id::text, 0)
  );
  if exists (
    select 1
      from public.activity_sessions s
     where s.owner_id = new.owner_id
       and s.id <> new.id
       and tstzrange(s.started_at, coalesce(s.ended_at, 'infinity'::timestamptz))
           && tstzrange(new.started_at, coalesce(new.ended_at, 'infinity'::timestamptz))
  ) then
    raise exception 'Die Zeit überschneidet sich mit einer anderen erfassten Aktivität.'
      using errcode = 'TT004';
  end if;

  if tg_op = 'INSERT' then
    if new.ended_at is not null or new.started_at < now() - v_tolerance then
      new.corrected_at := now();
    else
      new.corrected_at := null;
    end if;
  elsif new.started_at is distinct from old.started_at
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
     or (old.ended_at is null and new.ended_at is not null
         and new.ended_at < now() - v_tolerance) then
    new.corrected_at := now();
  else
    new.corrected_at := old.corrected_at;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_activity_session() from public, anon, authenticated;

create trigger activity_sessions_guard
  before insert or update on public.activity_sessions
  for each row execute function private.guard_activity_session();

create trigger activity_sessions_set_updated_at
  before update on public.activity_sessions
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 5. Grants und Row Level Security
-- =============================================================================
revoke all on table public.activity_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.activity_sessions to authenticated;
grant all on table public.activity_sessions to service_role;

alter table public.activity_sessions enable row level security;

create policy "activity_sessions: eigene lesen" on public.activity_sessions
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "activity_sessions: eigene anlegen" on public.activity_sessions
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "activity_sessions: eigene ändern" on public.activity_sessions
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "activity_sessions: eigene löschen" on public.activity_sessions
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- =============================================================================
-- 6. RPC-Funktionen (SECURITY INVOKER: RLS und Trigger gelten vollständig)
-- =============================================================================
-- Fehlercodes (SQLSTATE) für die Clients:
--   TT001 es läuft bereits eine Aktivität   TT002 es läuft keine Aktivität
--   TT003 läuft > 24 h, Ende korrigieren     TT004 Überschneidung
--   TT005 Planblock ungültig                 TT006 ungültige Zeitangabe

-- Startet eine Aktivität mit Serverzeit als Beginn.
create function public.start_activity_session(
  p_goal_category text,
  p_title text default null,
  p_schedule_entry_id uuid default null
)
returns public.activity_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_entry_title text;
  v_session public.activity_sessions;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  if p_goal_category is null or p_goal_category not in ('business', 'sport', 'relationship') then
    raise exception 'Unbekanntes Ziel.' using errcode = 'invalid_parameter_value';
  end if;

  -- Konkurrierende Startversuche desselben Benutzers nacheinander verarbeiten.
  perform pg_advisory_xact_lock(
    hashtextextended('tagestakt.activity_sessions:' || v_owner::text, 0)
  );

  if exists (
    select 1 from public.activity_sessions where owner_id = v_owner and ended_at is null
  ) then
    raise exception 'Es läuft bereits eine Aktivität. Bitte zuerst beenden.'
      using errcode = 'TT001';
  end if;

  if p_schedule_entry_id is not null then
    select e.title into v_entry_title
      from public.schedule_entries e
     where e.id = p_schedule_entry_id and e.owner_id = v_owner;
  end if;

  insert into public.activity_sessions (owner_id, schedule_entry_id, goal_category, title, started_at)
  values (
    v_owner,
    p_schedule_entry_id,
    p_goal_category,
    left(coalesce(nullif(btrim(p_title), ''), v_entry_title, 'Aktivität'), 120),
    now()
  )
  returning * into v_session;

  return v_session;
end;
$$;

-- Beendet die laufende Aktivität mit Serverzeit als Ende.
create function public.stop_activity_session(p_session_id uuid default null)
returns public.activity_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_session public.activity_sessions;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;

  select * into v_session
    from public.activity_sessions
   where owner_id = v_owner and ended_at is null
     for update;

  if not found or (p_session_id is not null and v_session.id <> p_session_id) then
    raise exception 'Es läuft keine Aktivität.' using errcode = 'TT002';
  end if;
  if now() - v_session.started_at > interval '24 hours' then
    raise exception 'Die Aktivität läuft seit über 24 Stunden. Bitte das Ende über „Zeit korrigieren“ eintragen.'
      using errcode = 'TT003';
  end if;

  update public.activity_sessions
     set ended_at = greatest(now(), v_session.started_at + interval '1 second')
   where id = v_session.id
  returning * into v_session;

  return v_session;
end;
$$;

-- Korrigiert Beginn und Ende einer eigenen Aktivität (Ende NULL = läuft weiter).
create function public.correct_activity_session(
  p_session_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz default null
)
returns public.activity_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_session public.activity_sessions;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  if p_session_id is null or p_started_at is null then
    raise exception 'Aktivität und Beginn sind erforderlich.' using errcode = 'invalid_parameter_value';
  end if;
  if p_ended_at is not null and p_ended_at <= p_started_at then
    raise exception 'Das Ende muss nach dem Beginn liegen.' using errcode = 'TT006';
  end if;
  if p_ended_at is not null and p_ended_at - p_started_at > interval '24 hours' then
    raise exception 'Eine Aktivität darf höchstens 24 Stunden dauern.' using errcode = 'TT006';
  end if;

  select * into v_session
    from public.activity_sessions
   where id = p_session_id and owner_id = v_owner
     for update;

  if not found then
    raise exception 'Aktivität nicht gefunden.' using errcode = 'no_data_found';
  end if;
  if p_ended_at is null and v_session.ended_at is not null then
    raise exception 'Eine beendete Aktivität kann nicht wieder gestartet werden.'
      using errcode = 'TT006';
  end if;

  update public.activity_sessions
     set started_at = p_started_at,
         ended_at = p_ended_at
   where id = v_session.id
  returning * into v_session;

  return v_session;
end;
$$;

-- Wechselt atomar zu einer anderen Aktivität: beendet die laufende und startet die neue mit
-- demselben Serverzeitpunkt – in einer Transaktion. Scheitert der neue Start (z. B. fremder
-- oder Entwurfs-Planblock), wird auch das Beenden zurückgenommen. p_session_id muss die
-- aktuell laufende Aktivität sein; ein veralteter Stand (z. B. auf einem zweiten Gerät bereits
-- gewechselt) wird mit TT002 abgewiesen, statt eine andere Aktivität zu beenden.
create function public.switch_activity_session(
  p_session_id uuid,
  p_goal_category text,
  p_title text default null,
  p_schedule_entry_id uuid default null
)
returns public.activity_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_running public.activity_sessions;
  v_switch_at timestamptz;
  v_entry_title text;
  v_session public.activity_sessions;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  if p_session_id is null then
    raise exception 'Die laufende Aktivität ist erforderlich.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_goal_category is null or p_goal_category not in ('business', 'sport', 'relationship') then
    raise exception 'Unbekanntes Ziel.' using errcode = 'invalid_parameter_value';
  end if;

  -- Dieselbe Sperre wie Start und Trigger: Schreibvorgänge desselben Benutzers nacheinander.
  perform pg_advisory_xact_lock(
    hashtextextended('tagestakt.activity_sessions:' || v_owner::text, 0)
  );

  select * into v_running
    from public.activity_sessions
   where owner_id = v_owner and ended_at is null
     for update;

  if not found or v_running.id <> p_session_id then
    raise exception 'Es läuft keine Aktivität.' using errcode = 'TT002';
  end if;
  if now() - v_running.started_at > interval '24 hours' then
    raise exception 'Die Aktivität läuft seit über 24 Stunden. Bitte das Ende über „Zeit korrigieren“ eintragen.'
      using errcode = 'TT003';
  end if;

  -- Ende der alten = Beginn der neuen Aktivität (halboffene Intervalle überschneiden sich nicht).
  v_switch_at := greatest(now(), v_running.started_at + interval '1 second');

  update public.activity_sessions
     set ended_at = v_switch_at
   where id = v_running.id;

  if p_schedule_entry_id is not null then
    select e.title into v_entry_title
      from public.schedule_entries e
     where e.id = p_schedule_entry_id and e.owner_id = v_owner;
  end if;

  -- Der Trigger prüft Planblock (eigener, veröffentlicht, gleiches Ziel) und Überschneidungen.
  insert into public.activity_sessions (owner_id, schedule_entry_id, goal_category, title, started_at)
  values (
    v_owner,
    p_schedule_entry_id,
    p_goal_category,
    left(coalesce(nullif(btrim(p_title), ''), v_entry_title, 'Aktivität'), 120),
    v_switch_at
  )
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.start_activity_session(text, text, uuid) from public, anon;
revoke all on function public.stop_activity_session(uuid) from public, anon;
revoke all on function public.correct_activity_session(uuid, timestamptz, timestamptz)
  from public, anon;
revoke all on function public.switch_activity_session(uuid, text, text, uuid) from public, anon;

grant execute on function public.start_activity_session(text, text, uuid)
  to authenticated, service_role;
grant execute on function public.stop_activity_session(uuid) to authenticated, service_role;
grant execute on function public.correct_activity_session(uuid, timestamptz, timestamptz)
  to authenticated, service_role;
grant execute on function public.switch_activity_session(uuid, text, text, uuid)
  to authenticated, service_role;

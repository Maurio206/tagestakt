-- =============================================================================
-- TagesTakt – Tagesnotizen (eine Notiz je Benutzer und Kalendertag)
--
-- Rein additiv:
--   * neue Tabelle daily_notes,
--   * neuer Integritäts-Trigger im nicht exponierten Schema private,
--   * neue RPC save_daily_note,
--   * keine bestehende Tabelle, Spalte, Funktion oder Policy wird geändert.
--
-- Die Notiz gehört zum Kalendertag (Europe/Berlin), nicht zu einer Wochenplanversion:
-- Es gibt bewusst keinen Fremdschlüssel zu schedule_weeks oder schedule_entries. Neue
-- Entwürfe, Veröffentlichungen und Archivierungen lassen Tagesnotizen unberührt.
--
-- Grundsätze wie in den bisherigen Migrationen: RLS mit vier getrennten Policies, explizite
-- Grants (anon erhält nichts), Trigger im Schema private, RPC als SECURITY INVOKER mit
-- leerem search_path. Notizinhalte erscheinen nie in Fehlermeldungen.
-- =============================================================================

-- =============================================================================
-- 1. Tabelle
-- =============================================================================
create table public.daily_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_date date not null,
  -- Reiner Text (kein HTML); Zeilenumbrüche bleiben erhalten.
  content text not null,
  -- Fortlaufende Fassung, vom Trigger gepflegt. Speichern nur auf dem zuletzt gelesenen
  -- Stand (siehe save_daily_note) – verhindert stilles Überschreiben zwischen Geräten.
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Genau eine Notiz je Benutzer und Tag (dient zugleich als Index für owner_id).
  constraint daily_notes_owner_date_key unique (owner_id, note_date),
  constraint daily_notes_content_length_check check (char_length(content) between 1 and 10000),
  -- Leere oder nur aus Leerraum bestehende Notizen werden nicht gespeichert, sondern entfernt.
  constraint daily_notes_content_not_blank_check check (content ~ '[^[:space:]]'),
  constraint daily_notes_note_date_check
    check (note_date between date '2000-01-01' and date '2099-12-31'),
  constraint daily_notes_revision_check check (revision > 0)
);

comment on table public.daily_notes is
  'Persönliche Tagesnotiz (reiner Text) je Benutzer und Kalendertag; unabhängig von Wochenplanversionen.';
comment on column public.daily_notes.revision is
  'Fassung der Notiz; wird bei jeder Änderung vom Trigger erhöht und beim Speichern geprüft.';

-- =============================================================================
-- 2. Integritäts-Trigger
-- =============================================================================
-- Regeln:
--   * Eigentümer, Datum und ID sind unveränderlich (eine Notiz wechselt nie den Tag)
--   * created_at, updated_at und revision setzt ausschließlich der Server
create function private.guard_daily_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id <> old.id or new.owner_id <> old.owner_id or new.note_date <> old.note_date then
    raise exception 'Eigentümer und Datum einer Tagesnotiz sind unveränderlich.'
      using errcode = 'check_violation';
  end if;
  new.created_at := old.created_at;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.guard_daily_note() from public, anon, authenticated;

create trigger daily_notes_guard
  before insert or update on public.daily_notes
  for each row execute function private.guard_daily_note();

-- =============================================================================
-- 3. Grants und Row Level Security
-- =============================================================================
revoke all on table public.daily_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.daily_notes to authenticated;
grant all on table public.daily_notes to service_role;

alter table public.daily_notes enable row level security;

create policy "daily_notes: eigene lesen" on public.daily_notes
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "daily_notes: eigene anlegen" on public.daily_notes
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "daily_notes: eigene ändern" on public.daily_notes
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "daily_notes: eigene löschen" on public.daily_notes
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- =============================================================================
-- 4. RPC: Notiz speichern (SECURITY INVOKER: RLS und Trigger gelten vollständig)
-- =============================================================================
-- Speichert, ändert oder entfernt (leerer Inhalt) die Notiz eines Tages in einem Schritt.
-- Der Aufrufer nennt den zuletzt gelesenen Stand (p_expected_id/p_expected_revision; beide
-- NULL = „es gab noch keine Notiz“). Weicht der Stand ab, wird nichts geschrieben:
-- SQLSTATE TT007 – die Oberfläche behält den Text und lässt den Benutzer entscheiden.
-- Rückgabe: die gespeicherte Zeile bzw. keine Zeile, wenn die Notiz entfernt wurde.
create function public.save_daily_note(
  p_note_date date,
  p_content text,
  p_expected_id uuid default null,
  p_expected_revision integer default null
)
returns setof public.daily_notes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_existing public.daily_notes;
  v_note public.daily_notes;
begin
  if v_owner is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  if p_note_date is null or p_note_date not between date '2000-01-01' and date '2099-12-31' then
    raise exception 'Ungültiges Datum.' using errcode = 'invalid_parameter_value';
  end if;
  if p_content is not null and char_length(p_content) > 10000 then
    raise exception 'Die Notiz ist zu lang (höchstens 10 000 Zeichen).'
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_expected_id is null) <> (p_expected_revision is null) then
    raise exception 'Ungültiger Bearbeitungsstand.' using errcode = 'invalid_parameter_value';
  end if;

  -- Gleichzeitige Speichervorgänge für denselben Tag nacheinander verarbeiten
  -- (auch wenn noch keine Zeile existiert, die gesperrt werden könnte).
  perform pg_advisory_xact_lock(
    hashtextextended('tagestakt.daily_notes:' || v_owner::text || ':' || p_note_date::text, 0)
  );

  select * into v_existing
    from public.daily_notes
   where owner_id = v_owner and note_date = p_note_date
     for update;

  if v_existing.id is not null then
    if p_expected_id is distinct from v_existing.id
       or p_expected_revision is distinct from v_existing.revision then
      raise exception 'Die Notiz wurde inzwischen an anderer Stelle geändert.'
        using errcode = 'TT007';
    end if;
  elsif p_expected_id is not null then
    raise exception 'Die Notiz wurde inzwischen an anderer Stelle geändert.'
      using errcode = 'TT007';
  end if;

  -- Leer oder nur Leerraum: gespeicherte Notiz entfernen (keine Zeile zurückgeben).
  if p_content is null or p_content !~ '[^[:space:]]' then
    if v_existing.id is not null then
      delete from public.daily_notes where id = v_existing.id;
    end if;
    return;
  end if;

  if v_existing.id is null then
    insert into public.daily_notes (owner_id, note_date, content)
    values (v_owner, p_note_date, p_content)
    returning * into v_note;
  else
    update public.daily_notes
       set content = p_content
     where id = v_existing.id
    returning * into v_note;
  end if;

  return next v_note;
end;
$$;

revoke all on function public.save_daily_note(date, text, uuid, integer) from public, anon;
grant execute on function public.save_daily_note(date, text, uuid, integer)
  to authenticated, service_role;

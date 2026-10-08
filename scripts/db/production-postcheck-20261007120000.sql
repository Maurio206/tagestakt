-- =============================================================================
-- TagesTakt – Zwischenprüfung nach der Migration 20261007120000 (nur lesend)
--
-- Die Produktionsmigrationen werden einzeln angewendet. Diese Prüfung läuft nach der ersten
-- (Fokus-Erfassung und Ziele) und vor der zweiten (Tagesnotizen); nach der zweiten folgt
-- production-postcheck.sql. Prüft Struktur, RLS, Policies, Grants und Funktionen – ohne
-- Inhalte zu lesen. Jede fehlgeschlagene Prüfung bricht mit einer Meldung ab.
--
-- Lokal:      Teil von `pnpm db:upgrade-test`
-- Produktion: nur gemeinsam mit dem Benutzer, siehe docs/production-migration-runbook.md
-- =============================================================================
begin transaction read only;

do $$
declare
  v_count integer;
  v_function text;
begin
  -- Tabelle, RLS und genau vier Policies (SELECT/INSERT/UPDATE/DELETE) für authenticated.
  if to_regclass('public.activity_sessions') is null then
    raise exception 'activity_sessions fehlt';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.activity_sessions'::regclass) then
    raise exception 'RLS ist auf activity_sessions nicht aktiv';
  end if;
  select count(distinct cmd) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'activity_sessions' and roles = '{authenticated}';
  if v_count <> 4
     or (select count(*) from pg_policies
          where schemaname = 'public' and tablename = 'activity_sessions') <> 4 then
    raise exception 'activity_sessions: Policies nicht je Operation getrennt bzw. nicht auf authenticated beschränkt';
  end if;

  -- Grants: anon nichts, authenticated genau die vier Rechte, kein Leeren.
  if has_table_privilege('anon', 'public.activity_sessions',
                         'select, insert, update, delete, truncate, references, trigger') then
    raise exception 'anon hat Rechte auf activity_sessions';
  end if;
  if not has_table_privilege('authenticated', 'public.activity_sessions', 'select')
     or not has_table_privilege('authenticated', 'public.activity_sessions', 'insert')
     or not has_table_privilege('authenticated', 'public.activity_sessions', 'update')
     or not has_table_privilege('authenticated', 'public.activity_sessions', 'delete') then
    raise exception 'authenticated fehlen Rechte auf activity_sessions';
  end if;
  if has_table_privilege('authenticated', 'public.activity_sessions', 'truncate') then
    raise exception 'authenticated darf activity_sessions leeren';
  end if;

  -- Höchstens eine laufende Aktivität; Trigger im nicht exponierten Schema private.
  if to_regclass('public.activity_sessions_one_active_idx') is null then
    raise exception 'Index activity_sessions_one_active_idx fehlt';
  end if;
  select count(*) into v_count
    from pg_trigger
   where tgrelid = 'public.activity_sessions'::regclass
     and tgname in ('activity_sessions_guard', 'activity_sessions_set_updated_at');
  if v_count <> 2 then
    raise exception 'activity_sessions: % von 2 Triggern vorhanden', v_count;
  end if;

  -- RPCs: SECURITY INVOKER, leerer search_path, nicht für anon, für authenticated.
  foreach v_function in array array[
    'public.start_activity_session(text, text, uuid)',
    'public.stop_activity_session(uuid)',
    'public.correct_activity_session(uuid, timestamptz, timestamptz)',
    'public.switch_activity_session(uuid, text, text, uuid)'
  ] loop
    if to_regprocedure(v_function) is null then
      raise exception 'Funktion % fehlt', v_function;
    end if;
    if (select prosecdef from pg_proc where oid = to_regprocedure(v_function)) then
      raise exception 'Funktion % ist SECURITY DEFINER', v_function;
    end if;
    if has_function_privilege('anon', v_function, 'execute') then
      raise exception 'anon darf % ausführen', v_function;
    end if;
    if not has_function_privilege('authenticated', v_function, 'execute') then
      raise exception 'authenticated darf % nicht ausführen', v_function;
    end if;
    if not exists (select 1 from pg_proc
                    where oid = to_regprocedure(v_function)
                      and proconfig @> array['search_path=""']) then
      raise exception 'Funktion % hat keinen leeren search_path', v_function;
    end if;
  end loop;

  -- Neue Einstellungsspalten und der Fremdschlüssel-Zielschlüssel.
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public' and table_name = 'user_settings'
     and column_name in ('weekly_sport_target_minutes', 'weekly_relationship_target_minutes',
                         'reminder_minutes_before', 'remind_at_start', 'remind_if_not_started',
                         'reminder_scope');
  if v_count <> 6 then
    raise exception 'user_settings: % von 6 neuen Spalten vorhanden', v_count;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'schedule_entries_id_owner_key'
                    and conrelid = 'public.schedule_entries'::regclass) then
    raise exception 'Constraint schedule_entries_id_owner_key fehlt';
  end if;

  -- Genau dieser Zwischenstand: die zweite Migration ist noch nicht angewendet.
  if to_regclass('public.daily_notes') is not null
     or to_regprocedure('public.save_daily_note(date, text, uuid, integer)') is not null then
    raise exception 'Tagesnotizen sind bereits vorhanden – Zwischenstand stimmt nicht';
  end if;

  -- Weiterhin: keine Views im Schema public.
  if exists (select 1 from pg_views where schemaname = 'public') then
    raise exception 'Im Schema public existiert eine View';
  end if;
end;
$$;

select 'Zwischenprüfung nach 20261007120000 erfolgreich';

commit;

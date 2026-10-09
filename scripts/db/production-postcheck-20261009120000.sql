-- =============================================================================
-- TagesTakt – Nachprüfung nach Migration 20261009120000 (Wochenplaner; nur lesend)
--
-- Studio-Form: Im SQL-Editor als eigene Query vollständig ausführen. Prüft Struktur, RLS,
-- Policies, Grants und Funktionen – ohne Inhalte zu lesen. Jede fehlgeschlagene Prüfung bricht
-- mit einer Meldung ab; sonst liefert die letzte Anweisung die Erfolgszeile.
--
-- Lokal:      Teil von `pnpm db:upgrade-test`
-- Produktion: nur gemeinsam mit dem Benutzer, siehe docs/production-migration-20261009.md
-- =============================================================================
set transaction read only;

do $$
declare
  v_table text;
  v_function text;
  v_count integer;
begin
  -- Neue Tabellen: RLS, vier getrennte Policies für authenticated, Grants, Besitzerspalte.
  foreach v_table in array array['public.planning_preferences', 'public.planning_goal_slots'] loop
    if to_regclass(v_table) is null then
      raise exception '% fehlt', v_table;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass(v_table)) then
      raise exception 'RLS ist auf % nicht aktiv', v_table;
    end if;
    select count(distinct cmd) into v_count
      from pg_policies
     where schemaname || '.' || tablename = v_table and roles = '{authenticated}';
    if v_count <> 4
       or (select count(*) from pg_policies where schemaname || '.' || tablename = v_table) <> 4 then
      raise exception '%: Policies nicht je Operation getrennt bzw. nicht auf authenticated beschränkt',
        v_table;
    end if;
    if has_table_privilege('anon', v_table,
                           'select, insert, update, delete, truncate, references, trigger') then
      raise exception 'anon hat Rechte auf %', v_table;
    end if;
    if not has_table_privilege('authenticated', v_table, 'select')
       or not has_table_privilege('authenticated', v_table, 'insert')
       or not has_table_privilege('authenticated', v_table, 'update')
       or not has_table_privilege('authenticated', v_table, 'delete') then
      raise exception 'authenticated fehlen Rechte auf %', v_table;
    end if;
    if has_table_privilege('authenticated', v_table, 'truncate') then
      raise exception 'authenticated darf % leeren', v_table;
    end if;
    -- Standardwert über die Abhängigkeit prüfen (unabhängig vom search_path der Rolle).
    if not exists (
      select 1
        from pg_attribute a
        join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        join pg_depend dep on dep.classid = 'pg_attrdef'::regclass and dep.objid = d.oid
                          and dep.refclassid = 'pg_proc'::regclass
                          and dep.refobjid = 'auth.uid()'::regprocedure
       where a.attrelid = to_regclass(v_table) and a.attname = 'owner_id' and a.attnotnull
    ) then
      raise exception '%: owner_id ohne not null bzw. ohne Standard auth.uid()', v_table;
    end if;
    if not exists (select 1 from pg_trigger
                    where tgrelid = to_regclass(v_table) and not tgisinternal
                      and tgname like '%set_updated_at') then
      raise exception '%: updated_at-Trigger fehlt', v_table;
    end if;
  end loop;

  if not exists (select 1 from pg_constraint
                  where conname = 'planning_goal_slots_owner_goal_weekday_key'
                    and conrelid = 'public.planning_goal_slots'::regclass and contype = 'u') then
    raise exception 'Eindeutigkeit je Ziel und Wochentag fehlt';
  end if;

  -- RPCs: SECURITY INVOKER, leerer search_path, nicht für anon, für authenticated.
  foreach v_function in array array[
    'public.schedule_week_fingerprint(uuid)',
    'public.save_generated_schedule_draft(date, uuid, text, jsonb, text)',
    'public.publish_reviewed_schedule_week(uuid, text)'
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

  -- Bestehende Objekte unverändert vorhanden; keine Views im Schema public.
  if to_regclass('public.activity_sessions') is null or to_regclass('public.daily_notes') is null then
    raise exception 'Objekte früherer Migrationen fehlen';
  end if;
  if exists (select 1 from pg_views where schemaname = 'public') then
    raise exception 'Im Schema public existiert eine View';
  end if;
end;
$$;

select 'Nachprüfung 20261009120000 erfolgreich';

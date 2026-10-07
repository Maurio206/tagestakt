-- Tagesnotizen (daily_notes, save_daily_note):
--   * genau eine Notiz je Benutzer und Kalendertag, reiner Text mit Zeilenumbrüchen
--   * höchstens 10 000 Zeichen; leerer Inhalt entfernt die Notiz
--   * kein stilles Überschreiben (Fassung/Revision), Zeitstempel serverseitig
--   * RLS gegenüber anderen Benutzern, kein Zugriff für anon
--   * Notizen bleiben über neue Wochenplanversionen hinweg erhalten
-- Alle Inhalte sind frei erfundene Beispieltexte.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '88888888-8888-4888-8888-888888888888',
   'authenticated', 'authenticated', 'notiz@tagestakt.test', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-4999-8999-999999999999',
   'authenticated', 'authenticated', 'notiz-fremd@tagestakt.test', '', now(), now());

-- -----------------------------------------------------------------------------
-- Struktur und Rechte
-- -----------------------------------------------------------------------------
select has_table('public', 'daily_notes', 'Tabelle daily_notes existiert');
select is(
  (select relrowsecurity from pg_class where oid = 'public.daily_notes'::regclass),
  true, 'RLS ist auf daily_notes aktiv');
select col_type_is('public', 'daily_notes', 'note_date', 'date',
  'note_date ist ein reines Kalenderdatum');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.daily_notes'::regclass and contype = 'u'
      and conname = 'daily_notes_owner_date_key'),
  1, 'Unique-Constraint (owner_id, note_date): eine Notiz je Benutzer und Tag');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.daily_notes'::regclass and contype = 'f'),
  1, 'einziger Fremdschlüssel ist owner_id – kein Bezug zu Wochenplanversionen');
select is(
  (select prosecdef from pg_proc
    where oid = 'public.save_daily_note(date, text, uuid, integer)'::regprocedure),
  false, 'save_daily_note läuft als SECURITY INVOKER');
select is(
  (select proconfig from pg_proc
    where oid = 'public.save_daily_note(date, text, uuid, integer)'::regprocedure),
  array['search_path=""'], 'save_daily_note hat einen leeren search_path');

-- -----------------------------------------------------------------------------
-- Anonym
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.daily_notes $$, '42501', null,
  'anon: kein Lesezugriff auf daily_notes');
select throws_ok($$ select * from public.save_daily_note('2026-10-14', 'x') $$, '42501', null,
  'anon: kann keine Tagesnotiz speichern');
reset role;

-- -----------------------------------------------------------------------------
-- Eigentümer: anlegen, Zeilenumbrüche, serverseitige Felder, eine Notiz je Tag
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}', true);

select is(
  (select revision from public.save_daily_note('2026-10-14', E'Erste Zeile (Beispiel)\nZweite Zeile')),
  1, 'Eigentümer: neue Notiz wird mit Fassung 1 gespeichert');
select is(
  (select content from public.daily_notes where note_date = '2026-10-14'),
  E'Erste Zeile (Beispiel)\nZweite Zeile', 'Zeilenumbrüche bleiben erhalten');
select is(
  (select owner_id from public.daily_notes where note_date = '2026-10-14'),
  '88888888-8888-4888-8888-888888888888'::uuid, 'owner_id ist der angemeldete Benutzer');

select lives_ok(
  $$ insert into public.daily_notes (note_date, content, revision, created_at, updated_at)
     values ('2026-10-15', 'Direkt (Beispiel)', 99, '2001-01-01', '2001-01-01') $$,
  'Eigentümer: kann direkt eine Notiz anlegen');
select ok(
  (select revision = 1 and created_at > '2020-01-01' and updated_at > '2020-01-01'
     from public.daily_notes where note_date = '2026-10-15'),
  'revision, created_at und updated_at setzt der Server (Client-Werte werden ignoriert)');
select throws_ok(
  $$ insert into public.daily_notes (note_date, content) values ('2026-10-15', 'Zweite (Beispiel)') $$,
  '23505', null, 'höchstens eine Notiz je Benutzer und Datum');

-- -----------------------------------------------------------------------------
-- Speichern nur auf dem zuletzt gelesenen Stand
-- -----------------------------------------------------------------------------
select set_config('tagestakt.test_note',
  (select id::text from public.daily_notes where note_date = '2026-10-14'), true);

select is(
  (select revision from public.save_daily_note('2026-10-14', 'Geändert (Beispiel)',
     current_setting('tagestakt.test_note')::uuid, 1)),
  2, 'Speichern auf dem zuletzt gelesenen Stand erhöht die Fassung');
select throws_ok(
  $$ select * from public.save_daily_note('2026-10-14', 'Veraltet (Beispiel)',
       current_setting('tagestakt.test_note')::uuid, 1) $$,
  'TT007', 'Die Notiz wurde inzwischen an anderer Stelle geändert.',
  'veralteter Stand wird abgewiesen – Meldung ohne Notizinhalt');
select is(
  (select content from public.daily_notes where note_date = '2026-10-14'),
  'Geändert (Beispiel)', 'nach dem abgewiesenen Speichern bleibt die neuere Fassung erhalten');
select throws_ok(
  $$ select * from public.save_daily_note('2026-10-14', 'Ohne Stand (Beispiel)') $$,
  'TT007', null, 'ohne bekannten Stand wird eine vorhandene Notiz nicht überschrieben');
select throws_ok(
  $$ select * from public.save_daily_note('2026-10-20', 'x', gen_random_uuid(), 3) $$,
  'TT007', null, 'erwarteter Stand für einen Tag ohne Notiz wird abgewiesen');
select throws_ok(
  $$ select * from public.save_daily_note('2026-10-20', 'x', gen_random_uuid(), null) $$,
  '22023', null, 'unvollständiger Bearbeitungsstand wird abgewiesen');
select throws_ok(
  $$ select * from public.save_daily_note(null, 'x') $$,
  '22023', null, 'ohne Datum wird nichts gespeichert');
select throws_ok(
  $$ select * from public.save_daily_note('1999-12-31', 'x') $$,
  '22023', null, 'Datum außerhalb des gültigen Bereichs wird abgewiesen');

-- -----------------------------------------------------------------------------
-- Länge und Leerraum
-- -----------------------------------------------------------------------------
select is(
  (select char_length(content) from public.save_daily_note('2026-10-21', repeat('a', 10000))),
  10000, 'genau 10 000 Zeichen sind erlaubt');
select throws_ok(
  $$ select * from public.save_daily_note('2026-10-22', repeat('a', 10001)) $$,
  '22023', 'Die Notiz ist zu lang (höchstens 10 000 Zeichen).',
  'mehr als 10 000 Zeichen werden abgewiesen (RPC)');
select throws_ok(
  $$ insert into public.daily_notes (note_date, content) values ('2026-10-22', repeat('a', 10001)) $$,
  '23514', null, 'mehr als 10 000 Zeichen werden abgewiesen (Tabelle)');
select throws_ok(
  $$ insert into public.daily_notes (note_date, content) values ('2026-10-22', E' \n\t ') $$,
  '23514', null, 'eine Notiz nur aus Leerraum wird nicht gespeichert (Tabelle)');

select is(
  (select count(*)::int from public.save_daily_note('2026-10-14', E'  \n  ',
     current_setting('tagestakt.test_note')::uuid, 2)),
  0, 'leerer Inhalt liefert keine Zeile zurück');
select is_empty(
  $$ select 1 from public.daily_notes where note_date = '2026-10-14' $$,
  'leerer Inhalt entfernt die gespeicherte Notiz');
select is(
  (select count(*)::int from public.save_daily_note('2026-10-23', '   ')),
  0, 'leerer Inhalt ohne vorhandene Notiz legt nichts an');
select is_empty(
  $$ select 1 from public.daily_notes where note_date = '2026-10-23' $$,
  'für den leeren Tag existiert danach keine Notiz');

-- -----------------------------------------------------------------------------
-- Unveränderliche Felder, Fassung zählt mit
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ update public.daily_notes set note_date = '2026-10-16' where note_date = '2026-10-15' $$,
  '23514', null, 'das Datum einer Notiz ist unveränderlich');
select lives_ok(
  $$ update public.daily_notes set content = 'Direkt geändert (Beispiel)'
      where note_date = '2026-10-15' $$,
  'Eigentümer: kann seine Notiz direkt ändern');
select is(
  (select revision from public.daily_notes where note_date = '2026-10-15'),
  2, 'jede Änderung erhöht die Fassung');

-- -----------------------------------------------------------------------------
-- Notiz gehört zum Tag, nicht zur Planversion
-- -----------------------------------------------------------------------------
select set_config('tagestakt.test_week', (public.create_schedule_draft('2026-10-12')).id::text, true);
select lives_ok(
  $$ select public.publish_schedule_week(current_setting('tagestakt.test_week')::uuid) $$,
  'Version 1 der Woche veröffentlicht');
select set_config('tagestakt.test_week', (public.create_schedule_draft('2026-10-12')).id::text, true);
select lives_ok(
  $$ select public.publish_schedule_week(current_setting('tagestakt.test_week')::uuid) $$,
  'Version 2 veröffentlicht, Version 1 archiviert');
select results_eq(
  $$ select note_date, content, revision from public.daily_notes where note_date = '2026-10-15' $$,
  $$ values (date '2026-10-15', 'Direkt geändert (Beispiel)'::text, 2) $$,
  'Tagesnotiz bleibt über neue Planversionen hinweg unverändert');

reset role;
select set_config('tagestakt.test_note',
  (select id::text from public.daily_notes
    where note_date = '2026-10-15' and owner_id = '88888888-8888-4888-8888-888888888888'), true);

-- -----------------------------------------------------------------------------
-- Anderer angemeldeter Benutzer
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}', true);

select is_empty($$ select * from public.daily_notes $$,
  'fremd: sieht keine fremden Tagesnotizen');
select is_empty(
  $$ update public.daily_notes set content = 'Übernommen' returning id $$,
  'fremd: kann fremde Tagesnotizen nicht ändern');
select is_empty(
  $$ delete from public.daily_notes returning id $$,
  'fremd: kann fremde Tagesnotizen nicht löschen');
select throws_ok(
  $$ insert into public.daily_notes (owner_id, note_date, content)
     values ('88888888-8888-4888-8888-888888888888', '2026-10-24', 'x') $$,
  '42501', null, 'fremd: kann keine Notiz im Namen eines anderen anlegen');
select throws_ok(
  $$ select * from public.save_daily_note('2026-10-15', 'Übernommen',
       current_setting('tagestakt.test_note')::uuid, 2) $$,
  'TT007', null, 'fremd: kann eine fremde Notiz auch per RPC nicht überschreiben');
select lives_ok(
  $$ select * from public.save_daily_note('2026-10-15', 'Eigene Notiz (Beispiel)') $$,
  'fremd: darf für denselben Tag eine eigene Notiz anlegen');

reset role;

select results_eq(
  $$ select owner_id::text, content from public.daily_notes
      where note_date = '2026-10-15' order by owner_id $$,
  $$ values ('88888888-8888-4888-8888-888888888888'::text, 'Direkt geändert (Beispiel)'::text),
            ('99999999-9999-4999-8999-999999999999'::text, 'Eigene Notiz (Beispiel)'::text) $$,
  'Notiz des Eigentümers ist unverändert; der andere Benutzer hat nur seine eigene');

select * from finish();
rollback;

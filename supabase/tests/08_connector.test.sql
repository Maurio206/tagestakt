-- Claude-Connector: eigene Datenbankrolle und nicht exponiertes Schema connector.
-- Prüft Rollenattribute, Rechte, RLS, Prüfregeln (nur Hashes) und die Abgrenzung zu den
-- API-Rollen. Alle Daten frei erfunden (Beispiel).
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- -----------------------------------------------------------------------------
-- 1. Rolle
-- -----------------------------------------------------------------------------
select has_role('tagestakt_connector');
select results_eq(
  $$ select rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
       from pg_roles where rolname = 'tagestakt_connector' $$,
  $$ values (false, false, false, false, false, false) $$,
  'Connector-Rolle: kein Superuser, erbt nichts, keine Rollen-/DB-/Replikations-/RLS-Sonderrechte');
select is(
  (select string_agg(r.rolname::text, ',')
     from pg_auth_members a
     join pg_roles r on r.oid = a.roleid
     join pg_roles m on m.oid = a.member
    where m.rolname = 'tagestakt_connector'),
  'authenticated',
  'Connector-Rolle ist ausschließlich Mitglied von authenticated (nicht service_role)');

-- -----------------------------------------------------------------------------
-- 2. Struktur, RLS, Policies, Rechte
-- -----------------------------------------------------------------------------
select tables_are('connector', array[
  'oauth_authorization_codes', 'oauth_grants', 'oauth_tokens', 'publish_confirmations'
]);
select is(
  (select count(*)::int from pg_tables where schemaname = 'connector' and not rowsecurity),
  0,
  'RLS ist auf jeder Tabelle im connector-Schema aktiviert');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'connector'),
  0,
  'keine Funktionen im connector-Schema');
select is(
  (select count(*)::int from pg_views where schemaname = 'connector'),
  0,
  'keine Views im connector-Schema');

select policies_are('connector', 'oauth_authorization_codes', array[
  'oauth_authorization_codes: connector lesen', 'oauth_authorization_codes: connector anlegen',
  'oauth_authorization_codes: connector ändern', 'oauth_authorization_codes: connector löschen'
]);
select policies_are('connector', 'oauth_grants', array[
  'oauth_grants: connector lesen', 'oauth_grants: connector anlegen',
  'oauth_grants: connector ändern', 'oauth_grants: connector löschen'
]);
select policies_are('connector', 'oauth_tokens', array[
  'oauth_tokens: connector lesen', 'oauth_tokens: connector anlegen',
  'oauth_tokens: connector ändern', 'oauth_tokens: connector löschen'
]);
select policies_are('connector', 'publish_confirmations', array[
  'publish_confirmations: connector lesen', 'publish_confirmations: connector anlegen',
  'publish_confirmations: connector ändern', 'publish_confirmations: connector löschen'
]);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'connector' and (roles <> '{tagestakt_connector}' or cmd = 'ALL')),
  0,
  'Policies nur für die Connector-Rolle und je Operation getrennt');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'connector'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role', 'authenticator')),
  0,
  'API-Rollen haben keinerlei Rechte auf Connector-Tabellen');
select table_privs_are('connector', 'oauth_authorization_codes', 'tagestakt_connector',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('connector', 'oauth_grants', 'tagestakt_connector',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('connector', 'oauth_tokens', 'tagestakt_connector',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select table_privs_are('connector', 'publish_confirmations', 'tagestakt_connector',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
select schema_privs_are('connector', 'tagestakt_connector', array['USAGE']);
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'tagestakt_connector' and table_schema <> 'connector'),
  0,
  'Connector-Rolle hat außerhalb von connector keine eigenen Tabellenrechte');
select schema_privs_are('private', 'tagestakt_connector', array[]::text[]);

select has_index('connector', 'oauth_grants', 'oauth_grants_owner_idx', 'Index auf owner_id');
select has_index('connector', 'oauth_tokens', 'oauth_tokens_grant_idx', 'Index auf grant_id');

-- -----------------------------------------------------------------------------
-- 3. Verhalten (Rolle nur in dieser Testtransaktion nutzbar gemacht)
-- -----------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555',
        'authenticated', 'authenticated', 'connector@tagestakt.test', '', now(), now()),
       ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666',
        'authenticated', 'authenticated', 'fremd-connector@tagestakt.test', '', now(), now());
insert into public.schedule_weeks (id, owner_id, week_start, version, status)
values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', '55555555-5555-4555-8555-555555555555',
        '2026-10-12', 1, 'draft'),
       ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', '66666666-6666-4666-8666-666666666666',
        '2026-10-12', 1, 'draft');

grant tagestakt_connector to postgres;
-- pgTAP liegt im Schema extensions; nur für diese Testtransaktion nutzbar.
grant usage on schema extensions to tagestakt_connector;
set local role tagestakt_connector;

select lives_ok(
  $$ insert into connector.oauth_grants (id, owner_id, client_id, client_name, scopes, resource)
     values ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', '55555555-5555-4555-8555-555555555555',
             'https://client.tagestakt.test/metadata.json', 'Claude (Beispiel)',
             array['planning:read', 'planning:draft'], 'https://plan.tagestakt.test/mcp') $$,
  'Connector legt eine Freigabe an');
select throws_ok(
  $$ insert into connector.oauth_grants (owner_id, client_id, client_name, scopes, resource)
     values ('55555555-5555-4555-8555-555555555555', 'https://client.tagestakt.test/metadata.json',
             'Claude (Beispiel)', array['planning:admin'], 'https://plan.tagestakt.test/mcp') $$,
  '23514', null, 'nur die drei Planungs-Scopes sind erlaubt');
select throws_ok(
  $$ insert into connector.oauth_tokens (token_hash, grant_id, kind, expires_at)
     values ('klartext-token-beispiel', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'access',
             now() + interval '1 hour') $$,
  '23514', null, 'Tokens nur als SHA-256-Hash');
select lives_ok(
  $$ insert into connector.oauth_tokens (token_hash, grant_id, kind, expires_at)
     values (repeat('a', 64), 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'access',
             now() + interval '1 hour') $$,
  'Token-Hash wird gespeichert');
select throws_ok(
  $$ insert into connector.oauth_authorization_codes (code_hash, owner_id, client_id, client_name,
       redirect_uri, code_challenge, scopes, resource, expires_at)
     values (repeat('b', 64), '55555555-5555-4555-8555-555555555555',
             'https://client.tagestakt.test/metadata.json', 'Claude (Beispiel)',
             'https://client.tagestakt.test/callback', 'plain', array['planning:read'],
             'https://plan.tagestakt.test/mcp', now() + interval '5 minutes') $$,
  '23514', null, 'PKCE: nur S256-Challenges (Base64url, 43–128 Zeichen)');
select lives_ok(
  $$ insert into connector.publish_confirmations (confirmation_hash, grant_id, owner_id,
       schedule_week_id, fingerprint, expires_at)
     values (repeat('c', 64), 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
             '55555555-5555-4555-8555-555555555555', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
             repeat('d', 64), now() + interval '10 minutes') $$,
  'Veröffentlichungsbestätigung wird als Hash gespeichert');

select throws_ok(
  $$ select count(*) from public.schedule_weeks $$,
  '42501', null, 'Connector-Rolle selbst hat keine Rechte auf Planungsdaten');
select throws_ok(
  $$ select count(*) from auth.users $$,
  '42501', null, 'Connector-Rolle hat keinen Zugriff auf auth');

-- Planungsdaten nur als authenticated mit den Claims des Eigentümers (RLS greift).
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select id from public.schedule_weeks $$,
  $$ values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'::uuid) $$,
  'als authenticated sieht der Connector nur die Wochen des autorisierten Eigentümers');
select throws_ok(
  $$ select count(*) from connector.oauth_tokens $$,
  '42501', null, 'authenticated hat keinen Zugriff auf das Connector-Schema');

-- Verwerfen eines Entwurfs entfernt zugehörige Bestätigungen (Kaskade über die Rechtegrenze).
delete from public.schedule_weeks where id = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';

reset role;
select is(
  (select count(*)::int from connector.publish_confirmations),
  0,
  'Bestätigung verschwindet mit dem gelöschten Entwurf');

set local role anon;
select throws_ok(
  $$ select count(*) from connector.oauth_grants $$,
  '42501', null, 'anon hat keinen Zugriff auf das Connector-Schema');
reset role;
set local role service_role;
select throws_ok(
  $$ select count(*) from connector.oauth_grants $$,
  '42501', null, 'service_role hat keinen Zugriff auf das Connector-Schema');
reset role;

-- Löschen des Benutzers entfernt Freigaben und Token-Hashes.
delete from auth.users where id = '55555555-5555-4555-8555-555555555555';
select is(
  (select count(*)::int from connector.oauth_grants) + (select count(*)::int from connector.oauth_tokens),
  0,
  'Freigaben und Tokens werden mit dem Benutzer gelöscht');

select * from finish();
rollback;

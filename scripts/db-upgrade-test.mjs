#!/usr/bin/env node
/**
 * Lokaler Upgrade-Test: beweist, dass neue Migrationen bestehende Daten nicht verändern.
 *
 * Läuft in zwei Szenarien:
 *  - „cli“: Initialmigration per Supabase-CLI (Eigentümer postgres, Migrationsverlauf vorhanden),
 *  - „produktion“: wie in Produktion vorgefunden – Initialmigration als supabase_admin
 *    eingespielt (z. B. über den SQL-Editor von Studio), **kein** Migrationsverlauf (Fall 1).
 *    postgres fehlen dann genau die Rechte, die die Vorprüfung in Produktion gemeldet hat;
 *    migriert wird als supabase_admin.
 *
 * Je Szenario:
 *  1. lokale Datenbank auf den Stand der Initialmigration zurücksetzen (inkl. Seed), ggf. die
 *     Produktionslage herstellen,
 *  2. Daten in der Form des Produktionsstands einspielen (scripts/db/upgrade-fixture.sql),
 *  3. Fingerabdruck der Fachdaten erzeugen (scripts/db/data-fingerprint.sql) und die
 *     Vorprüfung prüfen (Fall des Migrationsverlaufs, Rechte der ausführenden Rolle),
 *  4. die Migrationen wie im Runbook **einzeln** anwenden: je Migration ein
 *     `psql --single-transaction -f <datei>` im Datenbank-Container (bei vorhandenem Verlauf mit
 *     `-c "<Eintrag im Verlauf>"`), danach Fingerabdruck vergleichen (muss identisch sein) und
 *     die passende lesende Prüfung (Zwischenprüfung bzw. scripts/db/production-postcheck.sql),
 *  5. Nachprüfungen als angemeldeter Benutzer (scripts/db/upgrade-postcheck.sql),
 *  6. Rückfall-Skripte der Runbooks (erst Wochenplanung/Connector, dann Tagesnotizen, dann
 *     Fokus-Erfassung) anwenden und prüfen, dass die Altdaten unverändert sind und vorhandene
 *     Planungsregeln bzw. Notizen nicht still gelöscht werden.
 * Zum Schluss wird die lokale Datenbank wieder vollständig zurückgesetzt.
 *
 * Arbeitet ausschließlich mit der lokalen Supabase-Instanz (Docker). Niemals gegen
 * Produktion verwenden.
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE_VERSION = "20261006120000";
const BASE_FILE = `${BASE_VERSION}_initial_schema.sql`;
const DB_CONTAINER = process.env.TAGESTAKT_LOCAL_DB_CONTAINER ?? "supabase_db_tagestakt";
const CONTAINER_DIR = "/tmp/tagestakt-upgrade-test";
const FIXTURE_OWNER = "0d3e0000-0000-4000-8000-0000000000a1";

/** Reihenfolge und Prüfung nach jeder Migration – wie im Runbook. */
const MIGRATIONS = [
  {
    version: "20261007120000",
    name: "focus_tracking_and_goals",
    check: "scripts/db/production-postcheck-20261007120000.sql",
    expect: "Zwischenprüfung nach 20261007120000 erfolgreich",
  },
  {
    version: "20261008120000",
    name: "daily_notes",
    check: "scripts/db/production-postcheck.sql",
    expect: "Nachprüfung erfolgreich",
  },
  {
    // Prüfungen in Studio-Form (wie in Produktion im SQL-Editor als supabase_admin).
    version: "20261009120000",
    name: "planning_rules",
    precheck: "scripts/db/production-precheck-20261009120000.sql",
    ready: "bereit_fuer_20261009120000=true",
    check: "scripts/db/production-postcheck-20261009120000.sql",
    expect: "Nachprüfung 20261009120000 erfolgreich",
    studio: true,
  },
];

const SCENARIOS = [
  {
    id: "cli",
    label: "Supabase-CLI: Eigentümer postgres, Migrationsverlauf vorhanden",
    migrateAs: "postgres",
    history: true,
  },
  {
    id: "produktion",
    label: "Produktionslage: Eigentümer supabase_admin, kein Migrationsverlauf",
    migrateAs: "supabase_admin",
    history: false,
    // Genau der Befund der Vorprüfung in Produktion (ausführende Rolle postgres).
    missingRights:
      "create_private,eigentuemer_schedule_entries,eigentuemer_user_settings,execute_set_updated_at",
  },
];

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...options });
}

/** Nur feste Argumente aus diesem Skript – keine Benutzereingaben in der Shell. */
function supabase(args) {
  const command = `pnpm exec supabase ${args.join(" ")}`;
  process.stdout.write(`> ${command}\n`);
  execSync(command, { stdio: ["ignore", "inherit", "inherit"] });
}

function psql(file, user = "postgres") {
  return psqlText(readFileSync(file, "utf8"), user);
}

function psqlText(sql, user = "postgres") {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      user,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-q",
    ],
    { encoding: "utf8", input: sql, stdio: ["pipe", "pipe", "inherit"] },
  ).trim();
}

/**
 * Prüfung in Studio-Form (`set transaction read only;` als erste Anweisung, ohne eigenes
 * begin/commit): Der SQL-Editor führt eine Query als eine Transaktion aus – hier ebenso.
 */
function psqlStudio(file, user = "postgres") {
  return psqlText(`begin;\n${readFileSync(file, "utf8")}\ncommit;`, user);
}

/** Führt eine Datei im Container wie im Runbook aus (`psql --single-transaction -f …`). */
function psqlFileInContainer(source, user, extraArgs = []) {
  const file = source.split("/").pop();
  docker(["cp", source, `${DB_CONTAINER}:${CONTAINER_DIR}/${file}`]);
  docker(
    [
      "exec",
      DB_CONTAINER,
      "psql",
      "-U",
      user,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "--single-transaction",
      "-q",
      "-f",
      `${CONTAINER_DIR}/${file}`,
      ...extraArgs,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

/**
 * Wendet eine Migration so an wie im Runbook (Coolify-Terminal im Datenbank-Container):
 * Datei und – falls es den Verlauf gibt – Eintrag im Migrationsverlauf in **einer**
 * Transaktion. Scheitert etwas, bleibt die Datenbank unverändert.
 */
function applyLikeProduction({ version, name }, scenario) {
  const file = `supabase/migrations/${version}_${name}.sql`;
  const history = scenario.history
    ? [
        "-c",
        `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}')`,
      ]
    : [];
  process.stdout.write(
    `> psql -U ${scenario.migrateAs} --single-transaction -f ${version}_${name}.sql` +
      `${scenario.history ? " (+ Eintrag im Verlauf)" : ""}\n`,
  );
  psqlFileInContainer(file, scenario.migrateAs, history);
}

/**
 * Stellt die Produktionslage her: Die Objekte der Initialmigration werden entfernt und von
 * supabase_admin neu angelegt (wie über den SQL-Editor von Studio) – damit gelten auch dessen
 * Standardrechte. Der Migrationsverlauf wird ausgeblendet (Fall 1). Nur lokal; am Ende folgt
 * ein vollständiges Zurücksetzen.
 */
function recreateBaseAsSupabaseAdmin() {
  psqlText(
    `drop schema private cascade;
     drop table public.schedule_entries, public.schedule_weeks, public.recurring_commitments,
                public.user_settings cascade;
     -- Zum Teil schon per cascade entfernt (Rückgabetypen hängen an den Tabellen).
     drop function if exists public.publish_schedule_week(uuid), public.create_schedule_draft(date),
                   public.add_schedule_entries(uuid, jsonb, boolean);
     alter table supabase_migrations.schema_migrations rename to schema_migrations_tt_hidden;`,
    "supabase_admin",
  );
  psqlFileInContainer(`supabase/migrations/${BASE_FILE}`, "supabase_admin");
  process.stdout.write("Produktionslage hergestellt: Initialmigration als supabase_admin.\n");
}

/** Die Rechteprüfung der Vorprüfung muss fehlende Rechte erkennen (Rolle nur für diesen Test). */
function checkRightsDetection() {
  const precheck = readFileSync("scripts/db/production-precheck.sql", "utf8");
  if (!/rechte_fuer_migration=true/.test(psqlText(precheck))) {
    throw new Error("Vorprüfung meldet für postgres fehlende Rechte.");
  }
  const probe = precheck
    .replace(
      /^begin transaction read only;$/m,
      `begin;
       create role tt_precheck_probe;
       grant tt_precheck_probe to current_user;
       grant usage on schema supabase_migrations to tt_precheck_probe;
       grant select on supabase_migrations.schema_migrations to tt_precheck_probe;
       set local role tt_precheck_probe;`,
    )
    .replace(/^commit;\s*$/m, "rollback;");
  const output = psqlText(probe);
  if (
    !output.includes("rechte_fuer_migration=false") ||
    !output.includes("eigentuemer_user_settings")
  ) {
    throw new Error("Vorprüfung erkennt fehlende Rechte nicht.");
  }
  process.stdout.write("Vorprüfung erkennt fehlende Rechte der ausführenden Rolle.\n");
}

/**
 * Die Vorprüfung muss alle drei Zustände des Migrationsverlaufs erkennen. Die Fälle 1 und 2
 * werden lokal kurz nachgestellt und sofort wiederhergestellt.
 */
function checkHistoryCases() {
  const historyCase = () =>
    /migrationsverlauf_fall=(\S+)/.exec(psql("scripts/db/production-precheck.sql"))?.[1];

  if (historyCase() !== "3-initialmigration-eingetragen") {
    throw new Error("Vorprüfung erkennt den eingetragenen Migrationsverlauf nicht (Fall 3).");
  }

  psqlText(`create table supabase_migrations.schema_migrations_tt_backup as
              select * from supabase_migrations.schema_migrations;
            delete from supabase_migrations.schema_migrations where version = '${BASE_VERSION}';`);
  try {
    if (historyCase() !== "2-initialmigration-nicht-eingetragen") {
      throw new Error("Vorprüfung erkennt die fehlende Initialmigration nicht (Fall 2).");
    }
  } finally {
    psqlText(`insert into supabase_migrations.schema_migrations
                select * from supabase_migrations.schema_migrations_tt_backup
                 where version = '${BASE_VERSION}';
              drop table supabase_migrations.schema_migrations_tt_backup;`);
  }

  psqlText(
    `alter table supabase_migrations.schema_migrations rename to schema_migrations_tt_hidden;`,
  );
  try {
    if (historyCase() !== "1-tabelle-fehlt") {
      throw new Error("Vorprüfung erkennt die fehlende Verlaufstabelle nicht (Fall 1).");
    }
  } finally {
    psqlText(
      `alter table supabase_migrations.schema_migrations_tt_hidden rename to schema_migrations;`,
    );
  }
  process.stdout.write("Vorprüfung unterscheidet alle drei Fälle des Migrationsverlaufs.\n");
}

/** Produktionslage: Vorprüfung als postgres meldet genau den Produktionsbefund. */
function checkProductionPrecheck(scenario) {
  const asPostgres = psql("scripts/db/production-precheck.sql");
  process.stdout.write(`Vorprüfung (postgres):\n${asPostgres}\n`);
  for (const expected of [
    "migrationsverlauf_fall=1-tabelle-fehlt",
    "eigentuemer_bestehender_tabellen=supabase_admin",
    `fehlende_rechte=${scenario.missingRights}`,
    "rechte_fuer_migration=false",
  ]) {
    if (!asPostgres.split("\n").includes(expected)) {
      throw new Error(`Produktionslage nicht getroffen – erwartet: ${expected}`);
    }
  }
  const asAdmin = psql("scripts/db/production-precheck.sql", "supabase_admin");
  if (!asAdmin.split("\n").includes("rechte_fuer_migration=true")) {
    throw new Error("supabase_admin fehlen Rechte für die Migration.");
  }
  process.stdout.write("Vorprüfung: postgres wie in Produktion ohne Rechte, supabase_admin mit.\n");
}

/** Neue Objekte gehören wie die bestehenden supabase_admin. */
function checkOwnership() {
  const foreign = psqlText(
    `select coalesce(string_agg(name, ', '), '') from (
       select c.oid::regclass::text as name, c.relowner as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'private', 'connector') and c.relkind in ('r', 'p')
       union all
       select p.oid::regprocedure::text, p.proowner
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private', 'connector')
     ) objekte
     where pg_get_userbyid(owner) <> 'supabase_admin';`,
  );
  if (foreign) {
    throw new Error(`Objekte mit anderem Eigentümer als supabase_admin: ${foreign}`);
  }
  process.stdout.write("Alle Tabellen und Funktionen gehören supabase_admin.\n");
}

/** Vorprüfung vor 20261009120000: bereit für die migrierende Rolle, sonst fehlende Rechte. */
function checkPlanningPrecheck(migration, scenario) {
  const output = psqlStudio(migration.precheck, scenario.migrateAs);
  process.stdout.write(`Vorprüfung ${migration.version} (${scenario.migrateAs}):\n${output}\n`);
  if (!output.split("\n").includes(migration.ready)) {
    throw new Error(`Vorprüfung ${migration.version} meldet nicht bereit.`);
  }
  if (scenario.id === "produktion") {
    // Wie in Produktion: postgres fehlen Rechte – die Vorprüfung muss das erkennen.
    const asPostgres = psqlStudio(migration.precheck, "postgres");
    if (
      !asPostgres.includes(migration.ready.replace("=true", "=false")) ||
      !/fehlende_rechte=\S*execute_set_updated_at/.test(asPostgres)
    ) {
      throw new Error("Vorprüfung erkennt die fehlenden Rechte von postgres nicht.");
    }
  }
}

/**
 * Rückfall 20261009120000: bricht bei gespeicherten Planungsregeln ohne Bestätigung ab; entfernt
 * Connector-Schema (auch mit vorhandener Freigabe) und Connector-Rolle.
 */
function checkPlanningRollback(scenario) {
  psqlText(
    `insert into connector.oauth_grants (owner_id, client_id, client_name, scopes, resource)
            values ('${FIXTURE_OWNER}', 'https://client.tagestakt.test/metadata.json',
                    'Claude (Beispiel)', array['planning:read'], 'https://plan.tagestakt.test/mcp');`,
    scenario.migrateAs,
  );
  psqlText(`insert into public.planning_preferences (
              owner_id, business_earliest_start, business_latest_end, business_min_block_minutes,
              business_max_block_minutes, business_max_daily_minutes,
              business_saturday_max_minutes, business_sunday_max_minutes, buffer_minutes)
            values ('${FIXTURE_OWNER}', '08:00', '20:00', 60, 180, 240, 0, 0, 15);`);
  let aborted = false;
  try {
    psql("scripts/db/rollback-20261009120000.sql", scenario.migrateAs);
  } catch {
    aborted = true;
  }
  if (!aborted || psqlText("select count(*) from public.planning_preferences;") !== "1") {
    throw new Error("Der Rückfall hätte Planungsregeln ohne Bestätigung gelöscht.");
  }
  process.stdout.write("Rückfall 20261009120000 bricht bei vorhandenen Planungsregeln ab.\n");
  psqlText("delete from public.planning_preferences;");
  psql("scripts/db/rollback-20261009120000.sql", scenario.migrateAs);
  const left = psqlText(
    `select (to_regclass('public.planning_preferences') is null
             and to_regclass('public.planning_goal_slots') is null
             and to_regprocedure('public.publish_reviewed_schedule_week(uuid, text)') is null
             and to_regprocedure('public.discard_reviewed_schedule_draft(uuid, text)') is null
             and not exists (select 1 from pg_namespace where nspname = 'connector')
             and not exists (select 1 from pg_roles where rolname = 'tagestakt_connector'))::text;`,
  );
  if (left !== "true") throw new Error("Der Rückfall 20261009120000 hat Objekte übrig gelassen.");
}

/** Rückfall des Runbooks: entfernt nur die neuen Objekte, Altdaten bleiben identisch. */
function checkRollback(scenario, before) {
  checkPlanningRollback(scenario);
  if (psql("scripts/db/data-fingerprint.sql") !== before) {
    throw new Error("Der Rückfall 20261009120000 hat bestehende Daten verändert.");
  }
  // Vorhandene Tagesnotizen dürfen ohne ausdrückliche Bestätigung nicht verloren gehen.
  psqlText(`insert into public.daily_notes (owner_id, note_date, content)
            values ('${FIXTURE_OWNER}', '2026-10-14', 'Beispielnotiz');`);
  let rollbackAborted = false;
  try {
    psql("scripts/db/rollback-20261008120000.sql", scenario.migrateAs);
  } catch {
    rollbackAborted = true;
  }
  if (!rollbackAborted || psqlText("select count(*) from public.daily_notes;") !== "1") {
    throw new Error("Der Rückfall hätte vorhandene Tagesnotizen ohne Bestätigung gelöscht.");
  }
  process.stdout.write("Rückfall bricht bei vorhandenen Tagesnotizen ohne Bestätigung ab.\n");
  psqlText("delete from public.daily_notes;");
  psql("scripts/db/rollback-20261008120000.sql", scenario.migrateAs);
  psql("scripts/db/rollback-20261007120000.sql", scenario.migrateAs);
  if (psql("scripts/db/data-fingerprint.sql") !== before) {
    throw new Error("Der Rückfall hat bestehende Daten verändert.");
  }
  const afterRollback = psql("scripts/db/production-precheck.sql");
  if (
    !afterRollback.includes("activity_sessions_vorhanden=false") ||
    !afterRollback.includes("daily_notes_vorhanden=false")
  ) {
    throw new Error("Der Rückfall hat nicht alle neuen Objekte entfernt.");
  }
  process.stdout.write("Rückfall geprüft: Altdaten unverändert, neue Objekte entfernt.\n");
}

/**
 * Rollen gelten für den ganzen Cluster und überstehen `supabase db reset`. Damit die Vorprüfung
 * wie in Produktion einen Cluster ohne Connector-Rolle vorfindet, wird sie lokal entfernt.
 */
function dropLocalConnectorRole() {
  psqlText(`do $$
             begin
               if exists (select 1 from pg_roles where rolname = 'tagestakt_connector') then
                 revoke authenticated from tagestakt_connector;
                 drop role tagestakt_connector;
               end if;
             end;
             $$;`);
}

function runScenario(scenario) {
  process.stdout.write(`\n=== Szenario ${scenario.id}: ${scenario.label}\n`);
  supabase(["db", "reset", "--version", BASE_VERSION]);
  dropLocalConnectorRole();
  docker(["exec", DB_CONTAINER, "mkdir", "-p", CONTAINER_DIR]);
  if (scenario.id === "produktion") recreateBaseAsSupabaseAdmin();
  psql("scripts/db/upgrade-fixture.sql");
  const before = psql("scripts/db/data-fingerprint.sql");
  process.stdout.write(`Fingerabdruck vorher:\n${before}\n`);

  if (scenario.history) {
    process.stdout.write(`Vorprüfung:\n${psql("scripts/db/production-precheck.sql")}\n`);
    checkHistoryCases();
    checkRightsDetection();
  } else {
    checkProductionPrecheck(scenario);
  }

  for (const migration of MIGRATIONS) {
    if (migration.precheck) checkPlanningPrecheck(migration, scenario);
    applyLikeProduction(migration, scenario);
    if (psql("scripts/db/data-fingerprint.sql") !== before) {
      throw new Error(`Bestehende Daten wurden durch ${migration.version} verändert.`);
    }
    const result = migration.studio
      ? psqlStudio(migration.check, scenario.migrateAs)
      : psql(migration.check);
    if (!result.includes(migration.expect)) {
      throw new Error(`Prüfung nach ${migration.version} fehlgeschlagen.`);
    }
    process.stdout.write(`${migration.version}: Altdaten unverändert, ${migration.expect}.\n`);
  }
  if (scenario.history) {
    // Verlauf korrekt eingetragen: Die Supabase-CLI hat nichts mehr anzuwenden.
    supabase(["migration", "up", "--local"]);
    if (psql("scripts/db/data-fingerprint.sql") !== before) {
      throw new Error("Bestehende Daten wurden durch die Migration verändert.");
    }
  } else {
    checkOwnership();
  }

  psql("scripts/db/upgrade-postcheck.sql");
  process.stdout.write("Nachprüfungen erfolgreich.\n");
  checkRollback(scenario, before);
}

let failed = false;
try {
  for (const scenario of SCENARIOS) runScenario(scenario);
  process.stdout.write("\nUpgrade-Test in allen Szenarien erfolgreich.\n");
} catch (error) {
  failed = true;
  process.stderr.write(`Upgrade-Test fehlgeschlagen: ${error.message}\n`);
} finally {
  docker(["exec", DB_CONTAINER, "rm", "-rf", CONTAINER_DIR]);
  supabase(["db", "reset"]);
}

process.exitCode = failed ? 1 : 0;

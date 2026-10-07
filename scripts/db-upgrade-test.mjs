#!/usr/bin/env node
/**
 * Lokaler Upgrade-Test: beweist, dass neue Migrationen bestehende Daten nicht verändern.
 *
 *  1. lokale Datenbank auf den Stand der Initialmigration zurücksetzen (inkl. Seed),
 *  2. Daten in der Form des Produktionsstands einspielen (scripts/db/upgrade-fixture.sql),
 *  3. Fingerabdruck der Fachdaten erzeugen (scripts/db/data-fingerprint.sql),
 *     und die Vorprüfung in allen drei Fällen des Migrationsverlaufs prüfen,
 *  4. alle ausstehenden Migrationen anwenden (`supabase migration up --local`),
 *  5. Fingerabdruck erneut erzeugen und vergleichen – muss identisch sein,
 *  6. Nachprüfungen als angemeldeter Benutzer (scripts/db/upgrade-postcheck.sql) und die
 *     lesenden Produktionsprüfungen des Runbooks (scripts/db/production-*check.sql),
 *  7. Rückfall-Skript des Runbooks anwenden und prüfen, dass die Altdaten unverändert sind,
 *  8. lokale Datenbank wieder vollständig zurücksetzen.
 *
 * Arbeitet ausschließlich mit der lokalen Supabase-Instanz (Docker). Niemals gegen
 * Produktion verwenden.
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE_VERSION = "20261006120000";
const DB_CONTAINER = process.env.TAGESTAKT_LOCAL_DB_CONTAINER ?? "supabase_db_tagestakt";

/** Nur feste Argumente aus diesem Skript – keine Benutzereingaben in der Shell. */
function supabase(args) {
  const command = `pnpm exec supabase ${args.join(" ")}`;
  process.stdout.write(`> ${command}\n`);
  execSync(command, { stdio: ["ignore", "inherit", "inherit"] });
}

function psql(file) {
  return psqlText(readFileSync(file, "utf8"));
}

function psqlText(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
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
 * Die Vorprüfung muss alle drei Zustände des Migrationsverlaufs erkennen. Die Fälle 1 und 2
 * werden lokal kurz nachgestellt und sofort wiederhergestellt (am Ende folgt ohnehin ein
 * vollständiges Zurücksetzen).
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

let failed = false;
try {
  supabase(["db", "reset", "--version", BASE_VERSION]);
  psql("scripts/db/upgrade-fixture.sql");
  const before = psql("scripts/db/data-fingerprint.sql");
  process.stdout.write(`Fingerabdruck vorher:\n${before}\n`);
  process.stdout.write(`Vorprüfung:\n${psql("scripts/db/production-precheck.sql")}\n`);
  checkHistoryCases();

  supabase(["migration", "up", "--local"]);
  const after = psql("scripts/db/data-fingerprint.sql");
  process.stdout.write(`Fingerabdruck nachher:\n${after}\n`);

  if (before !== after) {
    throw new Error("Bestehende Daten wurden durch die Migration verändert.");
  }
  process.stdout.write("Bestehende Daten unverändert.\n");

  psql("scripts/db/upgrade-postcheck.sql");
  process.stdout.write("Nachprüfungen erfolgreich.\n");
  process.stdout.write(`${psql("scripts/db/production-postcheck.sql")}\n`);

  // Rückfall des Runbooks: entfernt nur die neuen Objekte, Altdaten bleiben identisch.
  psql("scripts/db/rollback-20261007120000.sql");
  if (psql("scripts/db/data-fingerprint.sql") !== before) {
    throw new Error("Der Rückfall hat bestehende Daten verändert.");
  }
  if (!psql("scripts/db/production-precheck.sql").includes("activity_sessions_vorhanden=false")) {
    throw new Error("Der Rückfall hat nicht alle neuen Objekte entfernt.");
  }
  process.stdout.write("Rückfall geprüft: Altdaten unverändert, neue Objekte entfernt.\n");
} catch (error) {
  failed = true;
  process.stderr.write(`Upgrade-Test fehlgeschlagen: ${error.message}\n`);
} finally {
  supabase(["db", "reset"]);
}

process.exitCode = failed ? 1 : 0;

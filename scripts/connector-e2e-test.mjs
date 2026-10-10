#!/usr/bin/env node
/**
 * Datenbank-E2E-Tests des Claude-Connectors – NUR gegen die lokale Supabase-Instanz (Docker).
 *
 *  1. gibt der Rolle tagestakt_connector lokal ein zufälliges Einmal-Passwort (LOGIN),
 *  2. legt zwei frei erfundene Test-Benutzer an (Eigentümer und fremdes Konto),
 *  3. startet apps/web/src/server/connector/connector.e2e.test.ts (vitest.e2e.config.ts),
 *  4. löscht die Test-Benutzer samt aller Daten wieder und setzt die Rolle auf NOLOGIN zurück.
 *
 * Das Passwort existiert nur im Speicher dieses Prozesses und wird nie ausgegeben.
 * Niemals gegen Produktion verwenden.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const DB_CONTAINER = process.env.TAGESTAKT_LOCAL_DB_CONTAINER ?? "supabase_db_tagestakt";
const DB_PORT = process.env.TAGESTAKT_LOCAL_DB_PORT ?? "54322";
const OWNER = "e2e00000-0000-4000-8000-0000000000a1";
const FOREIGN = "e2e00000-0000-4000-8000-0000000000a2";

function psql(sql) {
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

function cleanup() {
  psql(`delete from auth.users where id in ('${OWNER}', '${FOREIGN}');
        alter role tagestakt_connector with nologin password null;`);
}

// Nur Hex-Zeichen: kein Quoting-Risiko im SQL, nichts davon wird protokolliert.
const password = randomBytes(24).toString("hex");
let failed = false;
try {
  cleanup();
  psql(`alter role tagestakt_connector with login password '${password}';
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', '${OWNER}', 'authenticated', 'authenticated',
                'connector-e2e@tagestakt.test', '', now(), now()),
               ('00000000-0000-0000-0000-000000000000', '${FOREIGN}', 'authenticated', 'authenticated',
                'fremd-e2e@tagestakt.test', '', now(), now());`);

  // Fester Befehl ohne Benutzereingaben (Shell nötig für pnpm.cmd unter Windows).
  const result = spawnSync(
    "pnpm --filter @tagestakt/web exec vitest run --config vitest.e2e.config.ts",
    {
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        TAGESTAKT_E2E_DATABASE_URL: `postgres://tagestakt_connector:${password}@127.0.0.1:${DB_PORT}/postgres`,
        TAGESTAKT_E2E_OWNER: OWNER,
        TAGESTAKT_E2E_FOREIGN: FOREIGN,
      },
    },
  );
  failed = result.status !== 0;
} catch (error) {
  failed = true;
  process.stderr.write(
    `Connector-E2E-Test fehlgeschlagen: ${error instanceof Error ? error.message : error}\n`,
  );
} finally {
  try {
    cleanup();
  } catch {
    failed = true;
    process.stderr.write("Aufräumen fehlgeschlagen – läuft die lokale Supabase-Instanz?\n");
  }
}

process.stdout.write(
  failed ? "Connector-E2E-Test fehlgeschlagen.\n" : "Connector-E2E-Test erfolgreich.\n",
);
process.exitCode = failed ? 1 : 0;

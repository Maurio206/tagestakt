#!/usr/bin/env node
/**
 * Lokaler Nebenläufigkeitstest für die Fokus-Erfassung (nur lokale Supabase-Instanz in Docker).
 *
 * pgTAP läuft in einer einzigen Transaktion und kann echte Gleichzeitigkeit nicht prüfen.
 * Dieses Skript öffnet zwei gleichzeitige Datenbanksitzungen desselben Test-Benutzers:
 *
 *  1. zwei gleichzeitige Wechsel derselben laufenden Aktivität → genau einer gelingt,
 *     der andere wird mit TT002 (veralteter Stand) abgewiesen,
 *  2. gleichzeitiger Wechsel und Start → der Start wird mit TT001 abgewiesen,
 *
 * und prüft danach, dass nie mehr als eine Aktivität läuft. Der Test-Benutzer wird am Ende
 * samt Daten wieder gelöscht. Niemals gegen Produktion verwenden.
 */
import { spawn, execFileSync } from "node:child_process";

const DB_CONTAINER = process.env.TAGESTAKT_LOCAL_DB_CONTAINER ?? "supabase_db_tagestakt";
const USER_ID = "77777777-7777-4777-8777-777777777777";

function psqlArgs() {
  return [
    "exec",
    "-i",
    DB_CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-At",
    "-q",
  ];
}

function psql(sql) {
  return execFileSync("docker", [...psqlArgs(), "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8",
    input: sql,
    stdio: ["pipe", "pipe", "inherit"],
  }).trim();
}

/** Startet eine Sitzung, die als Test-Benutzer `call` ausführt und die Sperre kurz hält. */
function session(call, delayMs) {
  const sql = `\\set VERBOSITY verbose
\\set ON_ERROR_STOP 1
select pg_sleep(${delayMs / 1000});
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${USER_ID}","role":"authenticated"}', true);
select (${call}).id;
select pg_sleep(1.5);
commit;
`;
  return new Promise((resolve) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.resume();
    child.on("close", (code) => {
      const sqlstate = /ERROR:\s+([0-9A-Z]{5}):/.exec(stderr)?.[1] ?? null;
      resolve({ ok: code === 0, sqlstate });
    });
    child.stdin.end(sql);
  });
}

function runningCount() {
  return Number(
    psql(`select count(*) from public.activity_sessions
           where owner_id = '${USER_ID}' and ended_at is null;`),
  );
}

function setupRunning() {
  psql(`delete from public.activity_sessions where owner_id = '${USER_ID}';`);
  return psql(`insert into public.activity_sessions (owner_id, goal_category, title, started_at)
                values ('${USER_ID}', 'business', 'Konkurrenz (Beispiel)',
                        now() - interval '10 minutes')
                returning id;`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  process.stdout.write(`ok – ${message}\n`);
}

let failed = false;
try {
  psql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', '${USER_ID}', 'authenticated',
                'authenticated', 'konkurrenz@tagestakt.test', '', now(), now())
        on conflict (id) do nothing;`);

  // 1. Zwei gleichzeitige Wechsel derselben laufenden Aktivität.
  let running = setupRunning();
  const [first, second] = await Promise.all([
    session(`public.switch_activity_session('${running}', 'sport')`, 0),
    session(`public.switch_activity_session('${running}', 'relationship')`, 300),
  ]);
  const results = [first, second];
  assert(results.filter((r) => r.ok).length === 1, "genau ein gleichzeitiger Wechsel gelingt");
  assert(
    results.some((r) => !r.ok && r.sqlstate === "TT002"),
    "der zweite Wechsel wird als veraltet abgewiesen (TT002)",
  );
  assert(runningCount() === 1, "danach läuft genau eine Aktivität");
  assert(
    psql(`select ended_at is not null from public.activity_sessions where id = '${running}';`) ===
      "t",
    "die ursprüngliche Aktivität ist beendet",
  );

  // 2. Gleichzeitiger Wechsel und Start.
  running = setupRunning();
  const [switched, started] = await Promise.all([
    session(`public.switch_activity_session('${running}', 'sport')`, 0),
    session(`public.start_activity_session('relationship')`, 300),
  ]);
  assert(switched.ok, "der Wechsel gelingt");
  assert(
    !started.ok && started.sqlstate === "TT001",
    "der gleichzeitige Start wird abgewiesen (TT001)",
  );
  assert(runningCount() === 1, "auch dann läuft genau eine Aktivität");
} catch (error) {
  failed = true;
  process.stderr.write(`Nebenläufigkeitstest fehlgeschlagen: ${error.message}\n`);
} finally {
  psql(`delete from auth.users where id = '${USER_ID}';`);
}

process.exitCode = failed ? 1 : 0;

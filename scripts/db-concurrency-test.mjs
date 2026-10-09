#!/usr/bin/env node
/**
 * Lokaler Nebenläufigkeitstest für Fokus-Erfassung, Tagesnotizen und Wochenplaner (nur lokale
 * Supabase-Instanz).
 *
 * pgTAP läuft in einer einzigen Transaktion und kann echte Gleichzeitigkeit nicht prüfen.
 * Dieses Skript öffnet zwei gleichzeitige Datenbanksitzungen desselben Test-Benutzers:
 *
 *  1. zwei gleichzeitige Wechsel derselben laufenden Aktivität → genau einer gelingt,
 *     der andere wird mit TT002 (veralteter Stand) abgewiesen,
 *  2. gleichzeitiger Wechsel und Start → der Start wird mit TT001 abgewiesen,
 *  3. zwei gleichzeitige Speichervorgänge einer Tagesnotiz auf demselben Stand → genau einer
 *     gelingt, der andere wird mit TT007 abgewiesen (kein stilles Überschreiben),
 *  4. zwei gleichzeitige Erstanlagen derselben Tagesnotiz → genau eine Notiz,
 *  5. Wochenplaner: zwei gleichzeitige Planungen ohne Entwurf → genau ein Entwurf, die zweite
 *     wird mit TT008 abgewiesen (kein stilles Überschreiben),
 *  6. zwei gleichzeitige Freigaben desselben geprüften Entwurfs (Doppelklick in zwei Tabs) →
 *     beide gelingen, veröffentlicht ist genau eine Version,
 *  7. gleichzeitiges Veröffentlichen und Neu-Planen → genau eines gelingt, das andere TT008,
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

/** Einzelne Abfrage als Test-Benutzer (Rolle authenticated, RLS aktiv). */
function asUser(expression) {
  return psql(`begin;
    set local role authenticated;
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${USER_ID}","role":"authenticated"}', true);
    end $$;
    select ${expression};
    commit;`);
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

  // 3. Tagesnotiz: zwei gleichzeitige Speichervorgänge auf demselben gelesenen Stand.
  psql(`delete from public.daily_notes where owner_id = '${USER_ID}';`);
  const note = psql(`insert into public.daily_notes (owner_id, note_date, content)
                     values ('${USER_ID}', '2026-10-14', 'Ausgang (Beispiel)')
                     returning id;`);
  const saves = await Promise.all([
    session(`public.save_daily_note('2026-10-14', 'Fassung A (Beispiel)', '${note}', 1)`, 0),
    session(`public.save_daily_note('2026-10-14', 'Fassung B (Beispiel)', '${note}', 1)`, 300),
  ]);
  assert(saves.filter((r) => r.ok).length === 1, "genau ein gleichzeitiges Speichern gelingt");
  assert(
    saves.some((r) => !r.ok && r.sqlstate === "TT007"),
    "das zweite Speichern wird als veraltet abgewiesen (TT007) statt still zu überschreiben",
  );
  assert(
    psql(`select content || '|' || revision from public.daily_notes
           where owner_id = '${USER_ID}' and note_date = '2026-10-14';`) ===
      "Fassung A (Beispiel)|2",
    "gespeichert ist genau die erste Fassung (Revision 2)",
  );

  // 4. Tagesnotiz: zwei gleichzeitige Erstanlagen für denselben Tag.
  const creates = await Promise.all([
    session(`public.save_daily_note('2026-10-15', 'Neu A (Beispiel)')`, 0),
    session(`public.save_daily_note('2026-10-15', 'Neu B (Beispiel)')`, 300),
  ]);
  assert(creates.filter((r) => r.ok).length === 1, "genau eine gleichzeitige Erstanlage gelingt");
  assert(
    creates.some((r) => !r.ok && r.sqlstate === "TT007"),
    "die zweite Erstanlage wird abgewiesen (TT007)",
  );
  assert(
    psql(`select count(*) from public.daily_notes
           where owner_id = '${USER_ID}' and note_date = '2026-10-15';`) === "1",
    "für den Tag existiert genau eine Notiz",
  );

  // 5.–7. Wochenplaner (Prüfstand + Sperre je Woche).
  psql(`delete from public.schedule_weeks where owner_id = '${USER_ID}';`);
  const entries = `'[{"title":"Gewerbe-Fokus (Beispiel)","category":"business",
    "start_at":"2026-10-20T07:00:00Z","end_at":"2026-10-20T10:00:00Z",
    "location":null,"note":null,"source":"agent"}]'::jsonb`;
  const generate = (expected) =>
    `public.save_generated_schedule_draft('2026-10-19', ${expected}, ${entries})`;
  const plans = await Promise.all([
    session(generate("null, null"), 0),
    session(generate("null, null"), 300),
  ]);
  assert(plans.filter((r) => r.ok).length === 1, "genau eine gleichzeitige Planung gelingt");
  assert(
    plans.some((r) => !r.ok && r.sqlstate === "TT008"),
    "die zweite Planung wird abgewiesen (TT008) statt den Entwurf zu überschreiben",
  );
  assert(
    psql(`select count(*) from public.schedule_weeks
           where owner_id = '${USER_ID}' and week_start = '2026-10-19';`) === "1",
    "es existiert genau ein Entwurf",
  );

  const draft = psql(`select id from public.schedule_weeks
                       where owner_id = '${USER_ID}' and week_start = '2026-10-19';`);
  const fingerprint = asUser(`public.schedule_week_fingerprint('${draft}')`);
  const publishes = await Promise.all([
    session(`public.publish_reviewed_schedule_week('${draft}', '${fingerprint}')`, 0),
    session(`public.publish_reviewed_schedule_week('${draft}', '${fingerprint}')`, 300),
  ]);
  assert(
    publishes.every((r) => r.ok),
    "doppelte gleichzeitige Freigabe ist harmlos",
  );
  assert(
    psql(`select count(*) from public.schedule_weeks
           where owner_id = '${USER_ID}' and week_start = '2026-10-19'
             and status = 'published';`) === "1",
    "veröffentlicht ist genau eine Version",
  );

  // Neuer Entwurf (Version 2) als Test-Benutzer, dann Freigabe und Neu-Planen gleichzeitig.
  const nextDraft = asUser(`(${generate("null, null")}).id`);
  const nextFingerprint = asUser(`public.schedule_week_fingerprint('${nextDraft}')`);
  const race = await Promise.all([
    session(`public.publish_reviewed_schedule_week('${nextDraft}', '${nextFingerprint}')`, 0),
    session(generate(`'${nextDraft}', '${nextFingerprint}'`), 300),
  ]);
  assert(
    race.filter((r) => r.ok).length === 1,
    "Veröffentlichen und Neu-Planen: genau eines gelingt",
  );
  assert(
    race.some((r) => !r.ok && r.sqlstate === "TT008"),
    "das andere wird mit TT008 abgewiesen",
  );
  assert(
    psql(`select count(*) from public.schedule_weeks
           where owner_id = '${USER_ID}' and week_start = '2026-10-19'
             and status = 'published';`) === "1",
    "auch danach ist genau eine Version veröffentlicht",
  );
} catch (error) {
  failed = true;
  process.stderr.write(`Nebenläufigkeitstest fehlgeschlagen: ${error.message}\n`);
} finally {
  psql(`delete from auth.users where id = '${USER_ID}';`);
}

process.exitCode = failed ? 1 : 0;

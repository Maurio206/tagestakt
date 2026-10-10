// @vitest-environment node
/**
 * Datenbank-E2E-Tests des Claude-Connectors gegen die LOKALE Supabase-Instanz (nie Produktion).
 * Start ausschließlich über `pnpm connector:e2e` (scripts/connector-e2e-test.mjs): Das Skript
 * gibt der Rolle tagestakt_connector lokal ein Zufallspasswort, legt zwei Test-Benutzer an und
 * räumt danach alles wieder ab. Alle Daten sind frei erfunden (Beispiel).
 *
 * Geprüft: OAuth (PKCE, Code-Einmaligkeit, Ablauf, Rotation, Wiederverwendung, Widerruf,
 * Ressourcenbindung, fremde Konten), alle sieben Tools mit echter Datenbank (Kontext ohne
 * persönliche Daten, Prüfen, idempotentes Speichern, veralteter und paralleler Stand,
 * Einzeltermine, Abweichungen nur für eine Woche, laufende Woche mit unverändertem
 * Vergangenem und Erledigt-Status, Bestätigung, Ablauf, doppeltes Veröffentlichen, Verwerfen)
 * und ein Durchstich über den echten /mcp-Endpunkt mit dem offiziellen Client.
 */
import { createHash } from "node:crypto";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type ConnectorConfig, parseConnectorConfig, resetConnectorConfigForTests } from "./config";
import { asOwner, closeConnectorSql, connectorTransaction } from "./db";
import { handleMcpHttp } from "./http";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeOwnGrant,
  revokeToken,
  verifyAccessToken,
} from "./oauth-store";
import {
  type ConnectorAuth,
  ToolFailure,
  discardWeekDraft,
  getPlanningContext,
  getWeekDraft,
  prepareWeekPublish,
  publishWeekDraft,
  saveWeekDraft,
  validateWeekPlan,
} from "./planning-service";
import { CONNECTOR_SCOPES } from "./scopes";
import { generateToken, sha256Hex } from "./tokens";
import { addDays, upcomingWeekStarts } from "@tagestakt/schedule-schema";

const DATABASE_URL = process.env.TAGESTAKT_E2E_DATABASE_URL ?? "";
const OWNER = process.env.TAGESTAKT_E2E_OWNER ?? "";
const FOREIGN = process.env.TAGESTAKT_E2E_FOREIGN ?? "";
const PUBLIC_URL = "http://localhost:3000";
const RESOURCE = `${PUBLIC_URL}/mcp`;
const CLIENT_ID = "https://claude.ai/oauth/mcp-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "e2e-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const CURRENT_WEEK = "2026-10-05";
const WEEK = "2026-10-12";
const NEXT_WEEK = "2026-10-19";
const NOW = new Date("2026-10-09T12:00:00Z");
const ONE_OFF_TITLE = "Arzttermin bei Dr. Beispiel";
const NOTE_TEXT = "Tagesnotiz (Beispiel) – vertraulich";

let config: ConnectorConfig;
const deps = () => ({ config, now: () => NOW });

type Block = {
  kind: "business" | "sport" | "relationship" | "appointment";
  slotId?: string | null;
  date: string;
  start: string;
  end: string;
  title?: string;
};
const business = (date: string, start: string, end: string): Block => ({
  kind: "business",
  slotId: null,
  date,
  start,
  end,
});
type EntryChange =
  | { action: "adjust"; ref: string; start: string; end: string; reason: string }
  | { action: "cancel"; ref: string; reason: string }
  | { action: "regular"; ref: string };
/** Dienst Mo–Fr ausdrücklich wie in den Wiederholungen (Basisversion ohne Wiederholungen). */
const dutyAsRule = (week: string): EntryChange[] =>
  [0, 1, 2, 3, 4].map((day) => ({ action: "regular", ref: `duty-${addDays(week, day)}-0800` }));

function plan(overrides: Block[] = [], week = WEEK, changes = dutyAsRule(week)) {
  const base: Block[] =
    week === WEEK
      ? [
          business("2026-10-12", "13:00", "17:00"),
          {
            kind: "sport",
            slotId: "sport-2026-10-12",
            date: "2026-10-12",
            start: "18:30",
            end: "19:30",
          },
          business("2026-10-13", "13:00", "17:00"),
          business("2026-10-14", "13:00", "17:00"),
          business("2026-10-15", "13:00", "17:00"),
          business("2026-10-16", "13:00", "17:00"),
          {
            kind: "relationship",
            slotId: "relationship-2026-10-16",
            date: "2026-10-16",
            start: "19:00",
            end: "21:00",
          },
        ]
      : [
          business("2026-10-19", "13:00", "17:00"),
          {
            kind: "sport",
            slotId: "sport-2026-10-19",
            date: "2026-10-19",
            start: "18:30",
            end: "19:30",
          },
          business("2026-10-20", "13:00", "17:00"),
          business("2026-10-21", "13:00", "17:00"),
          business("2026-10-22", "13:00", "17:00"),
          business("2026-10-23", "13:00", "17:00"),
          {
            kind: "relationship",
            slotId: "relationship-2026-10-23",
            date: "2026-10-23",
            start: "19:00",
            end: "21:00",
          },
        ];
  return {
    weekStart: week,
    blocks: [...base, ...overrides],
    summary: "Testwoche (Beispiel).",
    changes,
  };
}

/** Planungsregeln und Daten eines Test-Benutzers – über RLS als dieser Benutzer angelegt. */
async function seedOwner(ownerId: string, withPublishedWeek: boolean) {
  await connectorTransaction(config, async (tx) => {
    await asOwner(tx, ownerId);
    await tx`insert into public.user_settings (weekly_business_target_minutes) values (1200)`;
    await tx`insert into public.planning_preferences (
               business_earliest_start, business_latest_end, business_min_block_minutes,
               business_max_block_minutes, business_max_daily_minutes,
               business_saturday_max_minutes, business_sunday_max_minutes, buffer_minutes)
             values ('08:00', '21:00', 60, 240, 300, 0, 0, 15)`;
    await tx`insert into public.planning_goal_slots (goal_category, weekday, requirement, title,
               duration_minutes, window_start, window_end)
             values ('sport', 1, 'required', 'Training (Beispiel)', 60, '18:00', '21:00'),
                    ('relationship', 5, 'required', 'Zeit zu zweit (Beispiel)', 120, '18:00', '22:00')`;
    for (const weekday of [1, 2, 3, 4, 5]) {
      await tx`insert into public.recurring_commitments (title, category, weekday, start_time,
                 end_time, location, note)
               values ('Dienst (Beispiel)', 'duty', ${weekday}, '08:00', '12:00',
                       'Dienstort (Beispiel)', 'Interne Notiz (Beispiel)')`;
    }
    await tx`insert into public.daily_notes (note_date, content) values (${WEEK}::date, ${NOTE_TEXT})`;
    if (withPublishedWeek) {
      const [week] = await tx<{ id: string }[]>`
        insert into public.schedule_weeks (week_start) values (${WEEK}::date) returning id`;
      await tx`insert into public.schedule_entries (schedule_week_id, title, category, start_at,
                 end_at, location, note, source)
               values (${week!.id}::uuid, ${ONE_OFF_TITLE}, 'appointment',
                       '2026-10-17 10:00+02', '2026-10-17 11:00+02',
                       'Beispielstraße 1', 'Versichertenkarte (Beispiel)', 'manual')`;
      await tx`update public.schedule_weeks set status = 'published' where id = ${week!.id}::uuid`;

      // Laufende Woche (NOW = Freitag): veröffentlicht, teils erledigt bzw. ausgelassen.
      const [current] = await tx<{ id: string }[]>`
        insert into public.schedule_weeks (week_start) values (${CURRENT_WEEK}::date) returning id`;
      const entry = (
        title: string,
        category: string,
        day: string,
        start: string,
        end: string,
        source: string,
        status: string,
        place: { location: string | null; note: string | null } = { location: null, note: null },
      ) => tx`insert into public.schedule_entries (schedule_week_id, title, category, start_at,
                 end_at, location, note, source, completion_status)
               values (${current!.id}::uuid, ${title}, ${category},
                       ${`2026-10-${day} ${start}+02`}::timestamptz,
                       ${`2026-10-${day} ${end}+02`}::timestamptz,
                       ${place.location}::text, ${place.note}::text, ${source}, ${status})`;
      for (const [day, status] of [
        ["05", "completed"],
        ["06", "planned"],
        ["07", "planned"],
        ["08", "planned"],
        // Schon vorab als erledigt markiert: Der Status bleibt auch bei geändertem Ende.
        ["09", "completed"],
      ] as const) {
        await entry("Dienst (Beispiel)", "duty", day, "08:00", "12:00", "recurring", status, {
          location: "Dienstort (Beispiel)",
          note: "Interne Notiz (Beispiel)",
        });
      }
      await entry("Akquise (Beispiel)", "business", "05", "13:00", "17:00", "agent", "completed");
      await entry("Training (Beispiel)", "sport", "05", "18:30", "19:30", "agent", "completed");
      await entry("Akquise (Beispiel)", "business", "08", "13:00", "17:00", "agent", "skipped");
      await entry("Akquise (Beispiel)", "business", "09", "15:00", "18:00", "agent", "planned");
      await entry(
        "Einzeltermin (Beispiel)",
        "appointment",
        "10",
        "10:00",
        "11:00",
        "manual",
        "planned",
      );
      await tx`update public.schedule_weeks set status = 'published' where id = ${current!.id}::uuid`;
    }
  });
}

async function authorize(ownerId: string, scopes = [...CONNECTOR_SCOPES]) {
  const code = await createAuthorizationCode(config, {
    ownerId,
    clientId: CLIENT_ID,
    clientName: "Claude (Beispiel)",
    redirectUri: CALLBACK,
    codeChallenge: CHALLENGE,
    scopes,
    resource: RESOURCE,
  });
  const result = await exchangeAuthorizationCode(config, {
    code,
    clientId: CLIENT_ID,
    redirectUri: CALLBACK,
    codeVerifier: VERIFIER,
    resource: RESOURCE,
  });
  if (!result.ok) throw new Error(result.failure.description);
  return { code, ...result.tokens };
}

async function authOf(accessToken: string): Promise<ConnectorAuth> {
  const access = await verifyAccessToken(config, accessToken);
  if (!access) throw new Error("Token ungültig");
  return { ownerId: access.ownerId, grantId: access.grantId };
}

/** Rohzugriff als Connector-Rolle (nur Schema connector) bzw. als Eigentümer (RLS). */
const asConnectorRole = <T>(run: Parameters<typeof connectorTransaction<T>>[1]) =>
  connectorTransaction(config, run);
const asOwnerRole = <T>(ownerId: string, run: Parameters<typeof connectorTransaction<T>>[1]) =>
  connectorTransaction(config, async (tx) => {
    await asOwner(tx, ownerId);
    return run(tx);
  });

async function weeksOf(ownerId: string, week = WEEK) {
  return asOwnerRole(
    ownerId,
    (tx) =>
      tx<{ version: number; status: string }[]>`
      select version, status from public.schedule_weeks
       where week_start = ${week}::date order by version`,
  );
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ToolFailure) return error.code;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : "unbekannt";
  }
  return "kein Fehler";
}

describe.runIf(DATABASE_URL && OWNER && FOREIGN)("Connector mit lokaler Datenbank", () => {
  beforeAll(async () => {
    const result = parseConnectorConfig({
      TAGESTAKT_PUBLIC_URL: PUBLIC_URL,
      CONNECTOR_DATABASE_URL: DATABASE_URL,
      NODE_ENV: "test",
    });
    if (!result.ok) throw new Error(result.problems.join("\n"));
    config = result.config;
    // Nur der Eigentümer ist erlaubt (wie TAGESTAKT_OWNER_USER_ID in Produktion).
    vi.stubEnv("TAGESTAKT_OWNER_USER_ID", OWNER);
    await seedOwner(OWNER, true);
    await seedOwner(FOREIGN, false);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    resetConnectorConfigForTests();
    await closeConnectorSql();
  });

  // -------------------------------------------------------------------------
  describe("OAuth", () => {
    it("PKCE-Flow: Tokens funktionieren, gespeichert sind nur Hashes", async () => {
      const tokens = await authorize(OWNER);
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.scope).toBe("planning:read planning:draft planning:publish");
      const access = await verifyAccessToken(config, tokens.access_token);
      expect(access).toMatchObject({ ownerId: OWNER, resource: RESOURCE });
      const stored = await asConnectorRole(
        (tx) => tx<{ token_hash: string }[]>`select token_hash from connector.oauth_tokens`,
      );
      expect(stored.map((row) => row.token_hash)).toContain(sha256Hex(tokens.access_token));
      const dump = JSON.stringify(
        await asConnectorRole((tx) => tx`select * from connector.oauth_tokens`),
      );
      expect(dump).not.toContain(tokens.access_token);
      expect(dump).not.toContain(tokens.refresh_token);
      expect(dump).not.toMatch(/tt_(at|rt|ac)_/);
    });

    it("falscher Verifier, fremder Client, fremder Redirect, fremde Ressource", async () => {
      const code = await createAuthorizationCode(config, {
        ownerId: OWNER,
        clientId: CLIENT_ID,
        clientName: "Claude (Beispiel)",
        redirectUri: CALLBACK,
        codeChallenge: CHALLENGE,
        scopes: ["planning:read"],
        resource: RESOURCE,
      });
      const attempt = (overrides: Partial<Parameters<typeof exchangeAuthorizationCode>[1]>) =>
        exchangeAuthorizationCode(config, {
          code,
          clientId: CLIENT_ID,
          redirectUri: CALLBACK,
          codeVerifier: VERIFIER,
          resource: RESOURCE,
          ...overrides,
        });
      expect(await attempt({ codeVerifier: `${VERIFIER}-falsch` })).toMatchObject({
        ok: false,
        failure: { error: "invalid_grant" },
      });
      expect(await attempt({ clientId: "https://claude.ai/anderer" })).toMatchObject({ ok: false });
      expect(await attempt({ redirectUri: `${CALLBACK}/x` })).toMatchObject({ ok: false });
      expect(await attempt({ resource: "http://localhost:3000/anderes" })).toMatchObject({
        ok: false,
        failure: { error: "invalid_target" },
      });
      expect((await attempt({})).ok).toBe(true);
    });

    it("Code ist einmalig: erneute Vorlage widerruft die daraus entstandene Freigabe", async () => {
      const tokens = await authorize(OWNER);
      const replay = await exchangeAuthorizationCode(config, {
        code: tokens.code,
        clientId: CLIENT_ID,
        redirectUri: CALLBACK,
        codeVerifier: VERIFIER,
        resource: RESOURCE,
      });
      expect(replay).toMatchObject({ ok: false, failure: { error: "invalid_grant" } });
      expect(await verifyAccessToken(config, tokens.access_token)).toBeNull();
    });

    it("abgelaufener Code und abgelaufenes Access-Token werden abgewiesen", async () => {
      const code = await createAuthorizationCode(config, {
        ownerId: OWNER,
        clientId: CLIENT_ID,
        clientName: "Claude (Beispiel)",
        redirectUri: CALLBACK,
        codeChallenge: CHALLENGE,
        scopes: ["planning:read"],
        resource: RESOURCE,
      });
      await asConnectorRole(
        (tx) => tx`update connector.oauth_authorization_codes
                      set expires_at = now() - interval '1 minute'
                    where code_hash = ${sha256Hex(code)}`,
      );
      expect(
        await exchangeAuthorizationCode(config, {
          code,
          clientId: CLIENT_ID,
          redirectUri: CALLBACK,
          codeVerifier: VERIFIER,
          resource: RESOURCE,
        }),
      ).toMatchObject({ ok: false, failure: { error: "invalid_grant" } });

      const tokens = await authorize(OWNER);
      await asConnectorRole(
        (tx) => tx`update connector.oauth_tokens set expires_at = now() - interval '1 second'
                    where token_hash = ${sha256Hex(tokens.access_token)}`,
      );
      expect(await verifyAccessToken(config, tokens.access_token)).toBeNull();
    });

    it("Refresh-Rotation; spätere Wiederverwendung widerruft die Freigabe", async () => {
      const first = await authorize(OWNER);
      const second = await refreshAccessToken(config, {
        refreshToken: first.refresh_token,
        clientId: CLIENT_ID,
        scope: null,
        resource: RESOURCE,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.tokens.refresh_token).not.toBe(first.refresh_token);
      // Sofortige erneute Vorlage (Wettlauf): abgewiesen, Freigabe bleibt.
      const race = await refreshAccessToken(config, {
        refreshToken: first.refresh_token,
        clientId: CLIENT_ID,
        scope: null,
        resource: null,
      });
      expect(race).toMatchObject({ ok: false, failure: { error: "invalid_grant" } });
      expect(await verifyAccessToken(config, second.tokens.access_token)).not.toBeNull();
      // Späte Wiederverwendung: Diebstahlverdacht → ganze Freigabe widerrufen.
      await asConnectorRole(
        (tx) => tx`update connector.oauth_tokens set rotated_at = now() - interval '5 minutes'
                    where token_hash = ${sha256Hex(first.refresh_token)}`,
      );
      await refreshAccessToken(config, {
        refreshToken: first.refresh_token,
        clientId: CLIENT_ID,
        scope: null,
        resource: null,
      });
      expect(await verifyAccessToken(config, second.tokens.access_token)).toBeNull();
    });

    it("Scopes lassen sich beim Refresh nicht erweitern", async () => {
      const tokens = await authorize(OWNER, ["planning:read"]);
      const widened = await refreshAccessToken(config, {
        refreshToken: tokens.refresh_token,
        clientId: CLIENT_ID,
        scope: "planning:read planning:publish",
        resource: null,
      });
      expect(widened).toMatchObject({ ok: false, failure: { error: "invalid_scope" } });
    });

    it("Widerruf (RFC 7009 und Einstellungen) macht Tokens sofort ungültig", async () => {
      const viaEndpoint = await authorize(OWNER);
      await revokeToken(config, { token: viaEndpoint.refresh_token, clientId: CLIENT_ID });
      expect(await verifyAccessToken(config, viaEndpoint.access_token)).toBeNull();

      const viaSettings = await authorize(OWNER);
      const { grantId } = await authOf(viaSettings.access_token);
      expect(await revokeOwnGrant(config, FOREIGN, grantId)).toBe(false);
      expect(await verifyAccessToken(config, viaSettings.access_token)).not.toBeNull();
      expect(await revokeOwnGrant(config, OWNER, grantId)).toBe(true);
      expect(await verifyAccessToken(config, viaSettings.access_token)).toBeNull();
    });

    it("andere Konten erhalten keinen Zugang (nur der konfigurierte Eigentümer)", async () => {
      const code = await createAuthorizationCode(config, {
        ownerId: FOREIGN,
        clientId: CLIENT_ID,
        clientName: "Claude (Beispiel)",
        redirectUri: CALLBACK,
        codeChallenge: CHALLENGE,
        scopes: [...CONNECTOR_SCOPES],
        resource: RESOURCE,
      });
      expect(
        await exchangeAuthorizationCode(config, {
          code,
          clientId: CLIENT_ID,
          redirectUri: CALLBACK,
          codeVerifier: VERIFIER,
          resource: RESOURCE,
        }),
      ).toMatchObject({ ok: false, failure: { error: "invalid_grant" } });
      expect(await verifyAccessToken(config, generateToken("access"))).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("Tools", () => {
    let auth: ConnectorAuth;
    let otherGrant: ConnectorAuth;
    const outputs: unknown[] = [];

    beforeAll(async () => {
      auth = await authOf((await authorize(OWNER)).access_token);
      // Zweite Freigabe (anderer Client) für die Prüfung fremder Bestätigungen.
      const otherCode = await createAuthorizationCode(config, {
        ownerId: OWNER,
        clientId: "https://claude.com/oauth/anderer-client",
        clientName: "Claude (Beispiel 2)",
        redirectUri: "https://claude.com/api/mcp/auth_callback",
        codeChallenge: CHALLENGE,
        scopes: [...CONNECTOR_SCOPES],
        resource: RESOURCE,
      });
      const other = await exchangeAuthorizationCode(config, {
        code: otherCode,
        clientId: "https://claude.com/oauth/anderer-client",
        redirectUri: "https://claude.com/api/mcp/auth_callback",
        codeVerifier: VERIFIER,
        resource: RESOURCE,
      });
      if (!other.ok) throw new Error(other.failure.description);
      otherGrant = await authOf(other.tokens.access_token);
    });

    it("get_planning_context: Regeln und Belegung, aber keine persönlichen Daten", async () => {
      const context = await getPlanningContext(deps(), auth, WEEK);
      outputs.push(context);
      expect(context.saveAllowed).toBe(true);
      expect(context.rules.duty).toHaveLength(5);
      expect(context.rules.training[0]?.slotId).toBe("sport-2026-10-12");
      expect(context.rules.relationship[0]?.slotId).toBe("relationship-2026-10-16");
      expect(context.rules.business?.minimumMinutesPerWeek).toBe(1200);
      expect(context.oneOffAppointments).toEqual([
        expect.objectContaining({ date: "2026-10-17", start: "10:00", kind: "Termin" }),
      ]);
      expect(context.publishedPlan?.version).toBe(1);
      expect(context.existingDraft).toBeNull();
      // Die veröffentlichte Version enthält keine Wiederholungen: Das ist eine Abweichung, die
      // ein Vorschlag ausdrücklich übernehmen oder zurücksetzen muss.
      expect(context.currentDeviations).toHaveLength(5);
      expect(
        context.currentDeviations.every((d) => d.deviation === "entfällt" && d.mustAddress),
      ).toBe(true);
    });

    it("nur die laufende und die nächsten Wochen; Vergangenes wird abgelehnt", async () => {
      for (const week of ["2026-09-28", "2027-01-04"]) {
        expect(await failureOf(getPlanningContext(deps(), auth, week))).toBe("week_not_allowed");
      }
      const current = await getPlanningContext(deps(), auth, CURRENT_WEEK);
      outputs.push(current);
      expect(current.earliestStart).toEqual({ date: "2026-10-09", time: "14:00" });
      expect(current.alreadyBegun).toEqual({ businessMinutes: 240 });
      expect(current.days[0]?.busy.every((b) => b.begun)).toBe(true);
    });

    it("bestehende Abweichungen gehen nicht still verloren", async () => {
      const silent = await validateWeekPlan(deps(), auth, plan([], WEEK, []));
      expect(silent.valid).toBe(false);
      expect(
        silent.errors.filter((e) =>
          e.startsWith("Abweichung im aktuellen Stand nicht berücksichtigt"),
        ),
      ).toHaveLength(5);
    });

    it("validate_week_plan prüft vollständig und speichert nichts", async () => {
      const valid = await validateWeekPlan(deps(), auth, plan());
      outputs.push(valid);
      expect(valid.valid).toBe(true);
      expect(valid.overview?.businessMinutes).toBe(1200);
      const onDuty = await validateWeekPlan(deps(), auth, {
        ...plan(),
        blocks: [...plan().blocks, business("2026-10-13", "09:00", "11:00")],
      });
      expect(onDuty.valid).toBe(false);
      expect(onDuty.errors.join(" ")).toContain("überschneidet eine feste Verpflichtung");
      const tooShort = await validateWeekPlan(deps(), auth, {
        ...plan(),
        blocks: plan().blocks.filter((b) => b.date !== "2026-10-16" || b.kind !== "business"),
      });
      expect(tooShort.valid).toBe(false);
      expect(await weeksOf(OWNER)).toEqual([{ version: 1, status: "published" }]);
    });

    it("save_week_draft: speichert nur Gültiges, behält Einzeltermine, ist idempotent", async () => {
      expect(
        await failureOf(
          saveWeekDraft(deps(), auth, {
            ...plan([business("2026-10-18", "10:00", "12:00")]),
            expectedDraftRef: null,
          }),
        ),
      ).toBe("validation_failed");
      expect(await weeksOf(OWNER)).toEqual([{ version: 1, status: "published" }]);

      const saved = await saveWeekDraft(deps(), auth, { ...plan(), expectedDraftRef: null });
      outputs.push(saved);
      expect(saved).toMatchObject({ saved: true, replayed: false, draftVersion: 2 });
      expect(saved.overview.publishable).toBe(true);
      expect(await weeksOf(OWNER)).toEqual([
        { version: 1, status: "published" },
        { version: 2, status: "draft" },
      ]);
      const manual = await asOwnerRole(
        OWNER,
        (tx) =>
          tx<{ title: string }[]>`
          select e.title from public.schedule_entries e
            join public.schedule_weeks w on w.id = e.schedule_week_id
           where w.status = 'draft' and e.source = 'manual'`,
      );
      expect(manual.map((row) => row.title)).toEqual([ONE_OFF_TITLE]);

      // Wiederholung (z. B. nach Zeitüberschreitung) – auch mit altem Bezug null.
      const replay = await saveWeekDraft(deps(), auth, { ...plan(), expectedDraftRef: null });
      expect(replay).toMatchObject({ replayed: true, draftRef: saved.draftRef });
    });

    it("save_week_draft: veralteter oder fehlender Bezug überschreibt nichts", async () => {
      const current = await getWeekDraft(deps(), auth, WEEK);
      const changed = plan([
        {
          kind: "appointment",
          date: "2026-10-14",
          start: "18:00",
          end: "19:00",
          title: "Werkstatt (Beispiel)",
        },
      ]);
      expect(
        await failureOf(saveWeekDraft(deps(), auth, { ...changed, expectedDraftRef: null })),
      ).toBe("TT008");
      expect(
        await failureOf(
          saveWeekDraft(deps(), auth, { ...changed, expectedDraftRef: "0".repeat(64) }),
        ),
      ).toBe("TT008");
      const updated = await saveWeekDraft(deps(), auth, {
        ...changed,
        expectedDraftRef: current.draft!.draftRef,
      });
      expect(updated.draftRef).not.toBe(current.draft!.draftRef);
      expect(
        await failureOf(
          saveWeekDraft(deps(), auth, { ...plan(), expectedDraftRef: current.draft!.draftRef }),
        ),
      ).toBe("TT008");
    });

    it("save_week_draft: zwei gleichzeitige Änderungen – genau eine gelingt", async () => {
      const current = (await getWeekDraft(deps(), auth, WEEK)).draft!.draftRef;
      const results = await Promise.allSettled([
        saveWeekDraft(deps(), auth, { ...plan(), expectedDraftRef: current }),
        saveWeekDraft(deps(), auth, {
          ...plan([
            {
              kind: "appointment",
              date: "2026-10-15",
              start: "18:00",
              end: "19:00",
              title: "Termin B (Beispiel)",
            },
          ]),
          expectedDraftRef: current,
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await weeksOf(OWNER)).toEqual([
        { version: 1, status: "published" },
        { version: 2, status: "draft" },
      ]);
    });

    it("save_week_draft: in TagesTakt geänderte Wiederholungen werden nie still zurückgesetzt", async () => {
      const TUESDAY = "duty-2026-10-13-0800";
      const withoutDutyChanges = plan([], WEEK, []);
      // Der Eigentümer verschiebt im Entwurf den Dienst am Dienstag (z. B. Schichttausch).
      const moveTuesdayDuty = (from: string, start: string, end: string) =>
        asOwnerRole(
          OWNER,
          (tx) => tx`
            update public.schedule_entries e
               set start_at = ${start}::timestamptz, end_at = ${end}::timestamptz
              from public.schedule_weeks w
             where w.id = e.schedule_week_id and w.status = 'draft'
               and w.week_start = ${WEEK}::date and e.source = 'recurring'
               and e.category = 'duty' and e.start_at = ${from}::timestamptz`,
        );
      await moveTuesdayDuty("2026-10-13 08:00+02", "2026-10-13 08:30+02", "2026-10-13 12:30+02");
      const changed = (await getWeekDraft(deps(), auth, WEEK)).draft!;
      expect(changed.overview.deviations).toEqual([
        "Dienst am Di 13.10.: 08:30–12:30 statt 08:00–12:00",
      ]);
      expect(
        await failureOf(
          saveWeekDraft(deps(), auth, {
            ...withoutDutyChanges,
            expectedDraftRef: changed.draftRef,
          }),
        ),
      ).toBe("validation_failed");
      expect((await getWeekDraft(deps(), auth, WEEK)).draft!.draftRef).toBe(changed.draftRef);
      const context = await getPlanningContext(deps(), auth, WEEK);
      expect(context.currentDeviations).toEqual([
        expect.objectContaining({
          ref: TUESDAY,
          deviation: "andere Zeit",
          current: { start: "08:30", end: "12:30" },
          mustAddress: true,
        }),
      ]);

      // Übernehmen (nur diese Woche, mit Grund) – die Wiederholung selbst bleibt unverändert.
      const kept = await saveWeekDraft(deps(), auth, {
        ...plan([], WEEK, [
          { action: "adjust", ref: TUESDAY, start: "08:30", end: "12:30", reason: "Testgrund" },
        ]),
        expectedDraftRef: changed.draftRef,
      });
      expect(kept.overview.deviations).toEqual([
        "Dienst am Di 13.10.: 08:30–12:30 statt 08:00–12:00 – Grund: Testgrund",
      ]);
      expect(kept.overview.summary).toContain(
        "Abweichungen diese Woche: Dienst am Di 13.10.: 08:30–12:30 statt 08:00–12:00 – Grund: Testgrund",
      );
      const rules = await asOwnerRole(
        OWNER,
        (tx) => tx<{ start_time: string }[]>`
          select start_time::text from public.recurring_commitments where weekday = 2`,
      );
      expect(rules.map((r) => r.start_time)).toEqual(["08:00:00"]);

      // Ausdrücklich zurücksetzen (nur nach Rückfrage beim Benutzer).
      const reset = await saveWeekDraft(deps(), auth, {
        ...plan([], WEEK, [{ action: "regular", ref: TUESDAY }]),
        expectedDraftRef: kept.draftRef,
      });
      expect(reset.overview.deviations).toEqual([]);
    });

    it("get_week_draft: Server-Prüfübersicht", async () => {
      const view = await getWeekDraft(deps(), auth, WEEK);
      outputs.push(view);
      expect(view.draft?.overview).toMatchObject({
        draftVersion: 2,
        dutyComplete: true,
        trainingDaysMet: true,
        relationshipDaysMet: true,
        businessMinutes: 1200,
        businessMinimumReached: true,
        overlaps: 0,
        openDecisions: [],
        publishable: true,
      });
      expect(view.draft?.overview.summary).toContain("Entwurfsversion: 2");
      expect(view.published?.version).toBe(1);
    });

    it("publish_week_draft ohne Vorbereitung oder mit erfundener Bestätigung: nichts passiert", async () => {
      const ref = (await getWeekDraft(deps(), auth, WEEK)).draft!.draftRef;
      for (const confirmationId of [generateToken("confirmation"), "Wochenplan veröffentlichen"]) {
        expect(
          await failureOf(
            publishWeekDraft(deps(), auth, {
              weekStart: WEEK,
              expectedDraftRef: ref,
              confirmationId,
            }),
          ),
        ).toBe("confirmation_invalid");
      }
      expect(await weeksOf(OWNER)).toEqual([
        { version: 1, status: "published" },
        { version: 2, status: "draft" },
      ]);
    });

    it("Bestätigung: abgelaufen, fremde Freigabe oder geänderter Entwurf → ungültig", async () => {
      let ref = (await getWeekDraft(deps(), auth, WEEK)).draft!.draftRef;
      const expired = await prepareWeekPublish(deps(), auth, {
        weekStart: WEEK,
        expectedDraftRef: ref,
      });
      await asConnectorRole(
        (tx) => tx`update connector.publish_confirmations
                      set expires_at = now() - interval '1 second'
                    where confirmation_hash = ${sha256Hex(expired.confirmationId)}`,
      );
      expect(
        await failureOf(
          publishWeekDraft(deps(), auth, {
            weekStart: WEEK,
            expectedDraftRef: ref,
            confirmationId: expired.confirmationId,
          }),
        ),
      ).toBe("confirmation_invalid");

      const foreignGrant = await prepareWeekPublish(deps(), otherGrant, {
        weekStart: WEEK,
        expectedDraftRef: ref,
      });
      expect(
        await failureOf(
          publishWeekDraft(deps(), auth, {
            weekStart: WEEK,
            expectedDraftRef: ref,
            confirmationId: foreignGrant.confirmationId,
          }),
        ),
      ).toBe("confirmation_invalid");

      const prepared = await prepareWeekPublish(deps(), auth, {
        weekStart: WEEK,
        expectedDraftRef: ref,
      });
      const changed = await saveWeekDraft(deps(), auth, {
        ...plan([
          {
            kind: "appointment",
            date: "2026-10-13",
            start: "18:00",
            end: "19:00",
            title: "Neu (Beispiel)",
          },
        ]),
        expectedDraftRef: ref,
      });
      ref = changed.draftRef;
      expect(
        await failureOf(
          publishWeekDraft(deps(), auth, {
            weekStart: WEEK,
            expectedDraftRef: ref,
            confirmationId: prepared.confirmationId,
          }),
        ),
      ).toBe("conflict");
      expect(await weeksOf(OWNER)).toEqual([
        { version: 1, status: "published" },
        { version: 2, status: "draft" },
      ]);
    });

    it("prepare + publish: genau einmal, atomar; zweiter Versuch harmlos abgewiesen", async () => {
      const ref = (await getWeekDraft(deps(), auth, WEEK)).draft!.draftRef;
      const prepared = await prepareWeekPublish(deps(), auth, {
        weekStart: WEEK,
        expectedDraftRef: ref,
      });
      outputs.push({ ...prepared, confirmationId: "(ausgeblendet)" });
      expect(prepared.question).toBe("Soll dieser Wochenplan veröffentlicht werden?");
      expect(prepared.overview.publishable).toBe(true);
      expect(await weeksOf(OWNER)).toEqual([
        { version: 1, status: "published" },
        { version: 2, status: "draft" },
      ]);

      const published = await publishWeekDraft(deps(), auth, {
        weekStart: WEEK,
        expectedDraftRef: ref,
        confirmationId: prepared.confirmationId,
      });
      expect(published).toMatchObject({ published: true, version: 2 });
      expect(await weeksOf(OWNER)).toEqual([
        { version: 1, status: "archived" },
        { version: 2, status: "published" },
      ]);
      expect(
        await failureOf(
          publishWeekDraft(deps(), auth, {
            weekStart: WEEK,
            expectedDraftRef: ref,
            confirmationId: prepared.confirmationId,
          }),
        ),
      ).not.toBe("kein Fehler");
      // Website, App und Widget lesen die veröffentlichte Version: Einzeltermin ist dabei.
      const visible = await asOwnerRole(
        OWNER,
        (tx) =>
          tx<{ title: string; source: string }[]>`
          select e.title, e.source from public.schedule_entries e
            join public.schedule_weeks w on w.id = e.schedule_week_id
           where w.status = 'published' and w.week_start = ${WEEK}::date`,
      );
      expect(visible.some((e) => e.title === ONE_OFF_TITLE && e.source === "manual")).toBe(true);
      expect(visible.filter((e) => e.source === "agent").length).toBeGreaterThan(0);
    });

    it("discard_week_draft: nur eigener Entwurf im gelesenen Stand", async () => {
      const saved = await saveWeekDraft(deps(), auth, {
        ...plan([], NEXT_WEEK),
        expectedDraftRef: null,
      });
      expect(
        await failureOf(
          discardWeekDraft(deps(), auth, {
            weekStart: NEXT_WEEK,
            expectedDraftRef: "0".repeat(64),
          }),
        ),
      ).toBe("conflict");
      expect(
        await discardWeekDraft(deps(), auth, {
          weekStart: NEXT_WEEK,
          expectedDraftRef: saved.draftRef,
        }),
      ).toEqual({ discarded: true, version: 1 });
      expect(await weeksOf(OWNER, NEXT_WEEK)).toEqual([]);
      expect(
        await failureOf(
          discardWeekDraft(deps(), auth, { weekStart: WEEK, expectedDraftRef: saved.draftRef }),
        ),
      ).toBe("no_draft");
    });

    describe("laufende Woche", () => {
      // Freitag 10:00 Uhr: Der Dienst (08:00–12:00) läuft gerade.
      const morning = () => ({ config, now: () => new Date("2026-10-09T08:00:00Z") });
      const FRIDAY_DUTY = "duty-2026-10-09-0800";
      type Row = {
        id: string;
        title: string;
        category: string;
        start_at: Date;
        end_at: Date;
        source: string;
        completion_status: string;
      };
      const rowsOf = (status: string) =>
        asOwnerRole(
          OWNER,
          (tx) => tx<Row[]>`
            select e.id, e.title, e.category, e.start_at, e.end_at, e.source, e.completion_status
              from public.schedule_entries e
              join public.schedule_weeks w on w.id = e.schedule_week_id
             where w.week_start = ${CURRENT_WEEK}::date and w.status = ${status}
             order by e.start_at, e.end_at, e.category`,
        );
      const view = (rows: Row[]) =>
        rows.map(
          (r) =>
            `${r.category} ${r.start_at.toISOString()}–${r.end_at.toISOString()} ${r.completion_status}`,
        );
      const proposal = (changes: EntryChange[]) => ({
        weekStart: CURRENT_WEEK,
        blocks: [
          business("2026-10-09", "13:00", "17:00"),
          {
            kind: "relationship" as const,
            slotId: "relationship-2026-10-09",
            date: "2026-10-09",
            start: "19:00",
            end: "21:00",
          },
        ],
        changes,
        businessMinimum: { minutes: 480, reason: "Testgrund: Woche fast vorbei" },
      });

      it("Vergangenes und Laufendes lassen sich nicht still ändern", async () => {
        const reason = "Testgrund";
        for (const changes of [
          [{ action: "cancel" as const, ref: FRIDAY_DUTY, reason }],
          [{ action: "cancel" as const, ref: "duty-2026-10-05-0800", reason }],
          [
            {
              action: "adjust" as const,
              ref: FRIDAY_DUTY,
              start: "09:00",
              end: "11:00",
              reason,
            },
          ],
        ]) {
          const result = await validateWeekPlan(morning(), auth, proposal(changes));
          expect(result.valid).toBe(false);
        }
        const strict = await validateWeekPlan(morning(), auth, {
          ...proposal([]),
          businessMinimum: null,
        });
        expect(strict.errors.join(" ")).toContain("davon bereits begonnen 4 Std.");
        expect(await weeksOf(OWNER, CURRENT_WEEK)).toEqual([{ version: 1, status: "published" }]);
      });

      it("ab jetzt wird ersetzt; Begonnenes bleibt mit Erledigt-Status, laufender Dienst kürzer", async () => {
        const published = await rowsOf("published");
        const saved = await saveWeekDraft(morning(), auth, {
          ...proposal([
            {
              action: "adjust",
              ref: FRIDAY_DUTY,
              start: "08:00",
              end: "11:00",
              reason: "Testgrund: früher Schluss",
            },
          ]),
          expectedDraftRef: null,
        });
        outputs.push(saved);
        expect(saved.overview.publishable).toBe(true);
        expect(saved.overview.deviations).toEqual(
          expect.arrayContaining([
            "Dienst am Fr 09.10.: 08:00–11:00 statt 08:00–12:00 – Grund: Testgrund: früher Schluss",
            "Gewerbe 8 Std. statt mindestens 20 Std. – Grund: Testgrund: Woche fast vorbei (diese Woche mindestens 8 Std.)",
          ]),
        );
        expect(await weeksOf(OWNER, CURRENT_WEEK)).toEqual([
          { version: 1, status: "published" },
          { version: 2, status: "draft" },
        ]);

        const cutoff = Date.parse("2026-10-09T08:00:00Z");
        const draft = await rowsOf("draft");
        const begunBefore = published.filter((r) => r.start_at.getTime() < cutoff);
        const begunAfter = draft.filter((r) => r.start_at.getTime() < cutoff);
        // Alles Begonnene bleibt (inkl. Erledigt- und Ausgelassen-Status); nur das Ende des
        // laufenden Dienstes ändert sich.
        expect(view(begunAfter)).toEqual(
          view(begunBefore).map((line) =>
            line.startsWith("duty 2026-10-09T06:00")
              ? "duty 2026-10-09T06:00:00.000Z–2026-10-09T09:00:00.000Z completed"
              : line,
          ),
        );
        expect(view(begunAfter)).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/^duty 2026-10-05.* completed$/),
            expect.stringMatching(/^business 2026-10-05.* completed$/),
            expect.stringMatching(/^sport 2026-10-05.* completed$/),
            expect.stringMatching(/^business 2026-10-08.* skipped$/),
          ]),
        );
        // Ab jetzt: der neue Vorschlag statt des alten Gewerbeblocks; Einzeltermin bleibt.
        expect(view(draft.filter((r) => r.start_at.getTime() >= cutoff))).toEqual([
          "business 2026-10-09T11:00:00.000Z–2026-10-09T15:00:00.000Z planned",
          "relationship 2026-10-09T17:00:00.000Z–2026-10-09T19:00:00.000Z planned",
          "appointment 2026-10-10T08:00:00.000Z–2026-10-10T09:00:00.000Z planned",
        ]);

        // Wiederholung derselben Anfrage ändert nichts.
        const replay = await saveWeekDraft(morning(), auth, {
          ...proposal([
            {
              action: "adjust",
              ref: FRIDAY_DUTY,
              start: "08:00",
              end: "11:00",
              reason: "Testgrund: früher Schluss",
            },
          ]),
          expectedDraftRef: saved.draftRef,
        });
        expect(replay).toMatchObject({ replayed: true, draftRef: saved.draftRef });
        expect((await rowsOf("draft")).map((r) => r.id)).toEqual(draft.map((r) => r.id));
      });

      it("veröffentlichen mit sichtbaren Abweichungen; Erledigt-Status bleibt", async () => {
        const ref = (await getWeekDraft(morning(), auth, CURRENT_WEEK)).draft!.draftRef;
        const prepared = await prepareWeekPublish(morning(), auth, {
          weekStart: CURRENT_WEEK,
          expectedDraftRef: ref,
        });
        expect(prepared.overview.publishable).toBe(true);
        expect(prepared.overview.summary.join("\n")).toContain(
          "Abweichungen diese Woche: Dienst am Fr 09.10.: 08:00–11:00 statt 08:00–12:00",
        );
        await publishWeekDraft(morning(), auth, {
          weekStart: CURRENT_WEEK,
          expectedDraftRef: ref,
          confirmationId: prepared.confirmationId,
        });
        expect(await weeksOf(OWNER, CURRENT_WEEK)).toEqual([
          { version: 1, status: "archived" },
          { version: 2, status: "published" },
        ]);
        const visible = view(await rowsOf("published"));
        expect(visible).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/^business 2026-10-05.* completed$/),
            expect.stringMatching(/^business 2026-10-08.* skipped$/),
            "duty 2026-10-09T06:00:00.000Z–2026-10-09T09:00:00.000Z completed",
          ]),
        );
      });

      it("später am selben Tag erneut: laufender Block nur im Ende, Status bleibt", async () => {
        // 14:00 Uhr: Der um 10:00 geplante Gewerbeblock (13:00–17:00) läuft; schon als erledigt
        // markiert (Status ist in der veröffentlichten Version änderbar).
        const afternoon = () => ({ config, now: () => new Date("2026-10-09T12:00:00Z") });
        await asOwnerRole(
          OWNER,
          (tx) => tx`
            update public.schedule_entries e set completion_status = 'completed'
              from public.schedule_weeks w
             where w.id = e.schedule_week_id and w.week_start = ${CURRENT_WEEK}::date
               and w.status = 'published' and e.category = 'business'
               and e.start_at = '2026-10-09 13:00+02'::timestamptz`,
        );
        const context = await getPlanningContext(afternoon(), auth, CURRENT_WEEK);
        const runningRef = "block-business-2026-10-09-1300";
        expect(context.days[4]?.busy.find((b) => b.ref === runningRef)).toMatchObject({
          start: "13:00",
          end: "17:00",
          begun: true,
        });
        // Die Dienst-Abweichung vom Vormittag liegt jetzt in der Vergangenheit.
        expect(context.currentDeviations).toEqual([
          expect.objectContaining({ ref: FRIDAY_DUTY, mustAddress: false }),
        ]);
        const later = {
          weekStart: CURRENT_WEEK,
          blocks: [
            {
              kind: "relationship" as const,
              slotId: "relationship-2026-10-09",
              date: "2026-10-09",
              start: "19:30",
              end: "21:30",
            },
            {
              kind: "commute" as const,
              date: "2026-10-09",
              start: "21:30",
              end: "22:00",
              title: "Heimfahrt (Beispiel)",
            },
          ],
          changes: [
            {
              action: "adjust" as const,
              ref: runningRef,
              start: "13:00",
              end: "15:00",
              reason: "Testgrund: früher Schluss",
            },
          ],
          businessMinimum: { minutes: 360, reason: "Testgrund: Woche fast vorbei" },
        };
        const saved = await saveWeekDraft(afternoon(), auth, { ...later, expectedDraftRef: null });
        outputs.push(saved);
        expect(saved.overview.publishable).toBe(true);
        expect(await weeksOf(OWNER, CURRENT_WEEK)).toEqual([
          { version: 1, status: "archived" },
          { version: 2, status: "published" },
          { version: 3, status: "draft" },
        ]);
        const cutoff = Date.parse("2026-10-09T12:00:00Z");
        const draft = view(await rowsOf("draft"));
        expect(draft).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/^business 2026-10-05.* completed$/),
            expect.stringMatching(/^business 2026-10-08.* skipped$/),
            "duty 2026-10-09T06:00:00.000Z–2026-10-09T09:00:00.000Z completed",
            "business 2026-10-09T11:00:00.000Z–2026-10-09T13:00:00.000Z completed",
            "relationship 2026-10-09T17:30:00.000Z–2026-10-09T19:30:00.000Z planned",
            "commute 2026-10-09T19:30:00.000Z–2026-10-09T20:00:00.000Z planned",
          ]),
        );
        expect(draft).not.toContain(
          "relationship 2026-10-09T17:00:00.000Z–2026-10-09T19:00:00.000Z planned",
        );
        const published = await rowsOf("published");
        expect(
          view((await rowsOf("draft")).filter((r) => r.start_at.getTime() < cutoff)).length,
        ).toBe(published.filter((r) => r.start_at.getTime() < cutoff).length);

        const replay = await saveWeekDraft(afternoon(), auth, {
          ...later,
          expectedDraftRef: saved.draftRef,
        });
        expect(replay).toMatchObject({ replayed: true, draftRef: saved.draftRef });
      });
    });

    it("das fremde Konto bleibt unberührt und unsichtbar", async () => {
      expect(await weeksOf(FOREIGN)).toEqual([]);
      expect(await weeksOf(FOREIGN, NEXT_WEEK)).toEqual([]);
      expect(await weeksOf(FOREIGN, CURRENT_WEEK)).toEqual([]);
    });

    it("keine Auth-, E-Mail-, Notiz-, Titel- oder ID-Daten in den Tool-Ausgaben", () => {
      const json = JSON.stringify(outputs);
      for (const forbidden of [
        "@",
        "eyJ",
        "tt_at_",
        "tt_rt_",
        OWNER,
        FOREIGN,
        "Beispiel",
        "Dr.",
        "Versichertenkarte",
        "Dienstort",
        NOTE_TEXT,
        "Laila",
      ]) {
        expect(json).not.toContain(forbidden);
      }
      expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    });
  });

  // -------------------------------------------------------------------------
  describe("Durchstich über /mcp", () => {
    it("offizieller Client: Handshake, Tool-Liste und Kontext mit echtem Token", async () => {
      vi.stubEnv("TAGESTAKT_PUBLIC_URL", PUBLIC_URL);
      vi.stubEnv("CONNECTOR_DATABASE_URL", DATABASE_URL);
      resetConnectorConfigForTests();
      const { access_token } = await authorize(OWNER);
      const client = new Client(
        { name: "tagestakt-e2e", version: "1.0.0" },
        {
          versionNegotiation: { mode: "auto" },
        },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(RESOURCE), {
          fetch: (url, init) =>
            handleMcpHttp(
              new Request(url, {
                ...init,
                headers: {
                  ...Object.fromEntries(new Headers(init?.headers)),
                  host: "localhost:3000",
                },
              }),
            ),
          requestInit: { headers: { authorization: `Bearer ${access_token}` } },
        }),
      );
      expect((await client.listTools()).tools).toHaveLength(7);
      const result = await client.callTool({
        name: "get_week_draft",
        // Der Endpunkt rechnet mit der echten Uhrzeit: erste kommende Woche ab heute.
        arguments: { weekStart: upcomingWeekStarts(new Date())[0] },
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result)).not.toContain(OWNER);
      await client.close();
    });
  });
});

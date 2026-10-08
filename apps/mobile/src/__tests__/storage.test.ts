import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { isAllowedSupabaseUrl, looksLikeSecretKey, parseMobileEnv } from "@/lib/env";
import { fetchPlanSnapshot } from "@/lib/plan-api";
import { PLAN_CACHE_KEY, clearCachedPlan, loadCachedPlan, saveCachedPlan } from "@/lib/plan-cache";
import { type TypedSupabaseClient } from "@/lib/supabase";
import { SECURE_CHUNK_SIZE, secureSessionStorage, toSecureKey } from "@/lib/secure-storage";

import { NOW, snapshot as fixtureSnapshot } from "./fixtures";

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(async () => {
  store.clear();
  await AsyncStorage.clear();
});

describe("secureSessionStorage", () => {
  it("speichert große Sessions verteilt, aber vollständig in SecureStore", async () => {
    const session = JSON.stringify({
      access_token: "a".repeat(5000),
      refresh_token: "r".repeat(40),
    });
    await secureSessionStorage.setItem("tagestakt.auth", session);

    expect(store.size).toBeGreaterThan(Math.ceil(session.length / SECURE_CHUNK_SIZE));
    for (const value of store.values()) expect(value.length).toBeLessThanOrEqual(SECURE_CHUNK_SIZE);
    expect(await secureSessionStorage.getItem("tagestakt.auth")).toBe(session);
    // Nichts davon landet in AsyncStorage.
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it("entfernt beim Löschen alle Abschnitte", async () => {
    await secureSessionStorage.setItem("tagestakt.auth", "x".repeat(4000));
    await secureSessionStorage.removeItem("tagestakt.auth");
    expect(store.size).toBe(0);
    expect(await secureSessionStorage.getItem("tagestakt.auth")).toBeNull();
  });

  it("überschreibt ältere, längere Werte ohne Reste", async () => {
    await secureSessionStorage.setItem("tagestakt.auth", "x".repeat(4000));
    await secureSessionStorage.setItem("tagestakt.auth", "kurz");
    expect(await secureSessionStorage.getItem("tagestakt.auth")).toBe("kurz");
    expect(store.size).toBe(2);
  });

  it("liefert null bei unvollständigen Daten", async () => {
    await secureSessionStorage.setItem("tagestakt.auth", "y".repeat(4000));
    store.delete("tagestakt.auth.1");
    expect(await secureSessionStorage.getItem("tagestakt.auth")).toBeNull();
  });

  it("bildet ungültige Zeichen auf erlaubte Schlüssel ab", () => {
    expect(toSecureKey("sb-projekt-auth-token")).toBe("sb-projekt-auth-token");
    expect(toSecureKey("a/b:c")).toBe("a_b_c");
  });
});

describe("Plan-Cache", () => {
  const snapshot = {
    schemaVersion: 2 as const,
    fetchedAt: "2026-10-06T10:00:00.000Z",
    goalTargets: { business: 1200, sport: null, relationship: null },
    reminderSettings: {
      minutesBefore: 10,
      atStart: true,
      ifNotStarted: false,
      scope: "important" as const,
    },
    sessions: [],
    timezone: "Europe/Berlin",
    weeks: [],
  };

  it("speichert und lädt den letzten Plan", async () => {
    await saveCachedPlan(snapshot);
    expect(await loadCachedPlan()).toEqual(snapshot);
  });

  it("verwirft beschädigte Daten fehlertolerant", async () => {
    await AsyncStorage.setItem(PLAN_CACHE_KEY, "{kein json");
    expect(await loadCachedPlan()).toBeNull();
    await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ schemaVersion: 99 }));
    expect(await loadCachedPlan()).toBeNull();
    expect(await AsyncStorage.getItem(PLAN_CACHE_KEY)).toBeNull();
  });

  it("wird beim Abmelden gelöscht", async () => {
    await saveCachedPlan(snapshot);
    await clearCachedPlan();
    expect(await loadCachedPlan()).toBeNull();
  });

  it("speichert keine Notizen und keinen Planungshinweis, behält aber den Ort", async () => {
    const withNotes = fixtureSnapshot("2026-10-06T14:55:00.000Z");
    const [week] = withNotes.weeks;
    if (!week) throw new Error("Testdaten unvollständig");
    week.planning_note = "Planungshinweis (Beispiel)";
    week.schedule_entries = week.schedule_entries.map((entry) => ({
      ...entry,
      note: "Private Notiz (Beispiel)",
      location: "Büro (Beispiel)",
    }));
    await saveCachedPlan(withNotes);

    const raw = (await AsyncStorage.getItem(PLAN_CACHE_KEY)) ?? "";
    expect(raw).not.toContain("Private Notiz");
    expect(raw).not.toContain("Planungshinweis");
    expect(raw).toContain("Büro (Beispiel)");
    const loaded = await loadCachedPlan();
    expect(loaded?.weeks[0]?.schedule_entries.every((entry) => entry.note === null)).toBe(true);
  });

  it("entfernt ältere Cache-Formate (v2 konnte Notizen enthalten)", async () => {
    await AsyncStorage.setItem("tagestakt.plan-snapshot.v2", JSON.stringify({ note: "alt" }));
    await loadCachedPlan();
    expect(await AsyncStorage.getItem("tagestakt.plan-snapshot.v2")).toBeNull();
  });
});

describe("Plan laden (Datensparsamkeit)", () => {
  function fakeSupabase(responses: Record<string, unknown>) {
    const selects: Record<string, string> = {};
    const client = {
      from(table: string) {
        const result = { data: responses[table] ?? null, error: null };
        const chain = {
          select(columns: string) {
            selects[table] = columns;
            return chain;
          },
          eq: () => chain,
          in: () => chain,
          or: () => chain,
          order: async () => result,
          maybeSingle: async () => result,
        };
        return chain;
      },
    };
    return { selects, client: client as unknown as TypedSupabaseClient };
  }

  it("lädt weder Notizen noch Planungshinweise vom Server", async () => {
    const fixture = fixtureSnapshot("2026-10-06T14:55:00.000Z");
    const serverWeeks = fixture.weeks.map((week) => ({
      ...week,
      planning_note: "Planungshinweis (Beispiel)",
      schedule_entries: week.schedule_entries.map((entry) => ({ ...entry, note: "Notiz" })),
    }));
    const { selects, client } = fakeSupabase({
      schedule_weeks: serverWeeks,
      user_settings: null,
      activity_sessions: [],
    });

    const result = await fetchPlanSnapshot(client, NOW);

    expect(selects.schedule_weeks).not.toMatch(/note/);
    expect(selects.schedule_weeks).toContain("location");
    expect(result.weeks[0]?.planning_note).toBeNull();
    expect(result.weeks[0]?.schedule_entries.every((entry) => entry.note === null)).toBe(true);
  });
});

describe("Konfiguration", () => {
  it("lehnt Secret-Keys im App-Bundle ab", () => {
    const result = parseMobileEnv({
      EXPO_PUBLIC_SUPABASE_URL: "https://beispiel.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    });
    expect(result.ok).toBe(false);
    expect(looksLikeSecretKey("sb_publishable_abcdefghijklmnopqrstuvwxyz")).toBe(false);
  });

  it("meldet fehlende Werte verständlich", () => {
    const result = parseMobileEnv({});
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain("EXPO_PUBLIC_SUPABASE_URL");
  });

  const KEY = "sb_publishable_abcdefghijklmnopqrstuvwxyz";
  const env = (url: string) => ({
    EXPO_PUBLIC_SUPABASE_URL: url,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY,
  });

  it("Release: ausschließlich HTTPS", () => {
    expect(parseMobileEnv(env("https://api.beispiel.test")).ok).toBe(true);
    for (const url of [
      "http://api.beispiel.test",
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "ftp://api.beispiel.test",
    ]) {
      const result = parseMobileEnv(env(url));
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.message).toMatch(/im Release mit https:\/\//);
    }
  });

  it("Debug: HTTP nur zu diesem Rechner (adb reverse bzw. Emulator), sonst HTTPS", () => {
    const debug = { allowLocalHttp: true };
    expect(parseMobileEnv(env("http://127.0.0.1:54321"), debug).ok).toBe(true);
    expect(parseMobileEnv(env("http://localhost:54321"), debug).ok).toBe(true);
    expect(parseMobileEnv(env("http://10.0.2.2:54321"), debug).ok).toBe(true);
    expect(parseMobileEnv(env("https://api.beispiel.test"), debug).ok).toBe(true);
    // Kein unverschlüsseltes HTTP über WLAN oder Internet – auch nicht im Debug-Build.
    for (const url of [
      "http://192.168.1.20:54321",
      "http://api.beispiel.test",
      "http://127.0.0.1.beispiel.test",
    ]) {
      expect(parseMobileEnv(env(url), debug).ok).toBe(false);
    }
  });

  it("Standard ist die strenge Release-Regel", () => {
    expect(isAllowedSupabaseUrl("http://127.0.0.1:54321", false)).toBe(false);
    expect(isAllowedSupabaseUrl("HTTPS://API.BEISPIEL.TEST/rest", false)).toBe(true);
    expect(isAllowedSupabaseUrl("kein-url", true)).toBe(false);
  });
});

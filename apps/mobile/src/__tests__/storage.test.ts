import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { looksLikeSecretKey, parseMobileEnv } from "@/lib/env";
import { PLAN_CACHE_KEY, clearCachedPlan, loadCachedPlan, saveCachedPlan } from "@/lib/plan-cache";
import { SECURE_CHUNK_SIZE, secureSessionStorage, toSecureKey } from "@/lib/secure-storage";

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
});

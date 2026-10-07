import AsyncStorage from "@react-native-async-storage/async-storage";
import { type PlanSnapshot, planSnapshotSchema } from "@tagestakt/schedule-schema";

/**
 * Lokaler Zwischenspeicher des zuletzt erfolgreich geladenen, VERÖFFENTLICHTEN Plans.
 *
 * Liegt in AsyncStorage innerhalb der App-Sandbox und ist damit nur durch den
 * Betriebssystem-/Sandbox-Schutz gesichert (Android: dateibasierte Geräteverschlüsselung,
 * kein zusätzlicher App-Schlüssel). Enthält niemals Tokens. Android-Backups sind in app.json
 * deaktiviert. Wird beim Abmelden gelöscht.
 *
 * Datensparsam: Gespeichert wird nur, was Jetzt, Tag und Woche offline anzeigen. Notizen zu
 * Planblöcken und Planungshinweise zur Woche werden weder geladen noch gespeichert.
 */
export const PLAN_CACHE_KEY = "tagestakt.plan-snapshot.v3";
/** Frühere Formate (v2 konnte Notizen enthalten) – werden beim Laden und Abmelden entfernt. */
const LEGACY_PLAN_CACHE_KEYS = ["tagestakt.plan-snapshot.v1", "tagestakt.plan-snapshot.v2"];

/** Entfernt Felder, die offline nicht angezeigt werden (Notizen, Planungshinweis). */
export function minimizeSnapshotForCache(snapshot: PlanSnapshot): PlanSnapshot {
  return {
    ...snapshot,
    weeks: snapshot.weeks.map((week) => ({
      ...week,
      planning_note: null,
      schedule_entries: week.schedule_entries.map((entry) => ({ ...entry, note: null })),
    })),
  };
}

export async function loadCachedPlan(): Promise<PlanSnapshot | null> {
  try {
    await AsyncStorage.multiRemove(LEGACY_PLAN_CACHE_KEYS);
    const raw = await AsyncStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return null;
    const parsed = planSnapshotSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return minimizeSnapshotForCache(parsed.data);
    // Beschädigter oder veralteter Cache: verwerfen statt abstürzen.
    await AsyncStorage.removeItem(PLAN_CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

export async function saveCachedPlan(snapshot: PlanSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(minimizeSnapshotForCache(snapshot)));
  } catch {
    // Speichern ist optional – die App funktioniert online auch ohne Cache.
  }
}

export async function clearCachedPlan(): Promise<void> {
  await AsyncStorage.multiRemove([PLAN_CACHE_KEY, ...LEGACY_PLAN_CACHE_KEYS]);
}

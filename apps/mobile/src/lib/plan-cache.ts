import AsyncStorage from "@react-native-async-storage/async-storage";
import { type PlanSnapshot, planSnapshotSchema } from "@tagestakt/schedule-schema";

/**
 * Lokaler Zwischenspeicher des zuletzt erfolgreich geladenen, VERÖFFENTLICHTEN Plans.
 *
 * Liegt in AsyncStorage innerhalb der App-Sandbox und ist damit nur durch den
 * Betriebssystem-/Sandbox-Schutz gesichert (nicht zusätzlich verschlüsselt).
 * Enthält niemals Tokens. Android-Backups sind in app.json deaktiviert.
 * Wird beim Abmelden gelöscht.
 */
export const PLAN_CACHE_KEY = "tagestakt.plan-snapshot.v1";

export async function loadCachedPlan(): Promise<PlanSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return null;
    const parsed = planSnapshotSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    // Beschädigter oder veralteter Cache: verwerfen statt abstürzen.
    await AsyncStorage.removeItem(PLAN_CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

export async function saveCachedPlan(snapshot: PlanSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Speichern ist optional – die App funktioniert online auch ohne Cache.
  }
}

export async function clearCachedPlan(): Promise<void> {
  await AsyncStorage.removeItem(PLAN_CACHE_KEY);
}

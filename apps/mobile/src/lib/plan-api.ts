import {
  DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
  type PlanSnapshot,
  SCHEDULE_TIMEZONE,
  addDays,
  getWeekStart,
  planSnapshotSchema,
} from "@tagestakt/schedule-schema";

import { type TypedSupabaseClient } from "./supabase";

export class PlanFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanFetchError";
  }
}

/** Vorwoche (für Blöcke über Mitternacht), aktuelle und nächste Woche. */
export function relevantWeekStarts(now: Date): string[] {
  const current = getWeekStart(now);
  return [addDays(current, -7), current, addDays(current, 7)];
}

/**
 * Lädt ausschließlich VERÖFFENTLICHTE Wochenpläne (nie Entwürfe) und das Wochenziel.
 * Das Ergebnis wird mit dem gemeinsamen Schema validiert.
 */
export async function fetchPlanSnapshot(
  supabase: TypedSupabaseClient,
  now: Date = new Date(),
): Promise<PlanSnapshot> {
  const [weeks, settings] = await Promise.all([
    supabase
      .from("schedule_weeks")
      .select("*, schedule_entries(*)")
      .eq("status", "published")
      .in("week_start", relevantWeekStarts(now))
      .order("week_start"),
    supabase.from("user_settings").select("weekly_business_target_minutes, timezone").maybeSingle(),
  ]);

  if (weeks.error) throw new PlanFetchError("Der Wochenplan konnte nicht geladen werden.");
  if (settings.error) throw new PlanFetchError("Die Einstellungen konnten nicht geladen werden.");

  const parsed = planSnapshotSchema.safeParse({
    schemaVersion: 1,
    fetchedAt: now.toISOString(),
    weeks: weeks.data,
    weeklyBusinessTargetMinutes:
      settings.data?.weekly_business_target_minutes ?? DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
    timezone: settings.data?.timezone ?? SCHEDULE_TIMEZONE,
  });
  if (!parsed.success) {
    throw new PlanFetchError("Der geladene Wochenplan hat ein unerwartetes Format.");
  }
  return parsed.data;
}

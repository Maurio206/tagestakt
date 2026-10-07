import {
  DEFAULT_REMINDER_MINUTES_BEFORE,
  DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
  type PlanSnapshot,
  SCHEDULE_TIMEZONE,
  addDays,
  getWeekBounds,
  getWeekStart,
  goalTargetsFromSettings,
  planSnapshotSchema,
} from "@tagestakt/schedule-schema";

import { type TypedSupabaseClient } from "./supabase";

export class PlanFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanFetchError";
  }
}

/**
 * Spalten für die Offline-Anzeige. Bewusst OHNE `note` (Planblöcke) und `planning_note`
 * (Woche): Diese Freitexte zeigt die App in Jetzt/Tag/Woche nicht an – sie werden daher weder
 * übertragen noch auf dem Gerät gespeichert.
 */
const WEEK_COLUMNS =
  "id, owner_id, week_start, version, status, published_at, created_at, updated_at";
const ENTRY_COLUMNS =
  "id, owner_id, schedule_week_id, title, category, start_at, end_at, location, source, completion_status, created_at, updated_at";

/** Vorwoche (für Blöcke über Mitternacht), aktuelle und nächste Woche. */
export function relevantWeekStarts(now: Date): string[] {
  const current = getWeekStart(now);
  return [addDays(current, -7), current, addDays(current, 7)];
}

/**
 * Lädt ausschließlich VERÖFFENTLICHTE Wochenpläne (nie Entwürfe), Ziele,
 * Erinnerungseinstellungen und die erfassten Aktivitäten der geladenen Wochen
 * (plus eine eventuell noch laufende). Das Ergebnis wird mit dem gemeinsamen Schema validiert.
 */
export async function fetchPlanSnapshot(
  supabase: TypedSupabaseClient,
  now: Date = new Date(),
): Promise<PlanSnapshot> {
  const weekStarts = relevantWeekStarts(now);
  const from = getWeekBounds(weekStarts[0] ?? getWeekStart(now)).start.toISOString();
  const [weeks, settings, sessions] = await Promise.all([
    supabase
      .from("schedule_weeks")
      .select(`${WEEK_COLUMNS}, schedule_entries(${ENTRY_COLUMNS})`)
      .eq("status", "published")
      .in("week_start", weekStarts)
      .order("week_start"),
    supabase.from("user_settings").select("*").maybeSingle(),
    supabase
      .from("activity_sessions")
      .select("*")
      .or(`ended_at.is.null,started_at.gte.${from}`)
      .order("started_at"),
  ]);

  if (weeks.error) throw new PlanFetchError("Der Wochenplan konnte nicht geladen werden.");
  if (settings.error) throw new PlanFetchError("Die Einstellungen konnten nicht geladen werden.");
  if (sessions.error)
    throw new PlanFetchError("Die erfassten Zeiten konnten nicht geladen werden.");

  const row = settings.data;
  const parsed = planSnapshotSchema.safeParse({
    schemaVersion: 2,
    fetchedAt: now.toISOString(),
    weeks: (weeks.data ?? []).map((week) => ({
      ...week,
      planning_note: null,
      schedule_entries: week.schedule_entries.map((entry) => ({ ...entry, note: null })),
    })),
    goalTargets: goalTargetsFromSettings({
      weekly_business_target_minutes:
        row?.weekly_business_target_minutes ?? DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
      weekly_sport_target_minutes: row?.weekly_sport_target_minutes ?? null,
      weekly_relationship_target_minutes: row?.weekly_relationship_target_minutes ?? null,
    }),
    reminderSettings: {
      minutesBefore: row ? row.reminder_minutes_before : DEFAULT_REMINDER_MINUTES_BEFORE,
      atStart: row?.remind_at_start ?? true,
      ifNotStarted: row?.remind_if_not_started ?? false,
      scope: row?.reminder_scope ?? "important",
    },
    sessions: sessions.data,
    timezone: row?.timezone ?? SCHEDULE_TIMEZONE,
  });
  if (!parsed.success) {
    throw new PlanFetchError("Der geladene Wochenplan hat ein unerwartetes Format.");
  }
  return parsed.data;
}

import {
  type ActivitySession,
  type PlanSnapshot,
  type ScheduleEntry,
  resolveTimeRange,
} from "@tagestakt/schedule-schema";

/** Frei erfundene Testdaten (Beispiel) – keine echten Termine. */
export const OWNER = "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11";
export const WEEK = "c9f0f895-fb98-4b91-9f5a-1c2d3e4f5a6b";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

export function entry(
  title: string,
  category: ScheduleEntry["category"],
  date: string,
  start: string,
  end: string,
  completion: ScheduleEntry["completion_status"] = "planned",
): ScheduleEntry {
  const range = resolveTimeRange(date, start, end, false);
  return {
    id: nextId(),
    owner_id: OWNER,
    schedule_week_id: WEEK,
    title,
    category,
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
    location: null,
    note: null,
    source: "manual",
    completion_status: completion,
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

export function session(
  goal: ActivitySession["goal_category"],
  startedAt: string,
  endedAt: string | null,
  scheduleEntryId: string | null = null,
  title = "Aktivität (Beispiel)",
): ActivitySession {
  return {
    id: nextId(),
    owner_id: OWNER,
    goal_category: goal,
    schedule_entry_id: scheduleEntryId,
    title,
    started_at: startedAt,
    ended_at: endedAt,
    corrected_at: null,
    created_at: startedAt,
    updated_at: endedAt ?? startedAt,
  };
}

export const businessBlock = entry(
  "Gewerbe-Block (Beispiel)",
  "business",
  "2026-10-06",
  "15:30",
  "19:30",
);
export const sportBlock = entry("Training (Beispiel)", "sport", "2026-10-06", "19:45", "20:45");
export const pastBlock = entry(
  "Fokusblock (Beispiel)",
  "business",
  "2026-10-05",
  "15:00",
  "20:00",
  "completed",
);

export function snapshot(fetchedAt: string, overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    schemaVersion: 2,
    fetchedAt,
    goalTargets: { business: 1200, sport: null, relationship: null },
    reminderSettings: { minutesBefore: 10, atStart: true, ifNotStarted: false, scope: "important" },
    sessions: [],
    timezone: "Europe/Berlin",
    weeks: [
      {
        id: WEEK,
        owner_id: OWNER,
        week_start: "2026-10-05",
        version: 2,
        status: "published",
        planning_note: null,
        published_at: "2026-10-04T18:00:00+00:00",
        created_at: "2026-10-04T17:00:00+00:00",
        updated_at: "2026-10-04T18:00:00+00:00",
        schedule_entries: [pastBlock, businessBlock, sportBlock],
      },
    ],
    ...overrides,
  };
}

/** Dienstag, 06.10.2026, 17:00 Uhr Berliner Zeit (= 15:00 UTC). */
export const NOW = new Date("2026-10-06T15:00:00Z");

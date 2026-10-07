import { describe, expect, it } from "vitest";

import { agentDraftRequestSchema } from "./agent-contract";
import {
  formatDuration,
  formatHours,
  formatLocalDateLong,
  formatTimeRange,
  formatWeekLabel,
} from "./format";
import {
  planSnapshotSchema,
  recurringCommitmentInputSchema,
  recurringCommitmentRowSchema,
  scheduleEntryInputSchema,
  scheduleWeekWithEntriesSchema,
  toEntryColumns,
  goalSettingsInputSchema,
  weekStartSchema,
} from "./schemas";

const OWNER = "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11";
const WEEK = "c9f0f895-fb98-4b91-9f5a-1c2d3e4f5a6b";
const ENTRY = "45c48cce-2e2d-4fbd-8a6c-0d1e2f3a4b5c";

const validEntry = {
  title: "  Beispiel-Block  ",
  category: "business",
  date: "2026-10-06",
  startTime: "09:00",
  endTime: "11:30",
  location: "",
  note: undefined,
};

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("scheduleEntryInputSchema", () => {
  it("akzeptiert gültige Eingaben und normalisiert Freitext", () => {
    const parsed = scheduleEntryInputSchema.parse(validEntry);
    expect(parsed).toMatchObject({
      title: "Beispiel-Block",
      location: null,
      note: null,
      endsNextDay: false,
    });
    expect(toEntryColumns(parsed)).toEqual({
      title: "Beispiel-Block",
      category: "business",
      start_at: "2026-10-06T07:00:00.000Z",
      end_at: "2026-10-06T09:30:00.000Z",
      location: null,
      note: null,
    });
  });

  it("lehnt eine Endzeit vor der Startzeit ab", () => {
    const result = scheduleEntryInputSchema.safeParse({ ...validEntry, endTime: "08:00" });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(["endTime"]);
  });

  it("erlaubt Blöcke über Mitternacht mit „endet am Folgetag“", () => {
    const parsed = scheduleEntryInputSchema.parse({
      ...validEntry,
      category: "sleep",
      startTime: "22:30",
      endTime: "06:30",
      endsNextDay: true,
    });
    const columns = toEntryColumns(parsed);
    expect(columns.start_at).toBe("2026-10-06T20:30:00.000Z");
    expect(columns.end_at).toBe("2026-10-07T04:30:00.000Z");
  });

  it("lehnt Blöcke über 24 Stunden ab", () => {
    const result = scheduleEntryInputSchema.safeParse({
      ...validEntry,
      startTime: "08:00",
      endTime: "09:00",
      endsNextDay: true,
    });
    expect(result.success).toBe(false);
  });

  it("meldet Pflichtfelder und ungültige Werte verständlich", () => {
    const result = scheduleEntryInputSchema.safeParse({
      ...validEntry,
      title: "   ",
      category: "party",
      date: "2026-02-30",
      startTime: "25:00",
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result).sort()).toEqual(["category", "date", "startTime", "title"]);
    expect(result.error?.issues.find((i) => i.path[0] === "title")?.message).toBe(
      "Bitte einen Titel angeben",
    );
  });

  it("begrenzt die Länge von Freitexten", () => {
    const result = scheduleEntryInputSchema.safeParse({ ...validEntry, note: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });
});

describe("weitere Eingabeschemas", () => {
  it("verlangt einen Montag als Wochenbeginn", () => {
    expect(weekStartSchema.safeParse("2026-10-05").success).toBe(true);
    expect(weekStartSchema.safeParse("2026-10-06").success).toBe(false);
  });

  it("validiert Wiederholungen inklusive Übernacht-Blöcken", () => {
    const parsed = recurringCommitmentInputSchema.parse({
      title: "Beispiel-Schlaf",
      category: "sleep",
      weekday: "7",
      startTime: "22:30",
      endTime: "06:30",
    });
    expect(parsed.weekday).toBe(7);
    expect(parsed.active).toBe(true);
    expect(recurringCommitmentInputSchema.safeParse({ ...parsed, weekday: 8 }).success).toBe(false);
    expect(recurringCommitmentInputSchema.safeParse({ ...parsed, endTime: "22:30" }).success).toBe(
      false,
    );
  });

  it("begrenzt das Wochenziel", () => {
    const goals = (weeklyBusinessTargetMinutes: number) =>
      goalSettingsInputSchema.safeParse({
        weeklyBusinessTargetMinutes,
        weeklySportTargetMinutes: null,
        weeklyRelationshipTargetMinutes: null,
      }).success;
    expect(goals(1200)).toBe(true);
    expect(goals(0)).toBe(true);
    expect(goals(-1)).toBe(false);
    expect(goals(10081)).toBe(false);
    expect(goals(10.5)).toBe(false);
  });
});

describe("Datenbankzeilen", () => {
  it("liest Supabase-Zeilen inklusive Postgres-Zeitformaten", () => {
    const week = scheduleWeekWithEntriesSchema.parse({
      id: WEEK,
      owner_id: OWNER,
      week_start: "2026-10-05",
      version: 1,
      status: "published",
      planning_note: null,
      published_at: "2026-10-04T18:00:00.123456+00:00",
      created_at: "2026-10-04T17:00:00+00:00",
      updated_at: "2026-10-04T18:00:00+00:00",
      schedule_entries: [
        {
          id: ENTRY,
          owner_id: OWNER,
          schedule_week_id: WEEK,
          title: "Beispiel",
          category: "duty",
          start_at: "2026-10-05T06:00:00+00:00",
          end_at: "2026-10-05T14:00:00+00:00",
          location: null,
          note: null,
          source: "manual",
          completion_status: "planned",
          created_at: "2026-10-04T17:00:00+00:00",
          updated_at: "2026-10-04T17:00:00+00:00",
        },
      ],
    });
    expect(week.schedule_entries).toHaveLength(1);

    const recurring = recurringCommitmentRowSchema.parse({
      id: ENTRY,
      owner_id: OWNER,
      title: "Beispiel",
      category: "sport",
      weekday: 2,
      start_time: "18:00:00",
      end_time: "19:30:00",
      location: null,
      note: null,
      active: true,
      created_at: "2026-10-04T17:00:00+00:00",
      updated_at: "2026-10-04T17:00:00+00:00",
    });
    expect(recurring.start_time).toBe("18:00");
  });

  it("lehnt einen Cache mit unveröffentlichter Woche ab", () => {
    const result = planSnapshotSchema.safeParse({
      schemaVersion: 2,
      fetchedAt: "2026-10-06T10:00:00.000Z",
      goalTargets: { business: 1200, sport: null, relationship: null },
      reminderSettings: {
        minutesBefore: 10,
        atStart: true,
        ifNotStarted: false,
        scope: "important",
      },
      sessions: [],
      timezone: "Europe/Berlin",
      weeks: [
        {
          id: WEEK,
          owner_id: OWNER,
          week_start: "2026-10-05",
          version: 2,
          status: "draft",
          planning_note: null,
          published_at: null,
          created_at: "2026-10-04T17:00:00+00:00",
          updated_at: "2026-10-04T17:00:00+00:00",
          schedule_entries: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("geplanter Agent-Vertrag", () => {
  const request = {
    contractVersion: 1,
    idempotencyKey: "beispiel-schluessel-0001",
    weekStart: "2026-10-12",
    timezone: "Europe/Berlin",
    entries: [{ ...validEntry, date: "2026-10-13" }],
  };

  it("akzeptiert einen gültigen Entwurf", () => {
    expect(agentDraftRequestSchema.safeParse(request).success).toBe(true);
  });

  it("lässt keinen Status zu – Agenten können nicht veröffentlichen", () => {
    expect(agentDraftRequestSchema.safeParse({ ...request, status: "published" }).success).toBe(
      false,
    );
  });

  it("verlangt einen Idempotenzschlüssel", () => {
    expect(agentDraftRequestSchema.safeParse({ ...request, idempotencyKey: "kurz" }).success).toBe(
      false,
    );
  });
});

describe("Formatierung", () => {
  it("formatiert deutsche Anzeigen", () => {
    expect(formatDuration(80)).toBe("1 Std. 20 Min.");
    expect(formatDuration(45)).toBe("45 Min.");
    expect(formatDuration(180)).toBe("3 Std.");
    expect(formatHours(1230)).toBe("20,5 h");
    expect(formatWeekLabel("2026-10-05")).toBe("KW 41 · 05.10.–11.10.2026");
    expect(formatWeekLabel("2026-12-28")).toBe("KW 53 · 28.12.–03.01.2027");
    expect(formatLocalDateLong("2026-10-05", true)).toBe("Montag, 5. Oktober 2026");
    expect(formatTimeRange("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z")).toBe("02:30–02:30");
  });
});

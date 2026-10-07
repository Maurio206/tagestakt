import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVITY_ERROR_MESSAGES, isActivityErrorCode } from "./constants";
import {
  activityCorrectionInputSchema,
  activityCorrectionTimestampsSchema,
  activityManualInputSchema,
  activitySessionRowSchema,
  activityStartInputSchema,
  activitySwitchInputSchema,
  goalSettingsInputSchema,
  parseHoursInput,
  recurringCommitmentBatchInputSchema,
  reminderSettingsInputSchema,
  resolveActivityTimes,
  splitRecurringBatch,
  validateActivityTimes,
} from "./schemas";

const SESSION = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

beforeEach(() => {
  vi.useFakeTimers();
  // Mittwoch 14.10.2026, 18:00 Berlin
  vi.setSystemTime(new Date("2026-10-14T16:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Stundenangaben für Wochenziele", () => {
  it("versteht Komma, Punkt, Stunden:Minuten und leer", () => {
    expect(parseHoursInput("20")).toBe(1200);
    expect(parseHoursInput("2,5")).toBe(150);
    expect(parseHoursInput("2.25")).toBe(135);
    expect(parseHoursInput("1:30")).toBe(90);
    expect(parseHoursInput("  ")).toBeNull();
    expect(parseHoursInput("zwei")).toBeNaN();
    expect(parseHoursInput("-3")).toBeNaN();
  });

  it("speichert Sport/Laila ohne Ziel als null, auch bei 0", () => {
    const parsed = goalSettingsInputSchema.parse({
      weeklyBusinessTargetMinutes: 1200,
      weeklySportTargetMinutes: 0,
      weeklyRelationshipTargetMinutes: null,
    });
    expect(parsed).toEqual({
      weeklyBusinessTargetMinutes: 1200,
      weeklySportTargetMinutes: null,
      weeklyRelationshipTargetMinutes: null,
    });
    expect(
      goalSettingsInputSchema.safeParse({
        weeklyBusinessTargetMinutes: 1200,
        weeklySportTargetMinutes: 10081,
        weeklyRelationshipTargetMinutes: null,
      }).success,
    ).toBe(false);
  });
});

describe("Erinnerungseinstellungen", () => {
  it("prüft Vorlauf und Umfang", () => {
    const valid = {
      reminderMinutesBefore: 10,
      remindAtStart: true,
      remindIfNotStarted: false,
      reminderScope: "important",
    };
    expect(reminderSettingsInputSchema.safeParse(valid).success).toBe(true);
    expect(
      reminderSettingsInputSchema.safeParse({ ...valid, reminderMinutesBefore: null }).success,
    ).toBe(true);
    expect(
      reminderSettingsInputSchema.safeParse({ ...valid, reminderMinutesBefore: 0 }).success,
    ).toBe(false);
    expect(reminderSettingsInputSchema.safeParse({ ...valid, reminderScope: "x" }).success).toBe(
      false,
    );
  });
});

describe("Aktivität starten", () => {
  it("normalisiert leeren Titel und fehlenden Planblock zu null", () => {
    expect(activityStartInputSchema.parse({ goal: "sport", title: "  " })).toEqual({
      goal: "sport",
      title: null,
      scheduleEntryId: null,
    });
    expect(activityStartInputSchema.safeParse({ goal: "duty" }).success).toBe(false);
  });
});

describe("Aktivität wechseln", () => {
  const running = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  it("verlangt die laufende Aktivität und ein bekanntes Ziel", () => {
    expect(activitySwitchInputSchema.parse({ runningSessionId: running, goal: "sport" })).toEqual({
      runningSessionId: running,
      goal: "sport",
      title: null,
      scheduleEntryId: null,
    });
    expect(activitySwitchInputSchema.safeParse({ goal: "sport" }).success).toBe(false);
    expect(
      activitySwitchInputSchema.safeParse({ runningSessionId: "keine-uuid", goal: "sport" })
        .success,
    ).toBe(false);
    expect(
      activitySwitchInputSchema.safeParse({ runningSessionId: running, goal: "duty" }).success,
    ).toBe(false);
  });
});

describe("Zeit korrigieren und nachtragen", () => {
  it("rechnet Ortszeit in Zeitpunkte um (auch laufend)", () => {
    expect(
      resolveActivityTimes({
        date: "2026-10-14",
        startTime: "17:05",
        endTime: null,
        endsNextDay: false,
      }),
    ).toEqual({ start: new Date("2026-10-14T15:05:00Z"), end: null });
  });

  it("akzeptiert eine gültige Korrektur und eine weiterlaufende Aktivität", () => {
    const base = { sessionId: SESSION, date: "2026-10-14", startTime: "15:00" };
    expect(activityCorrectionInputSchema.safeParse({ ...base, endTime: "16:30" }).success).toBe(
      true,
    );
    expect(activityCorrectionInputSchema.safeParse({ ...base, endTime: null }).success).toBe(true);
  });

  it("lehnt Ende vor Beginn, Zukunft und mehr als 24 Stunden ab", () => {
    const base = { sessionId: SESSION, date: "2026-10-13" };
    const issue = (value: object) => {
      const result = activityCorrectionInputSchema.safeParse({ ...base, ...value });
      return result.success ? null : result.error.issues[0]?.message;
    };
    expect(issue({ startTime: "16:00", endTime: "15:00" })).toBe(
      "Das Ende muss nach dem Beginn liegen",
    );
    expect(issue({ date: "2026-10-14", startTime: "17:00", endTime: "19:00" })).toBe(
      "Das Ende darf nicht in der Zukunft liegen",
    );
    expect(issue({ date: "2026-10-14", startTime: "19:00", endTime: null })).toBe(
      "Der Beginn darf nicht in der Zukunft liegen",
    );
    expect(issue({ startTime: "01:00", endTime: "02:00", endsNextDay: true })).toBe(
      "Eine Aktivität darf höchstens 24 Stunden dauern",
    );
  });

  it("verlangt beim Nachtragen Ziel, Titel und Ende", () => {
    const valid = {
      goal: "relationship",
      title: "Spaziergang (Beispiel)",
      date: "2026-10-13",
      startTime: "18:00",
      endTime: "20:00",
    };
    expect(activityManualInputSchema.safeParse(valid).success).toBe(true);
    expect(activityManualInputSchema.safeParse({ ...valid, endTime: null }).success).toBe(false);
    expect(activityManualInputSchema.safeParse({ ...valid, title: " " }).success).toBe(false);
  });

  it("prüft Zeitstempel-Korrekturen der App genauso", () => {
    expect(
      activityCorrectionTimestampsSchema.safeParse({
        sessionId: SESSION,
        startedAt: "2026-10-14T10:00:00Z",
        endedAt: "2026-10-14T11:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      activityCorrectionTimestampsSchema.safeParse({
        sessionId: SESSION,
        startedAt: "2026-10-13T10:00:00Z",
        endedAt: null,
      }).success,
    ).toBe(false);
  });

  it("erlaubt eine Minute Toleranz für Geräteuhren", () => {
    const now = new Date("2026-10-14T16:00:00Z");
    expect(validateActivityTimes(new Date("2026-10-14T16:00:30Z"), null, now)).toBeNull();
    expect(validateActivityTimes(new Date("2026-10-14T16:01:30Z"), null, now)?.path).toBe("start");
  });
});

describe("Aktivitätszeilen und Fehlercodes", () => {
  it("liest eine Zeile aus Supabase", () => {
    const row = activitySessionRowSchema.parse({
      id: SESSION,
      owner_id: "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11",
      schedule_entry_id: null,
      goal_category: "business",
      title: "Kundenprojekt (Beispiel)",
      started_at: "2026-10-14T15:00:00+00:00",
      ended_at: null,
      corrected_at: null,
      created_at: "2026-10-14T15:00:00+00:00",
      updated_at: "2026-10-14T15:00:00+00:00",
    });
    expect(row.ended_at).toBeNull();
  });

  it("kennt die Fehlercodes der Datenbank", () => {
    expect(isActivityErrorCode("TT001")).toBe(true);
    expect(isActivityErrorCode("23505")).toBe(false);
    expect(ACTIVITY_ERROR_MESSAGES.TT004).toContain("überschneidet");
  });
});

describe("Wiederholungen für mehrere Wochentage", () => {
  it("zerlegt Werktage in einzelne Wiederholungen", () => {
    const parsed = recurringCommitmentBatchInputSchema.parse({
      title: "Dienst (Beispiel)",
      category: "duty",
      weekdays: ["5", "1", "2", "3", "4", "1"],
      startTime: "07:00",
      endTime: "16:30",
    });
    const items = splitRecurringBatch(parsed);
    expect(items.map((i) => i.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(items[0]).toMatchObject({ title: "Dienst (Beispiel)", active: true, location: null });
  });

  it("verlangt mindestens einen Wochentag", () => {
    const result = recurringCommitmentBatchInputSchema.safeParse({
      title: "x",
      category: "duty",
      weekdays: [],
      startTime: "07:00",
      endTime: "08:00",
    });
    expect(result.success).toBe(false);
  });
});

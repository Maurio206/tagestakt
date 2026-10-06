import { describe, expect, it } from "vitest";

import type { CompletionStatus, EntryCategory } from "./constants";
import {
  type RecurringTemplate,
  completedBusinessMinutes,
  detectOverlaps,
  expandRecurringCommitments,
  getBusinessProgress,
  getCurrentEntry,
  getEntriesForDay,
  getEntryProgress,
  getEntryTimeState,
  getNextEntry,
  getRemainingMinutes,
  groupEntriesByDay,
  isEntryWithinWeek,
  overlappingEntryIds,
  plannedBusinessMinutes,
  resolveTimeRange,
} from "./schedule";
import { toLocalTime } from "./time";

interface TestEntry {
  id: string;
  category: EntryCategory;
  completion_status: CompletionStatus;
  start_at: string;
  end_at: string;
}

let counter = 0;
/** Baut einen Eintrag aus Berliner Ortszeit. */
function entry(
  date: string,
  start: string,
  end: string,
  overrides: Partial<TestEntry> & { endsNextDay?: boolean } = {},
): TestEntry {
  const { endsNextDay = false, ...rest } = overrides;
  const range = resolveTimeRange(date, start, end, endsNextDay);
  counter += 1;
  return {
    id: `e${counter}`,
    category: "other",
    completion_status: "planned",
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
    ...rest,
  };
}

const berlin = (date: string, time: string) => resolveTimeRange(date, time, time, false).start;

describe("Überschneidungen", () => {
  it("meldet keine Überschneidung bei direkt aneinandergrenzenden Blöcken", () => {
    const entries = [entry("2026-10-05", "08:00", "09:00"), entry("2026-10-05", "09:00", "10:00")];
    expect(detectOverlaps(entries)).toEqual([]);
  });

  it("erkennt teilweise und vollständig enthaltene Überschneidungen", () => {
    const a = entry("2026-10-05", "08:00", "12:00");
    const b = entry("2026-10-05", "09:00", "10:00");
    const c = entry("2026-10-05", "11:30", "13:00");
    const d = entry("2026-10-05", "14:00", "15:00");
    const overlaps = detectOverlaps([d, c, b, a]);
    expect(overlaps.map((o) => [o.first.id, o.second.id, o.overlapMinutes])).toEqual([
      [a.id, b.id, 60],
      [a.id, c.id, 30],
    ]);
    expect(overlappingEntryIds([a, b, c, d])).toEqual(new Set([a.id, b.id, c.id]));
  });

  it("erkennt Überschneidungen über Mitternacht", () => {
    const sleep = entry("2026-10-05", "23:00", "07:00", { endsNextDay: true });
    const early = entry("2026-10-06", "06:30", "07:30");
    expect(detectOverlaps([sleep, early])).toHaveLength(1);
  });
});

describe("Gewerbeminuten", () => {
  it("summiert geplante Gewerbeblöcke ohne ausgelassene", () => {
    const entries = [
      entry("2026-10-05", "09:00", "12:00", { category: "business" }),
      entry("2026-10-06", "13:00", "14:30", {
        category: "business",
        completion_status: "completed",
      }),
      entry("2026-10-07", "09:00", "10:00", { category: "business", completion_status: "skipped" }),
      entry("2026-10-07", "10:00", "11:00", { category: "sport" }),
    ];
    expect(plannedBusinessMinutes(entries)).toBe(270);
    expect(completedBusinessMinutes(entries)).toBe(90);
  });

  it("zählt überlappende Gewerbeblöcke nicht doppelt", () => {
    const entries = [
      entry("2026-10-05", "09:00", "12:00", { category: "business" }),
      entry("2026-10-05", "11:00", "13:00", { category: "business" }),
    ];
    expect(plannedBusinessMinutes(entries)).toBe(240);
  });

  it("rechnet mit echter Dauer bei Zeitumstellung", () => {
    // 25.10.2026 01:00–04:00 Ortszeit dauert wegen der Rückstellung 4 Stunden.
    expect(
      plannedBusinessMinutes([entry("2026-10-25", "01:00", "04:00", { category: "business" })]),
    ).toBe(240);
    // 29.03.2026 01:00–04:00 Ortszeit dauert nur 2 Stunden.
    expect(
      plannedBusinessMinutes([entry("2026-03-29", "01:00", "04:00", { category: "business" })]),
    ).toBe(120);
  });

  it("berechnet den Fortschritt zum Standardziel von 20 Stunden", () => {
    const entries = [
      entry("2026-10-05", "08:00", "13:00", {
        category: "business",
        completion_status: "completed",
      }),
      entry("2026-10-06", "08:00", "13:00", { category: "business" }),
    ];
    expect(getBusinessProgress(entries, 1200)).toEqual({
      targetMinutes: 1200,
      plannedMinutes: 600,
      completedMinutes: 300,
      plannedRatio: 0.5,
      completedRatio: 0.25,
      missingPlannedMinutes: 600,
    });
  });

  it("kommt mit Ziel 0 zurecht", () => {
    expect(getBusinessProgress([], 0).plannedRatio).toBe(1);
  });
});

describe("Jetzt und Als Nächstes", () => {
  const morning = entry("2026-10-06", "07:00", "07:30");
  const work = entry("2026-10-06", "08:00", "12:00");
  const call = entry("2026-10-06", "10:00", "10:30");
  const lunch = entry("2026-10-06", "12:00", "12:45");
  const entries = [lunch, call, work, morning];

  it("findet den laufenden Block", () => {
    expect(getCurrentEntry(entries, berlin("2026-10-06", "07:10"))?.id).toBe(morning.id);
    expect(getCurrentEntry(entries, berlin("2026-10-06", "09:00"))?.id).toBe(work.id);
  });

  it("bevorzugt bei Überschneidung den zuletzt begonnenen Block", () => {
    expect(getCurrentEntry(entries, berlin("2026-10-06", "10:15"))?.id).toBe(call.id);
  });

  it("behandelt das Ende als exklusiv", () => {
    expect(getCurrentEntry(entries, berlin("2026-10-06", "12:00"))?.id).toBe(lunch.id);
    expect(getCurrentEntry(entries, berlin("2026-10-06", "07:45"))).toBeUndefined();
  });

  it("findet den nächsten Block", () => {
    expect(getNextEntry(entries, berlin("2026-10-06", "07:10"))?.id).toBe(work.id);
    expect(getNextEntry(entries, berlin("2026-10-06", "08:00"))?.id).toBe(call.id);
    expect(getNextEntry(entries, berlin("2026-10-06", "13:00"))).toBeUndefined();
  });

  it("berechnet Restzeit, Fortschritt und Zeitstatus", () => {
    const now = berlin("2026-10-06", "09:00");
    expect(getRemainingMinutes(work, now)).toBe(180);
    expect(getEntryProgress(work, now)).toBe(0.25);
    expect(getEntryTimeState(morning, now)).toBe("past");
    expect(getEntryTimeState(work, now)).toBe("current");
    expect(getEntryTimeState(lunch, now)).toBe("future");
  });

  it("findet den nächsten Block über den Wochenwechsel", () => {
    const sundayEvening = entry("2026-10-11", "20:00", "21:00");
    const mondayMorning = entry("2026-10-12", "06:00", "06:30");
    expect(getNextEntry([sundayEvening, mondayMorning], berlin("2026-10-11", "22:00"))?.id).toBe(
      mondayMorning.id,
    );
  });
});

describe("Wochenzugehörigkeit", () => {
  it("akzeptiert Einträge, die in der Woche beginnen", () => {
    expect(isEntryWithinWeek(entry("2026-10-05", "00:00", "01:00"), "2026-10-05")).toBe(true);
    expect(isEntryWithinWeek(entry("2026-10-11", "23:30", "23:59"), "2026-10-05")).toBe(true);
  });

  it("erlaubt Schlaf von Sonntag auf Montag in der alten Woche", () => {
    const sleep = entry("2026-10-11", "23:00", "07:00", { endsNextDay: true });
    expect(isEntryWithinWeek(sleep, "2026-10-05")).toBe(true);
    expect(isEntryWithinWeek(sleep, "2026-10-12")).toBe(false);
  });

  it("lehnt Einträge der Nachbarwochen ab", () => {
    expect(isEntryWithinWeek(entry("2026-10-12", "00:00", "01:00"), "2026-10-05")).toBe(false);
    expect(isEntryWithinWeek(entry("2026-10-04", "23:00", "23:30"), "2026-10-05")).toBe(false);
  });

  it("lehnt Einträge über 24 Stunden ab", () => {
    const long = {
      start_at: berlin("2026-10-05", "08:00").toISOString(),
      end_at: berlin("2026-10-06", "08:01").toISOString(),
    };
    expect(isEntryWithinWeek(long, "2026-10-05")).toBe(false);
  });
});

describe("Tages- und Wochengruppierung", () => {
  it("gruppiert nach Berliner Kalendertag", () => {
    const mondayEarly = entry("2026-10-05", "00:30", "01:00"); // UTC: Sonntag
    const sunday = entry("2026-10-11", "18:00", "19:00");
    const groups = groupEntriesByDay([sunday, mondayEarly], "2026-10-05");
    expect(groups).toHaveLength(7);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual([mondayEarly.id]);
    expect(groups[6]?.entries.map((e) => e.id)).toEqual([sunday.id]);
  });

  it("zeigt in der Tagesansicht auch Blöcke vom Vorabend", () => {
    const sleep = entry("2026-10-05", "22:30", "06:30", { endsNextDay: true });
    const breakfast = entry("2026-10-06", "07:00", "07:30");
    const evening = entry("2026-10-06", "20:00", "21:00");
    expect(getEntriesForDay([evening, breakfast, sleep], "2026-10-06").map((e) => e.id)).toEqual([
      sleep.id,
      breakfast.id,
      evening.id,
    ]);
  });
});

describe("Wiederholungen", () => {
  const base: Omit<RecurringTemplate, "id" | "weekday" | "start_time" | "end_time"> = {
    title: "Beispiel",
    category: "duty",
    location: null,
    note: null,
    active: true,
  };

  it("erzeugt Einträge am richtigen Wochentag", () => {
    const result = expandRecurringCommitments(
      [
        { ...base, id: "r1", weekday: 3, start_time: "08:00", end_time: "16:00" },
        { ...base, id: "r2", weekday: 1, start_time: "18:00", end_time: "19:00" },
        { ...base, id: "r3", weekday: 2, start_time: "10:00", end_time: "11:00", active: false },
      ],
      "2026-10-05",
    );
    expect(result.map((e) => [e.start_at, e.end_at])).toEqual([
      ["2026-10-05T16:00:00.000Z", "2026-10-05T17:00:00.000Z"],
      ["2026-10-07T06:00:00.000Z", "2026-10-07T14:00:00.000Z"],
    ]);
    expect(result.every((e) => e.source === "recurring")).toBe(true);
  });

  it("lässt Blöcke über Mitternacht am Folgetag enden", () => {
    const [sleep] = expandRecurringCommitments(
      [
        {
          ...base,
          id: "r1",
          weekday: 7,
          start_time: "22:30",
          end_time: "06:30",
          category: "sleep",
        },
      ],
      "2026-10-05",
    );
    expect(sleep?.start_at).toBe("2026-10-11T20:30:00.000Z");
    expect(sleep?.end_at).toBe("2026-10-12T04:30:00.000Z");
  });

  it("behält die Ortszeit in der Woche der Zeitumstellung", () => {
    const result = expandRecurringCommitments(
      [
        { ...base, id: "r1", weekday: 6, start_time: "09:00", end_time: "10:00" },
        { ...base, id: "r2", weekday: 7, start_time: "09:00", end_time: "10:00" },
      ],
      "2026-10-19",
    );
    expect(result.map((e) => toLocalTime(new Date(e.start_at)))).toEqual(["09:00", "09:00"]);
    expect(result.map((e) => e.start_at)).toEqual([
      "2026-10-24T07:00:00.000Z",
      "2026-10-25T08:00:00.000Z",
    ]);
  });
});

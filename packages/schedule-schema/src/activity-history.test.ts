/**
 * Aktivitätsverlauf: Summen und Muster aus veröffentlichten Plänen und erfasster Zeit. Alle Daten
 * sind frei erfunden (Beispiel).
 */
import { describe, expect, it } from "vitest";

import {
  type HistoryPlanBlock,
  type HistoryWeekInput,
  activityHistoryWeekStarts,
  buildActivityHistory,
  splitByDayAndBand,
} from "./activity-history";
import type { CompletionStatus, EntryCategory, GoalKey } from "./constants";
import { type TrackedSession } from "./goals";

/** Ortszeit Europe/Berlin im Sommer (UTC+2) bzw. Winter (UTC+1). */
const summer = (date: string, time: string) => `${date}T${time}:00+02:00`;
const winter = (date: string, time: string) => `${date}T${time}:00+01:00`;

function session(
  goal: GoalKey,
  date: string,
  start: string,
  end: string | null,
  endDate = date,
): TrackedSession {
  return {
    goal_category: goal,
    started_at: summer(date, start),
    ended_at: end === null ? null : summer(endDate, end),
  };
}

function block(
  category: EntryCategory,
  date: string,
  start: string,
  end: string,
  completion: CompletionStatus = "planned",
): HistoryPlanBlock {
  return {
    category,
    completion_status: completion,
    start_at: summer(date, start),
    end_at: summer(date, end),
  };
}

describe("activityHistoryWeekStarts", () => {
  const sunday = new Date(summer("2026-10-11", "18:00"));

  it("abgeschlossene Wochen vor der laufenden, älteste zuerst, plus laufende Woche", () => {
    expect(activityHistoryWeekStarts(sunday, 3)).toEqual([
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
    ]);
    expect(activityHistoryWeekStarts(sunday, 3, false)).toEqual([
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(activityHistoryWeekStarts(sunday)).toHaveLength(9);
  });

  it("begrenzt auf 1 bis 12 Wochen", () => {
    expect(activityHistoryWeekStarts(sunday, 0, false)).toEqual(["2026-09-28"]);
    expect(activityHistoryWeekStarts(sunday, 40, false)).toHaveLength(12);
  });

  it("Wochenwechsel: Montag kurz nach Mitternacht gehört schon zur neuen Woche", () => {
    expect(activityHistoryWeekStarts(new Date(summer("2026-10-12", "00:30")), 1)).toEqual([
      "2026-10-05",
      "2026-10-12",
    ]);
    // Sonntag 23:59 Ortszeit ist in UTC schon Montag – zählt aber noch zur alten Woche.
    expect(activityHistoryWeekStarts(new Date(summer("2026-10-11", "23:59")), 1)).toEqual([
      "2026-09-28",
      "2026-10-05",
    ]);
  });
});

describe("splitByDayAndBand", () => {
  const split = (start: string, end: string) =>
    splitByDayAndBand({ start: new Date(start), end: new Date(end) });

  it("teilt an Mitternacht und an den Zeitfenstern", () => {
    expect(split(summer("2026-10-11", "20:30"), summer("2026-10-12", "00:30"))).toEqual([
      { date: "2026-10-11", band: "17-21", minutes: 30 },
      { date: "2026-10-11", band: "21-24", minutes: 180 },
      { date: "2026-10-12", band: "00-05", minutes: 30 },
    ]);
  });

  it("Umstellung auf Sommerzeit: 01:30–03:30 Ortszeit ist nur eine Stunde", () => {
    expect(split(winter("2026-03-29", "01:30"), summer("2026-03-29", "03:30"))).toEqual([
      { date: "2026-03-29", band: "00-05", minutes: 60 },
    ]);
  });

  it("Umstellung auf Winterzeit: 01:30–03:30 Ortszeit sind drei Stunden", () => {
    expect(split(summer("2026-10-25", "01:30"), winter("2026-10-25", "03:30"))).toEqual([
      { date: "2026-10-25", band: "00-05", minutes: 180 },
    ]);
  });
});

describe("buildActivityHistory", () => {
  const WEEK = "2026-09-28";
  const NEXT = "2026-10-05";
  const afterWeek = new Date(summer("2026-10-07", "12:00"));

  const published: HistoryPlanBlock[] = [
    block("business", "2026-09-28", "13:00", "17:00", "completed"),
    block("business", "2026-09-29", "13:00", "17:00"),
    block("business", "2026-09-30", "13:00", "17:00", "skipped"),
    block("business", "2026-10-01", "13:00", "17:00"),
    block("duty", "2026-10-02", "08:00", "12:00", "completed"),
  ];
  const sessions: TrackedSession[] = [
    session("business", "2026-09-28", "13:05", "16:35"),
    // Nur ein Viertel erfasst und nicht erledigt markiert → verpasst.
    session("business", "2026-09-29", "13:00", "14:00"),
    // Drei Viertel erfasst → umgesetzt, auch ohne Erledigt-Markierung.
    session("business", "2026-10-01", "13:00", "16:00"),
    // Ohne Planblock (spontan).
    session("business", "2026-10-03", "10:00", "11:00"),
  ];

  it("geplant, erfasst, im Plan und ohne Plan; Blöcke umgesetzt/ausgelassen/verpasst", () => {
    const history = buildActivityHistory({
      now: afterWeek,
      weeks: [{ weekStart: WEEK, published }],
      sessions,
    });
    expect(history.weeks).toHaveLength(1);
    expect(history.weeks[0]).toMatchObject({ weekStart: WEEK, state: "past", publishedPlan: true });
    expect(history.weeks[0]?.goals.business).toEqual({
      plannedMinutes: 720,
      trackedMinutes: 510,
      trackedInPlanMinutes: 450,
      trackedWithoutPlanMinutes: 60,
      blocks: { finished: 4, followed: 2, skipped: 1, missed: 1 },
    });
    expect(history.weeks[0]?.goals.sport.trackedMinutes).toBe(0);
    expect(history.patterns.business.followThroughRate).toBe(0.5);
    expect(history.patterns.business.plannedBlockLength).toMatchObject({
      count: 3,
      medianMinutes: 240,
    });
    expect(history.patterns.business.sessionLength).toEqual({
      count: 4,
      medianMinutes: 120,
      p25Minutes: 60,
      p75Minutes: 188,
    });
    expect(history.summary[0]).toBe(
      "Gewerbe: Ø 8,5 h erfasst je Woche (geplant Ø 12 h), 50 % der geplanten Blöcke umgesetzt, 1 h ohne Plan, typische Einheit 2 h.",
    );
    expect(history.from).toBe(WEEK);
    expect(history.to).toBe("2026-10-04");
  });

  it("Woche ohne veröffentlichten Plan: alles zählt als ohne Plan", () => {
    const history = buildActivityHistory({
      now: afterWeek,
      weeks: [{ weekStart: WEEK, published: null }],
      sessions,
    });
    expect(history.weeks[0]?.publishedPlan).toBe(false);
    expect(history.weeks[0]?.goals.business).toMatchObject({
      plannedMinutes: 0,
      trackedMinutes: 510,
      trackedWithoutPlanMinutes: 510,
      blocks: { finished: 0, followed: 0, skipped: 0, missed: 0 },
    });
    expect(history.patterns.business.followThroughRate).toBeNull();
    expect(history.summary.at(-1)).toBe(
      "Ohne veröffentlichten Plan (nur erfasste Zeit): 2026-09-28.",
    );
  });

  it("Wochenwechsel: eine Aktivität über Mitternacht zählt anteilig in beiden Wochen", () => {
    const history = buildActivityHistory({
      now: afterWeek,
      weeks: [
        { weekStart: WEEK, published: [] },
        { weekStart: NEXT, published: [] },
      ],
      sessions: [session("relationship", "2026-10-04", "23:00", "01:00", "2026-10-05")],
    });
    expect(history.weeks.map((w) => w.goals.relationship.trackedMinutes)).toEqual([60, 60]);
    expect(history.weeks.map((w) => w.state)).toEqual(["past", "current"]);
    expect(history.patterns.relationship.slots).toEqual([
      expect.objectContaining({ weekday: "Mo", band: "00-05", trackedMinutes: 60 }),
      expect.objectContaining({ weekday: "So", band: "21-24", trackedMinutes: 60 }),
    ]);
    // Nur eine Einheit, auch wenn sie über den Wochenwechsel läuft.
    expect(history.patterns.relationship.sessionLength?.count).toBe(1);
  });

  it("laufende Woche: nur bis jetzt; künftige Blöcke zählen noch nicht", () => {
    const now = new Date(summer("2026-10-07", "15:00"));
    const history = buildActivityHistory({
      now,
      weeks: [
        {
          weekStart: NEXT,
          published: [
            block("sport", "2026-10-05", "18:00", "19:00", "completed"),
            block("sport", "2026-10-07", "14:00", "16:00"),
            block("sport", "2026-10-09", "18:00", "19:00"),
          ],
        },
      ],
      sessions: [session("sport", "2026-10-07", "14:00", null)],
    });
    expect(history.includesCurrentWeek).toBe(true);
    expect(history.to).toBe("2026-10-07");
    expect(history.weeks[0]?.goals.sport).toEqual({
      plannedMinutes: 120,
      trackedMinutes: 60,
      trackedInPlanMinutes: 60,
      trackedWithoutPlanMinutes: 0,
      blocks: { finished: 1, followed: 1, skipped: 0, missed: 0 },
    });
  });

  it("vergessene laufende Aktivität zählt höchstens 24 Stunden", () => {
    const history = buildActivityHistory({
      now: new Date(summer("2026-10-07", "12:00")),
      weeks: [{ weekStart: NEXT, published: null }],
      sessions: [session("business", "2026-10-05", "08:00", null)],
    });
    expect(history.weeks[0]?.goals.business.trackedMinutes).toBe(24 * 60);
  });

  it("nachgetragene bzw. korrigierte Aktivitäten zählen mit ihren eingetragenen Zeiten", () => {
    const corrected = { ...session("sport", "2026-09-29", "18:00", "19:30"), corrected_at: "x" };
    const history = buildActivityHistory({
      now: afterWeek,
      weeks: [{ weekStart: WEEK, published: [block("sport", "2026-09-29", "18:00", "19:00")] }],
      sessions: [corrected],
    });
    expect(history.weeks[0]?.goals.sport).toMatchObject({
      trackedMinutes: 90,
      trackedInPlanMinutes: 60,
      trackedWithoutPlanMinutes: 30,
      blocks: { finished: 1, followed: 1, skipped: 0, missed: 0 },
    });
  });

  it("Muster über Wochen: verlässliche und unzuverlässige Zeitfenster, häufigste Zeiten", () => {
    const weeks: HistoryWeekInput[] = ["2026-09-14", "2026-09-21", "2026-09-28"].map((monday) => {
      const tuesday = `${monday.slice(0, 8)}${String(Number(monday.slice(8)) + 1).padStart(2, "0")}`;
      const thursday = `${monday.slice(0, 8)}${String(Number(monday.slice(8)) + 3).padStart(2, "0")}`;
      return {
        weekStart: monday,
        published: [
          block("sport", tuesday, "18:00", "19:30"),
          block("sport", thursday, "06:00", "07:00"),
        ],
      };
    });
    const trained = weeks.map((w) => {
      const tuesday = w.published?.[0];
      return {
        goal_category: "sport" as const,
        started_at: tuesday?.start_at ?? "",
        ended_at: tuesday?.end_at ?? null,
      };
    });
    const history = buildActivityHistory({ now: afterWeek, weeks, sessions: trained });
    expect(history.patterns.sport.mostReliable).toEqual([
      "Di 17–21 Uhr: 3 von 3 geplanten Blöcken umgesetzt",
    ]);
    expect(history.patterns.sport.leastReliable).toEqual([
      "Do 05–09 Uhr: 0 von 3 geplanten Blöcken umgesetzt",
    ]);
    expect(history.patterns.sport.mostTracked).toEqual([
      "Di 17–21 Uhr: 4,5 h erfasst (in 3 von 3 Wochen)",
    ]);
    expect(history.weeks.map((w) => w.goals.sport.blocks.missed)).toEqual([1, 1, 1]);
    expect(history.patterns.sport.averageTrackedMinutesPerWeek).toBe(90);
    expect(history.patterns.sport.kind).toBe("Training");
  });

  it("Kurztext endet mit genau einem Punkt, auch nach „Min.“", () => {
    const history = buildActivityHistory({
      now: afterWeek,
      weeks: [{ weekStart: WEEK, published: null }],
      sessions: [session("sport", "2026-09-29", "18:00", "18:45")],
    });
    expect(history.summary[1]).toBe(
      "Training: Ø 45 Min. erfasst je Woche (geplant Ø 0 Min.), keine vergangenen Planblöcke, 45 Min. ohne Plan, typische Einheit 45 Min.",
    );
  });

  it("neutral: keine privaten Bezeichnungen, keine Titel", () => {
    const history = buildActivityHistory({
      now: afterWeek,
      weeks: [
        { weekStart: WEEK, published: [block("relationship", "2026-10-02", "18:00", "21:00")] },
      ],
      sessions: [session("relationship", "2026-10-02", "18:00", "21:00")],
    });
    const json = JSON.stringify(history);
    expect(history.patterns.relationship.kind).toBe("Beziehungszeit");
    expect(json).not.toContain("Laila");
    expect(history.summary[2]).toContain("Beziehungszeit: Ø 3 h erfasst je Woche");
  });
});

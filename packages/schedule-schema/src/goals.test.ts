import { describe, expect, it } from "vitest";

import type { CompletionStatus, EntryCategory, GoalKey } from "./constants";
import { formatDurationSpoken, formatElapsed, formatSignedHours } from "./format";
import {
  type PlannedBlock,
  type TrackedSession,
  formatGoalAmount,
  getGoalProgress,
  getGoalStatus,
  getPlannedMinutes,
  getRemainingPlannedMinutes,
  getRunningSession,
  getSessionElapsedMs,
  getSessionMinutes,
  getTrackedMinutes,
  getWeekGoals,
  getWeekState,
  getWeekSummarySentence,
  goalTargetsFromSettings,
  hasGoalTarget,
  isLikelyForgotten,
  requiresCorrectionToStop,
} from "./goals";
import { getWeekBounds } from "./time";

function session(goal: GoalKey, startedAt: string, endedAt: string | null): TrackedSession {
  return { goal_category: goal, started_at: startedAt, ended_at: endedAt };
}

function block(
  category: EntryCategory,
  startAt: string,
  endAt: string,
  completion: CompletionStatus = "planned",
): PlannedBlock {
  return { category, completion_status: completion, start_at: startAt, end_at: endAt };
}

// KW 42/2026: Montag 12.10. – Sonntag 18.10. (Sommerzeit, UTC+2)
const KW42 = "2026-10-12";
// KW 43/2026: enthält das Ende der Sommerzeit am Sonntag 25.10. (03:00 → 02:00)
const KW43 = "2026-10-19";
// KW 13/2026: enthält den Beginn der Sommerzeit am Sonntag 29.03. (02:00 → 03:00)
const KW13 = "2026-03-23";

describe("Wochengrenzen und Zeitumstellung", () => {
  it("Wochen mit Zeitumstellung sind 169 bzw. 167 Stunden lang", () => {
    const autumn = getWeekBounds(KW43);
    const spring = getWeekBounds(KW13);
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000).toBe(169);
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(167);
  });

  it("zählt Aktivitäten über das Ende der Sommerzeit in echter Dauer", () => {
    // 02:00 Sommerzeit bis 03:00 Winterzeit = 2 echte Stunden
    const sessions = [session("business", "2026-10-25T00:00:00Z", "2026-10-25T02:00:00Z")];
    const now = new Date("2026-10-26T12:00:00Z");
    expect(getTrackedMinutes(sessions, "business", KW43, now)).toBe(120);
  });

  it("zählt Aktivitäten über den Beginn der Sommerzeit in echter Dauer", () => {
    // 01:30 Winterzeit bis 03:30 Sommerzeit = 1 echte Stunde
    const sessions = [session("sport", "2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z")];
    const now = new Date("2026-03-30T12:00:00Z");
    expect(getTrackedMinutes(sessions, "sport", KW13, now)).toBe(60);
  });

  it("teilt Aktivitäten am Wochenwechsel (Montag 00:00 Berlin)", () => {
    // Sonntag 18.10. 23:30 bis Montag 19.10. 00:45 (UTC+2)
    const sessions = [session("business", "2026-10-18T21:30:00Z", "2026-10-18T22:45:00Z")];
    const now = new Date("2026-10-20T12:00:00Z");
    expect(getTrackedMinutes(sessions, "business", KW42, now)).toBe(30);
    expect(getTrackedMinutes(sessions, "business", KW43, now)).toBe(45);
  });

  it("zählt Aktivitäten über Mitternacht innerhalb der Woche vollständig", () => {
    // Dienstag 23:00 bis Mittwoch 01:00
    const sessions = [session("relationship", "2026-10-13T21:00:00Z", "2026-10-13T23:00:00Z")];
    const now = new Date("2026-10-16T12:00:00Z");
    expect(getTrackedMinutes(sessions, "relationship", KW42, now)).toBe(120);
  });

  it("bestimmt abgeschlossene, laufende und künftige Wochen an der Berliner Grenze", () => {
    const mondayMidnight = new Date("2026-10-11T22:00:00Z"); // Mo 12.10. 00:00 Berlin
    expect(getWeekState(KW42, mondayMidnight)).toBe("current");
    expect(getWeekState(KW42, new Date(mondayMidnight.getTime() - 1))).toBe("future");
    expect(getWeekState(KW42, new Date("2026-10-18T21:59:59Z"))).toBe("current");
    expect(getWeekState(KW42, new Date("2026-10-18T22:00:00Z"))).toBe("past");
  });
});

describe("erfasste Zeit", () => {
  const now = new Date("2026-10-14T16:00:00Z");

  it("zählt eine laufende Aktivität bis jetzt", () => {
    const running = session("business", "2026-10-14T15:15:00Z", null);
    expect(getSessionMinutes(running, now)).toBe(45);
    expect(getTrackedMinutes([running], "business", KW42, now)).toBe(45);
    expect(getSessionElapsedMs(running, now)).toBe(45 * 60_000);
  });

  it("trennt die Ziele und zählt Überschneidungen nur einmal", () => {
    const sessions = [
      session("business", "2026-10-12T15:00:00Z", "2026-10-12T17:00:00Z"),
      session("business", "2026-10-12T16:00:00Z", "2026-10-12T18:00:00Z"),
      session("sport", "2026-10-12T18:00:00Z", "2026-10-12T19:00:00Z"),
    ];
    expect(getTrackedMinutes(sessions, "business", KW42, now)).toBe(180);
    expect(getTrackedMinutes(sessions, "sport", KW42, now)).toBe(60);
    expect(getTrackedMinutes(sessions, "relationship", KW42, now)).toBe(0);
  });

  it("findet die laufende Aktivität und erkennt vergessene", () => {
    const sessions = [
      session("sport", "2026-10-13T16:00:00Z", "2026-10-13T17:00:00Z"),
      session("business", "2026-10-14T03:00:00Z", null),
    ];
    const running = getRunningSession(sessions);
    expect(running?.goal_category).toBe("business");
    expect(running && isLikelyForgotten(running, now)).toBe(true);
    expect(running && requiresCorrectionToStop(running, now)).toBe(false);
    expect(running && requiresCorrectionToStop(running, new Date("2026-10-15T03:00:01Z"))).toBe(
      true,
    );
  });
});

describe("geplante Zeit", () => {
  const entries = [
    block("business", "2026-10-12T15:00:00Z", "2026-10-12T18:00:00Z"),
    block("business", "2026-10-12T17:00:00Z", "2026-10-12T19:00:00Z"),
    block("business", "2026-10-13T15:00:00Z", "2026-10-13T17:00:00Z", "skipped"),
    block("business", "2026-10-15T15:00:00Z", "2026-10-15T17:00:00Z", "completed"),
    block("duty", "2026-10-12T05:00:00Z", "2026-10-12T14:30:00Z"),
  ];

  it("zählt Planblöcke außer „ausgelassen“ mit Überlappung einmal", () => {
    expect(getPlannedMinutes(entries, "business")).toBe(240 + 120);
    expect(getPlannedMinutes(entries, "sport")).toBe(0);
  });

  it("schneidet „noch eingeplant“ bei jetzt ab", () => {
    const now = new Date("2026-10-12T18:00:00Z");
    expect(getRemainingPlannedMinutes(entries, "business", now)).toBe(60 + 120);
  });
});

describe("Zielstatus", () => {
  it("ohne Ziel (null oder 0) nie „erreicht“", () => {
    for (const target of [null, 0]) {
      expect(
        getGoalStatus({
          targetMinutes: target,
          trackedMinutes: 5000,
          remainingPlannedMinutes: 0,
          weekState: "current",
        }),
      ).toBe("unset");
    }
    expect(hasGoalTarget(0)).toBe(false);
    expect(hasGoalTarget(-5)).toBe(false);
    expect(hasGoalTarget(90)).toBe(true);
  });

  it("unterscheidet erreicht und über Ziel (max. 60 Min. bzw. 10 %)", () => {
    const status = (tracked: number, target = 1200) =>
      getGoalStatus({
        targetMinutes: target,
        trackedMinutes: tracked,
        remainingPlannedMinutes: 0,
        weekState: "current",
      });
    expect(status(1200)).toBe("reached");
    expect(status(1319)).toBe("reached");
    expect(status(1320)).toBe("over");
    expect(status(239, 180)).toBe("reached");
    expect(status(240, 180)).toBe("over");
  });

  it("laufende Woche: im Plan oder gefährdet je nach noch eingeplanter Zeit", () => {
    const base = { targetMinutes: 1200, trackedMinutes: 600, weekState: "current" as const };
    expect(getGoalStatus({ ...base, remainingPlannedMinutes: 600 })).toBe("on_track");
    expect(getGoalStatus({ ...base, remainingPlannedMinutes: 599 })).toBe("at_risk");
  });

  it("abgeschlossene Woche: unter Ziel statt gefährdet", () => {
    expect(
      getGoalStatus({
        targetMinutes: 1200,
        trackedMinutes: 1050,
        remainingPlannedMinutes: 0,
        weekState: "past",
      }),
    ).toBe("below");
  });
});

describe("Zielfortschritt und Sätze", () => {
  const entries = [
    block("business", "2026-10-12T15:00:00Z", "2026-10-12T19:00:00Z"),
    block("business", "2026-10-15T15:00:00Z", "2026-10-15T17:00:00Z"),
    block("sport", "2026-10-13T16:00:00Z", "2026-10-13T17:00:00Z"),
  ];
  const sessions = [
    session("business", "2026-10-12T15:10:00Z", "2026-10-12T18:40:00Z"),
    session("sport", "2026-10-13T16:00:00Z", "2026-10-13T18:30:00Z"),
  ];
  const now = new Date("2026-10-14T10:00:00Z");

  it("berechnet Ziel, geplant, erfasst, Differenz und Satz", () => {
    const business = getGoalProgress({
      goal: "business",
      targetMinutes: 1200,
      entries,
      sessions,
      weekStart: KW42,
      now,
    });
    expect(business).toMatchObject({
      label: "Gewerbe",
      targetMinutes: 1200,
      plannedMinutes: 360,
      trackedMinutes: 210,
      remainingPlannedMinutes: 120,
      differenceMinutes: -990,
      missingMinutes: 990,
      status: "at_risk",
      weekState: "current",
    });
    expect(business.sentence).toBe("Dir fehlen noch 16,5 h Gewerbe. Eingeplant sind noch 2 h.");
  });

  it("Laila ohne Ziel und Sport über Ziel", () => {
    const goals = getWeekGoals({
      targets: { business: 1200, sport: 60, relationship: null },
      entries,
      sessions,
      weekStart: KW42,
      now,
    });
    expect(goals.map((g) => g.goal)).toEqual(["business", "sport", "relationship"]);
    expect(goals[1]?.status).toBe("over");
    expect(goals[1]?.sentence).toBe("Sport liegt 1,5 h über dem Wochenziel.");
    expect(goals[2]?.status).toBe("unset");
    expect(goals[2]?.sentence).toBe("Für Laila ist noch kein Wochenziel festgelegt.");
    expect(goals[2]?.trackedRatio).toBe(0);
  });

  it("Sätze für fehlende Planung, ausreichende Planung und abgeschlossene Woche", () => {
    const relationship = getGoalProgress({
      goal: "relationship",
      targetMinutes: 240,
      entries: [],
      sessions: [],
      weekStart: KW42,
      now,
    });
    expect(relationship.sentence).toBe(
      "Dir fehlen noch 4 h für Laila. Dafür ist noch nichts eingeplant.",
    );

    const sportPlanned = getGoalProgress({
      goal: "sport",
      targetMinutes: 60,
      entries: [block("sport", "2026-10-16T16:00:00Z", "2026-10-16T17:00:00Z")],
      sessions: [],
      weekStart: KW42,
      now,
    });
    expect(sportPlanned.sentence).toBe("Sport ist für diese Woche ausreichend eingeplant.");

    const past = getGoalProgress({
      goal: "business",
      targetMinutes: 1200,
      entries,
      sessions: [session("business", "2026-10-12T08:00:00Z", "2026-10-12T23:30:00Z")],
      weekStart: KW42,
      now: new Date("2026-10-20T10:00:00Z"),
    });
    expect(past.status).toBe("below");
    expect(past.remainingPlannedMinutes).toBe(0);
    expect(past.sentence).toBe("Gewerbe: 15,5 h von 20 h erfasst.");
  });

  it("liest Ziele aus der Einstellungszeile (Gewerbe 0 = kein Ziel)", () => {
    expect(
      goalTargetsFromSettings({
        weekly_business_target_minutes: 0,
        weekly_sport_target_minutes: 180,
        weekly_relationship_target_minutes: null,
      }),
    ).toEqual({ business: null, sport: 180, relationship: null });
  });

  it("fasst die Woche in einem Satz zusammen", () => {
    const goals = getWeekGoals({
      targets: { business: 1200, sport: 60, relationship: null },
      entries,
      sessions,
      weekStart: KW42,
      now,
    });
    expect(getWeekSummarySentence(goals)).toBe("1 von 2 Wochenzielen erreicht.");
    expect(getWeekSummarySentence(goals.slice(2))).toBe(
      "Für diese Woche sind noch keine Wochenziele festgelegt.",
    );
  });
});

describe("Anzeigeformate für Zeiterfassung", () => {
  it("formatiert Timer, gesprochene Dauer und Differenzen", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(247_000)).toBe("04:07");
    expect(formatElapsed(3_847_000)).toBe("1:04:07");
    expect(formatElapsed(-5)).toBe("00:00");
    expect(formatDurationSpoken(64)).toBe("1 Stunde 4 Minuten");
    expect(formatDurationSpoken(1)).toBe("1 Minute");
    expect(formatDurationSpoken(120)).toBe("2 Stunden");
    expect(formatSignedHours(90)).toBe("+1,5 h");
    expect(formatSignedHours(-150)).toBe("−2,5 h");
    expect(formatSignedHours(2)).toBe("±0 h");
    expect(formatGoalAmount(45)).toBe("45 Min.");
    expect(formatGoalAmount(150)).toBe("2,5 h");
  });
});

/**
 * Wochenziele: geplante Zeit (Planblöcke) gegenüber erfasster Zeit (Aktivitäten).
 * Reine Funktionen ohne Seiteneffekte – Web und Mobile rechnen damit identisch.
 *
 * Begriffe:
 *  - geplant:          Planblöcke des Ziels, außer „ausgelassen“; Überlappungen zählen einmal
 *  - erfasst:          Aktivitäten des Ziels, auf die Woche zugeschnitten; laufende bis „jetzt“
 *  - noch eingeplant:  geplante Zeit ab „jetzt“
 *  - kein Ziel:        null oder 0 – führt nie zu „erreicht“
 */
import {
  type CompletionStatus,
  type EntryCategory,
  FORGOTTEN_ACTIVITY_MINUTES,
  GOAL_KEYS,
  GOAL_LABELS,
  type GoalKey,
  type GoalStatus,
  MAX_ACTIVITY_DURATION_MINUTES,
  SCHEDULE_TIMEZONE,
} from "./constants";
import { formatHours } from "./format";
import { type LocalDate, getWeekBounds } from "./time";

const MINUTE_MS = 60_000;

/** Minimale Form einer erfassten Aktivität. */
export interface TrackedSession {
  goal_category: GoalKey;
  started_at: string;
  /** `null` = läuft noch. */
  ended_at: string | null;
}

/** Minimale Form eines Planblocks für die Zielberechnung. */
export interface PlannedBlock {
  category: EntryCategory;
  completion_status: CompletionStatus;
  start_at: string;
  end_at: string;
}

export type GoalTargets = Readonly<Record<GoalKey, number | null>>;

export type WeekState = "past" | "current" | "future";

interface Interval {
  start: number;
  end: number;
}

export function isGoalKey(value: unknown): value is GoalKey {
  return typeof value === "string" && (GOAL_KEYS as readonly string[]).includes(value);
}

/** Ziel festgelegt? `null`, 0 und negative Werte bedeuten „kein Ziel“. */
export function hasGoalTarget(target: number | null | undefined): target is number {
  return typeof target === "number" && Number.isFinite(target) && target > 0;
}

/** Summe als Vereinigungsmenge, optional auf [clipStart, clipEnd) zugeschnitten. */
function unionMs(
  intervals: readonly Interval[],
  clipStart = -Infinity,
  clipEnd = Infinity,
): number {
  const clipped = intervals
    .map((i) => ({ start: Math.max(i.start, clipStart), end: Math.min(i.end, clipEnd) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let current: Interval | undefined;
  for (const interval of clipped) {
    if (!current || interval.start > current.end) {
      if (current) total += current.end - current.start;
      current = { ...interval };
    } else if (interval.end > current.end) {
      current.end = interval.end;
    }
  }
  if (current) total += current.end - current.start;
  return total;
}

function toMinutes(ms: number): number {
  return Math.round(ms / MINUTE_MS);
}

/** Zeitraum einer Aktivität; laufende enden bei `now` (nie vor dem Beginn). */
function sessionInterval(session: TrackedSession, now: Date): Interval {
  const start = Date.parse(session.started_at);
  const end = session.ended_at === null ? now.getTime() : Date.parse(session.ended_at);
  return { start, end: Math.max(start, end) };
}

/** Dauer einer Aktivität in Minuten; eine laufende zählt bis `now`. */
export function getSessionMinutes(session: TrackedSession, now: Date): number {
  const { start, end } = sessionInterval(session, now);
  return toMinutes(end - start);
}

/** Laufzeit in Millisekunden – für den sekundengenauen Timer. */
export function getSessionElapsedMs(
  session: Pick<TrackedSession, "started_at">,
  now: Date,
): number {
  return Math.max(0, now.getTime() - Date.parse(session.started_at));
}

export function getRunningSession<T extends TrackedSession>(sessions: readonly T[]): T | undefined {
  return sessions.find((session) => session.ended_at === null);
}

/** Ab 12 Stunden Laufzeit: Hinweis „Vermutlich vergessen – Ende korrigieren“. */
export function isLikelyForgotten(session: TrackedSession, now: Date): boolean {
  return session.ended_at === null && getSessionMinutes(session, now) >= FORGOTTEN_ACTIVITY_MINUTES;
}

/** Über 24 Stunden lässt sich eine Aktivität nur noch über „Zeit korrigieren“ beenden. */
export function requiresCorrectionToStop(session: TrackedSession, now: Date): boolean {
  return (
    session.ended_at === null &&
    getSessionElapsedMs(session, now) > MAX_ACTIVITY_DURATION_MINUTES * MINUTE_MS
  );
}

/** Ob eine Woche abgeschlossen, laufend oder zukünftig ist (Planungszeitzone). */
export function getWeekState(
  weekStart: LocalDate,
  now: Date,
  timeZone: string = SCHEDULE_TIMEZONE,
): WeekState {
  const { start, end } = getWeekBounds(weekStart, timeZone);
  if (now.getTime() >= end.getTime()) return "past";
  if (now.getTime() < start.getTime()) return "future";
  return "current";
}

/**
 * Erfasste Minuten eines Ziels in einer Woche. Aktivitäten über den Wochenwechsel werden
 * an der Grenze (Montag 00:00 Planungszeitzone) geteilt; laufende zählen bis `now`.
 */
export function getTrackedMinutes(
  sessions: readonly TrackedSession[],
  goal: GoalKey,
  weekStart: LocalDate,
  now: Date,
  timeZone: string = SCHEDULE_TIMEZONE,
): number {
  const { start, end } = getWeekBounds(weekStart, timeZone);
  const intervals = sessions
    .filter((session) => session.goal_category === goal)
    .map((session) => sessionInterval(session, now));
  return toMinutes(unionMs(intervals, start.getTime(), end.getTime()));
}

function plannedIntervals(entries: readonly PlannedBlock[], goal: GoalKey): Interval[] {
  return entries
    .filter((entry) => entry.category === goal && entry.completion_status !== "skipped")
    .map((entry) => ({ start: Date.parse(entry.start_at), end: Date.parse(entry.end_at) }));
}

/** Geplante Minuten eines Ziels (Planblöcke außer „ausgelassen“, Überlappung einmal). */
export function getPlannedMinutes(entries: readonly PlannedBlock[], goal: GoalKey): number {
  return toMinutes(unionMs(plannedIntervals(entries, goal)));
}

/** Geplante Minuten ab `now` – „noch eingeplant“. */
export function getRemainingPlannedMinutes(
  entries: readonly PlannedBlock[],
  goal: GoalKey,
  now: Date,
): number {
  return toMinutes(unionMs(plannedIntervals(entries, goal), now.getTime()));
}

/** Abstand, ab dem „Über Ziel“ statt „Erreicht“ gilt: 60 Minuten bzw. 10 % des Ziels. */
export function overTargetThresholdMinutes(targetMinutes: number): number {
  return Math.max(60, Math.round(targetMinutes * 0.1));
}

export function getGoalStatus(input: {
  targetMinutes: number | null;
  trackedMinutes: number;
  remainingPlannedMinutes: number;
  weekState: WeekState;
}): GoalStatus {
  const { targetMinutes, trackedMinutes, remainingPlannedMinutes, weekState } = input;
  if (!hasGoalTarget(targetMinutes)) return "unset";
  if (trackedMinutes >= targetMinutes + overTargetThresholdMinutes(targetMinutes)) return "over";
  if (trackedMinutes >= targetMinutes) return "reached";
  if (weekState === "past") return "below";
  return trackedMinutes + remainingPlannedMinutes >= targetMinutes ? "on_track" : "at_risk";
}

export interface GoalProgress {
  goal: GoalKey;
  label: string;
  /** `null` = kein Ziel festgelegt. */
  targetMinutes: number | null;
  plannedMinutes: number;
  trackedMinutes: number;
  remainingPlannedMinutes: number;
  /** erfasst − Ziel; `null` ohne Ziel. */
  differenceMinutes: number | null;
  /** Bis zum Ziel fehlende erfasste Minuten (nie negativ); `null` ohne Ziel. */
  missingMinutes: number | null;
  /** Anteile für Balken (0…n); ohne Ziel 0. */
  plannedRatio: number;
  trackedRatio: number;
  status: GoalStatus;
  weekState: WeekState;
  /** Sachlicher Satz für die Oberfläche. */
  sentence: string;
}

/** „45 Min.“ unter einer Stunde, sonst „1,5 h“. */
export function formatGoalAmount(minutes: number): string {
  const value = Math.max(0, Math.round(minutes));
  return value < 60 ? `${value} Min.` : formatHours(value);
}

/** Wortlaut für „Dir fehlen noch … “ je Ziel. */
const MISSING_PHRASE: Readonly<Record<GoalKey, string>> = {
  business: "Gewerbe",
  sport: "Sport",
  relationship: "für Laila",
};

export function getGoalSentence(
  progress: Omit<GoalProgress, "sentence" | "label"> & { label?: string },
): string {
  const label = progress.label ?? GOAL_LABELS[progress.goal];
  const target = progress.targetMinutes;
  switch (progress.status) {
    case "unset":
      return `Für ${label} ist noch kein Wochenziel festgelegt.`;
    case "over":
      return `${label} liegt ${formatGoalAmount(progress.differenceMinutes ?? 0)} über dem Wochenziel.`;
    case "reached":
      return `${label}-Ziel erreicht.`;
    case "below":
      return `${label}: ${formatGoalAmount(progress.trackedMinutes)} von ${formatGoalAmount(target ?? 0)} erfasst.`;
    case "on_track":
      return `${label} ist für diese Woche ausreichend eingeplant.`;
    case "at_risk": {
      const missing = `Dir fehlen noch ${formatGoalAmount(progress.missingMinutes ?? 0)} ${MISSING_PHRASE[progress.goal]}.`;
      return progress.remainingPlannedMinutes > 0
        ? `${missing} Eingeplant sind noch ${formatGoalAmount(progress.remainingPlannedMinutes)}.`
        : `${missing} Dafür ist noch nichts eingeplant.`;
    }
  }
}

export function getGoalProgress(input: {
  goal: GoalKey;
  targetMinutes: number | null;
  entries: readonly PlannedBlock[];
  sessions: readonly TrackedSession[];
  weekStart: LocalDate;
  now: Date;
  timeZone?: string;
}): GoalProgress {
  const timeZone = input.timeZone ?? SCHEDULE_TIMEZONE;
  const weekState = getWeekState(input.weekStart, input.now, timeZone);
  const target = hasGoalTarget(input.targetMinutes) ? input.targetMinutes : null;
  const plannedMinutes = getPlannedMinutes(input.entries, input.goal);
  const trackedMinutes = getTrackedMinutes(
    input.sessions,
    input.goal,
    input.weekStart,
    input.now,
    timeZone,
  );
  const remainingPlannedMinutes =
    weekState === "past" ? 0 : getRemainingPlannedMinutes(input.entries, input.goal, input.now);
  const status = getGoalStatus({
    targetMinutes: target,
    trackedMinutes,
    remainingPlannedMinutes,
    weekState,
  });
  const base = {
    goal: input.goal,
    label: GOAL_LABELS[input.goal],
    targetMinutes: target,
    plannedMinutes,
    trackedMinutes,
    remainingPlannedMinutes,
    differenceMinutes: target === null ? null : trackedMinutes - target,
    missingMinutes: target === null ? null : Math.max(0, target - trackedMinutes),
    plannedRatio: target === null ? 0 : plannedMinutes / target,
    trackedRatio: target === null ? 0 : trackedMinutes / target,
    status,
    weekState,
  };
  return { ...base, sentence: getGoalSentence(base) };
}

/** Alle drei Ziele einer Woche in fester Reihenfolge (Gewerbe, Sport, Laila). */
export function getWeekGoals(input: {
  targets: GoalTargets;
  entries: readonly PlannedBlock[];
  sessions: readonly TrackedSession[];
  weekStart: LocalDate;
  now: Date;
  timeZone?: string;
}): GoalProgress[] {
  return GOAL_KEYS.map((goal) =>
    getGoalProgress({
      goal,
      targetMinutes: input.targets[goal],
      entries: input.entries,
      sessions: input.sessions,
      weekStart: input.weekStart,
      now: input.now,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    }),
  );
}

/**
 * Ziele aus einer Einstellungszeile. Gewerbe: 0 = kein Ziel (Spalte ist NOT NULL);
 * Sport/Laila: `null` = kein Ziel.
 */
export function goalTargetsFromSettings(settings: {
  weekly_business_target_minutes: number;
  weekly_sport_target_minutes: number | null;
  weekly_relationship_target_minutes: number | null;
}): GoalTargets {
  return {
    business: hasGoalTarget(settings.weekly_business_target_minutes)
      ? settings.weekly_business_target_minutes
      : null,
    sport: hasGoalTarget(settings.weekly_sport_target_minutes)
      ? settings.weekly_sport_target_minutes
      : null,
    relationship: hasGoalTarget(settings.weekly_relationship_target_minutes)
      ? settings.weekly_relationship_target_minutes
      : null,
  };
}

/** Kurzer Kernsatz für Wochenbilanz und Übersicht. */
export function getWeekSummarySentence(goals: readonly GoalProgress[]): string {
  const withTarget = goals.filter((goal) => goal.status !== "unset");
  if (withTarget.length === 0) return "Für diese Woche sind noch keine Wochenziele festgelegt.";
  const done = withTarget.filter((goal) => goal.status === "reached" || goal.status === "over");
  if (done.length === withTarget.length) {
    return withTarget.length === 1
      ? "Das Wochenziel ist erreicht."
      : "Alle festgelegten Wochenziele sind erreicht.";
  }
  return `${done.length} von ${withTarget.length} Wochenzielen erreicht.`;
}

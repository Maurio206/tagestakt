/**
 * Aktivitätsverlauf für den Planungsassistenten: geplante gegenüber tatsächlich erfasster Zeit
 * über mehrere Wochen – nur Summen und Muster, keine Titel, Notizen, Orte oder IDs. Reine
 * Funktionen in der Planungszeitzone (Sommer-/Winterzeit, Mitternacht, Wochenwechsel).
 *
 * Begriffe:
 *  - geplant:    Planblöcke des Ziels in der veröffentlichten Version, außer „ausgelassen“, bis jetzt
 *  - erfasst:    Aktivitäten des Ziels; laufende bis jetzt, höchstens 24 Stunden
 *  - im Plan:    erfasste Zeit innerhalb geplanter Blöcke desselben Ziels; sonst „ohne Plan“
 *  - umgesetzt:  vergangener Planblock, als erledigt markiert oder mindestens zur Hälfte erfasst
 */
import {
  type CompletionStatus,
  type EntryCategory,
  GOAL_KEYS,
  type GoalKey,
  MAX_ACTIVITY_DURATION_MINUTES,
  SCHEDULE_TIMEZONE,
  WEEKDAY_SHORT_LABELS,
} from "./constants";
import { type TrackedSession, formatGoalAmount } from "./goals";
import { PLANNER_NEUTRAL_KIND_LABELS } from "./planner";
import {
  type LocalDate,
  addDays,
  getWeekBounds,
  getWeekStart,
  isoWeekdayOfLocalDate,
  toLocalDate,
  zonedDateTimeToInstant,
} from "./time";

export const ACTIVITY_HISTORY_DEFAULT_WEEKS = 8;
export const ACTIVITY_HISTORY_MAX_WEEKS = 12;
/** Ein vergangener Planblock gilt ab diesem erfassten Anteil als umgesetzt. */
export const FOLLOW_THROUGH_MIN_SHARE = 0.5;
/** Zeitfenster für Muster nach Wochentag und Tageszeit (volle Stunden, Planungszeitzone). */
export const ACTIVITY_TIME_BANDS = [
  { key: "00-05", from: 0, to: 5 },
  { key: "05-09", from: 5, to: 9 },
  { key: "09-12", from: 9, to: 12 },
  { key: "12-17", from: 12, to: 17 },
  { key: "17-21", from: 17, to: 21 },
  { key: "21-24", from: 21, to: 24 },
] as const;
export type ActivityTimeBand = (typeof ACTIVITY_TIME_BANDS)[number]["key"];

/** Vergleichbare Zellen brauchen mindestens so viele vergangene Planblöcke. */
const MIN_BLOCKS_FOR_RELIABILITY = 2;
const MAX_RELIABILITY_LINES = 3;
const MINUTE_MS = 60_000;

/** Planblock der veröffentlichten Version (nur Zeiten, Art und Erledigt-Status). */
export interface HistoryPlanBlock {
  category: EntryCategory;
  completion_status: CompletionStatus;
  start_at: string;
  end_at: string;
}

export interface HistoryWeekInput {
  weekStart: LocalDate;
  /** Einträge der veröffentlichten Version; `null` = für die Woche wurde nichts veröffentlicht. */
  published: readonly HistoryPlanBlock[] | null;
}

export interface GoalWeekHistory {
  plannedMinutes: number;
  trackedMinutes: number;
  trackedInPlanMinutes: number;
  trackedWithoutPlanMinutes: number;
  /** Vergangene Planblöcke: umgesetzt, ausgelassen oder verpasst. */
  blocks: { finished: number; followed: number; skipped: number; missed: number };
}

export interface WeekHistory {
  weekStart: LocalDate;
  state: "past" | "current";
  publishedPlan: boolean;
  goals: Record<GoalKey, GoalWeekHistory>;
}

export interface SlotPattern {
  weekday: string;
  band: ActivityTimeBand;
  trackedMinutes: number;
  /** In wie vielen Wochen hier überhaupt etwas erfasst wurde. */
  weeksWithTracking: number;
  plannedBlocks: number;
  followedBlocks: number;
}

export interface DurationStats {
  count: number;
  medianMinutes: number;
  p25Minutes: number;
  p75Minutes: number;
}

export interface GoalPattern {
  kind: string;
  trackedMinutes: number;
  /** Durchschnitt je abgeschlossener Woche (ohne abgeschlossene Wochen: über alle). */
  averageTrackedMinutesPerWeek: number;
  averagePlannedMinutesPerWeek: number;
  /** Umgesetzte Anteile vergangener Planblöcke (0–1); `null` ohne vergangene Blöcke. */
  followThroughRate: number | null;
  slots: SlotPattern[];
  mostReliable: string[];
  leastReliable: string[];
  mostTracked: string[];
  sessionLength: DurationStats | null;
  plannedBlockLength: DurationStats | null;
}

export interface ActivityHistory {
  timezone: string;
  from: LocalDate;
  to: LocalDate;
  includesCurrentWeek: boolean;
  definitions: string[];
  weeks: WeekHistory[];
  patterns: Record<GoalKey, GoalPattern>;
  summary: string[];
}

interface Interval {
  start: number;
  end: number;
}

/** Vereinigung, sortiert und ohne Überlappung. */
function union(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function clip(intervals: readonly Interval[], from: number, to: number): Interval[] {
  return union(
    intervals.map((i) => ({ start: Math.max(i.start, from), end: Math.min(i.end, to) })),
  );
}

/** Schnittmenge zweier Vereinigungen. */
function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) result.push({ start, end });
    }
  }
  return union(result);
}

function totalMs(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}

const toMinutes = (ms: number) => Math.round(ms / MINUTE_MS);

/** Zeitraum einer Aktivität: laufende bis `now`, höchstens 24 Stunden; nie nach `now`. */
function sessionInterval(session: TrackedSession, now: number): Interval {
  const start = Date.parse(session.started_at);
  const end =
    session.ended_at === null
      ? Math.min(now, start + MAX_ACTIVITY_DURATION_MINUTES * MINUTE_MS)
      : Date.parse(session.ended_at);
  return { start, end: Math.max(start, Math.min(end, now)) };
}

function blockInterval(block: HistoryPlanBlock): Interval {
  return { start: Date.parse(block.start_at), end: Date.parse(block.end_at) };
}

function bandInstant(date: LocalDate, hour: number, timeZone: string): number {
  return hour === 24
    ? zonedDateTimeToInstant(addDays(date, 1), "00:00", timeZone).getTime()
    : zonedDateTimeToInstant(date, `${String(hour).padStart(2, "0")}:00`, timeZone).getTime();
}

function bandOf(instant: number, timeZone: string): ActivityTimeBand {
  const date = toLocalDate(new Date(instant), timeZone);
  const band = ACTIVITY_TIME_BANDS.find(
    (b) =>
      instant >= bandInstant(date, b.from, timeZone) && instant < bandInstant(date, b.to, timeZone),
  );
  // Die Fenster decken den Tag lückenlos ab (auch an Tagen mit 23 oder 25 Stunden).
  return (band ?? ACTIVITY_TIME_BANDS[0]).key;
}

/** Zerlegt einen Zeitraum in Abschnitte je Kalendertag und Zeitfenster (Planungszeitzone). */
export function splitByDayAndBand(
  interval: { start: Date; end: Date },
  timeZone: string = SCHEDULE_TIMEZONE,
): { date: LocalDate; band: ActivityTimeBand; minutes: number }[] {
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  if (end <= start) return [];
  const parts: { date: LocalDate; band: ActivityTimeBand; minutes: number }[] = [];
  const last = toLocalDate(new Date(end - 1), timeZone);
  for (let date = toLocalDate(interval.start, timeZone); date <= last; date = addDays(date, 1)) {
    for (const band of ACTIVITY_TIME_BANDS) {
      const from = Math.max(start, bandInstant(date, band.from, timeZone));
      const to = Math.min(end, bandInstant(date, band.to, timeZone));
      if (to > from) parts.push({ date, band: band.key, minutes: (to - from) / MINUTE_MS });
    }
  }
  return parts;
}

/**
 * Wochen des Verlaufs, älteste zuerst: die `weeks` abgeschlossenen Wochen vor der laufenden,
 * auf Wunsch zusätzlich die laufende Woche (bis jetzt).
 */
export function activityHistoryWeekStarts(
  now: Date,
  weeks: number = ACTIVITY_HISTORY_DEFAULT_WEEKS,
  includeCurrentWeek = true,
  timeZone: string = SCHEDULE_TIMEZONE,
): LocalDate[] {
  const count = Math.min(ACTIVITY_HISTORY_MAX_WEEKS, Math.max(1, Math.trunc(weeks)));
  const current = getWeekStart(now, timeZone);
  const starts = Array.from({ length: count }, (_, i) => addDays(current, -7 * (count - i)));
  return includeCurrentWeek ? [...starts, current] : starts;
}

/** Quantil mit linearer Interpolation (sortierte Werte). */
function quantile(sorted: readonly number[], p: number): number {
  const position = p * (sorted.length - 1);
  const lower = sorted[Math.floor(position)] ?? 0;
  const upper = sorted[Math.ceil(position)] ?? lower;
  return lower + (upper - lower) * (position - Math.floor(position));
}

function durationStats(minutes: readonly number[]): DurationStats | null {
  const sorted = minutes.filter((m) => m > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    count: sorted.length,
    medianMinutes: Math.round(quantile(sorted, 0.5)),
    p25Minutes: Math.round(quantile(sorted, 0.25)),
    p75Minutes: Math.round(quantile(sorted, 0.75)),
  };
}

const bandLabel = (band: ActivityTimeBand) => `${band.replace("-", "–")} Uhr`;
const percent = (rate: number) => `${Math.round(rate * 100)} %`;

/** Verlauf aus veröffentlichten Plänen und erfassten Aktivitäten (bereits auf den Eigentümer beschränkt). */
export function buildActivityHistory(input: {
  now: Date;
  weeks: readonly HistoryWeekInput[];
  sessions: readonly TrackedSession[];
  timeZone?: string;
}): ActivityHistory {
  const timeZone = input.timeZone ?? SCHEDULE_TIMEZONE;
  const now = input.now.getTime();
  const weeks = [...input.weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const first = weeks[0];
  const lastWeek = weeks.at(-1);
  if (!first || !lastWeek) throw new Error("Mindestens eine Woche erwartet.");
  const rangeStart = getWeekBounds(first.weekStart, timeZone).start.getTime();
  const rangeEnd = Math.min(getWeekBounds(lastWeek.weekStart, timeZone).end.getTime(), now);

  const sessionsOf = (goal: GoalKey) =>
    union(
      input.sessions.filter((s) => s.goal_category === goal).map((s) => sessionInterval(s, now)),
    );
  const tracked = Object.fromEntries(GOAL_KEYS.map((g) => [g, sessionsOf(g)])) as Record<
    GoalKey,
    Interval[]
  >;

  type Cell = { tracked: number; weeks: Set<LocalDate>; planned: number; followed: number };
  const cells = Object.fromEntries(GOAL_KEYS.map((g) => [g, new Map<string, Cell>()])) as Record<
    GoalKey,
    Map<string, Cell>
  >;
  const cell = (goal: GoalKey, weekday: string, band: ActivityTimeBand): Cell => {
    const key = `${weekday}|${band}`;
    const existing = cells[goal].get(key);
    if (existing) return existing;
    const created: Cell = { tracked: 0, weeks: new Set(), planned: 0, followed: 0 };
    cells[goal].set(key, created);
    return created;
  };
  const plannedLengths = Object.fromEntries(GOAL_KEYS.map((g) => [g, [] as number[]])) as Record<
    GoalKey,
    number[]
  >;

  const weekHistories = weeks.map((week): WeekHistory => {
    const bounds = getWeekBounds(week.weekStart, timeZone);
    const from = bounds.start.getTime();
    const until = Math.min(bounds.end.getTime(), now);
    const goals = Object.fromEntries(
      GOAL_KEYS.map((goal): [GoalKey, GoalWeekHistory] => {
        const blocks = (week.published ?? []).filter((b) => b.category === goal);
        const planned = clip(
          blocks.filter((b) => b.completion_status !== "skipped").map(blockInterval),
          from,
          until,
        );
        const inWeek = clip(tracked[goal], from, until);
        const inPlan = intersect(inWeek, planned);
        const counts = { finished: 0, followed: 0, skipped: 0, missed: 0 };
        for (const block of blocks) {
          const interval = blockInterval(block);
          if (interval.end > now || interval.end <= interval.start) continue;
          const overlap = totalMs(intersect(tracked[goal], [interval]));
          const followed =
            block.completion_status === "completed" ||
            overlap >= FOLLOW_THROUGH_MIN_SHARE * (interval.end - interval.start);
          counts.finished += 1;
          if (followed) counts.followed += 1;
          else if (block.completion_status === "skipped") counts.skipped += 1;
          else counts.missed += 1;
          const weekday =
            WEEKDAY_SHORT_LABELS[
              isoWeekdayOfLocalDate(toLocalDate(new Date(interval.start), timeZone))
            ];
          const target = cell(goal, weekday, bandOf(interval.start, timeZone));
          target.planned += 1;
          if (followed) target.followed += 1;
          if (block.completion_status !== "skipped") {
            plannedLengths[goal].push((interval.end - interval.start) / MINUTE_MS);
          }
        }
        for (const part of inWeek.flatMap((i) =>
          splitByDayAndBand({ start: new Date(i.start), end: new Date(i.end) }, timeZone),
        )) {
          const target = cell(
            goal,
            WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(part.date)],
            part.band,
          );
          target.tracked += part.minutes;
          target.weeks.add(week.weekStart);
        }
        const trackedMinutes = toMinutes(totalMs(inWeek));
        const trackedInPlanMinutes = toMinutes(totalMs(inPlan));
        return [
          goal,
          {
            plannedMinutes: toMinutes(totalMs(planned)),
            trackedMinutes,
            trackedInPlanMinutes,
            trackedWithoutPlanMinutes: Math.max(0, trackedMinutes - trackedInPlanMinutes),
            blocks: counts,
          },
        ];
      }),
    ) as Record<GoalKey, GoalWeekHistory>;
    return {
      weekStart: week.weekStart,
      state: bounds.end.getTime() <= now ? "past" : "current",
      publishedPlan: week.published !== null,
      goals,
    };
  });

  const completed = weekHistories.filter((w) => w.state === "past");
  const basis = completed.length > 0 ? completed : weekHistories;
  const patterns = Object.fromEntries(
    GOAL_KEYS.map((goal): [GoalKey, GoalPattern] => {
      const kind = PLANNER_NEUTRAL_KIND_LABELS[goal];
      const slots = [...cells[goal].entries()]
        .map(([key, c]): SlotPattern => {
          const [weekday, band] = key.split("|") as [string, ActivityTimeBand];
          return {
            weekday,
            band,
            trackedMinutes: Math.round(c.tracked),
            weeksWithTracking: c.weeks.size,
            plannedBlocks: c.planned,
            followedBlocks: c.followed,
          };
        })
        .filter((s) => s.trackedMinutes > 0 || s.plannedBlocks > 0)
        .sort(
          (a, b) =>
            weekdayIndex(a.weekday) - weekdayIndex(b.weekday) ||
            bandIndex(a.band) - bandIndex(b.band),
        );
      const comparable = slots.filter((s) => s.plannedBlocks >= MIN_BLOCKS_FOR_RELIABILITY);
      const rate = (s: SlotPattern) => s.followedBlocks / s.plannedBlocks;
      const reliability = (s: SlotPattern) =>
        `${s.weekday} ${bandLabel(s.band)}: ${s.followedBlocks} von ${s.plannedBlocks} geplanten Blöcken umgesetzt`;
      const finished = weekHistories.reduce((sum, w) => sum + w.goals[goal].blocks.finished, 0);
      const followed = weekHistories.reduce((sum, w) => sum + w.goals[goal].blocks.followed, 0);
      const sessionLengths = clip(tracked[goal], rangeStart, rangeEnd).map(
        (i) => (i.end - i.start) / MINUTE_MS,
      );
      const average = (pick: (g: GoalWeekHistory) => number) =>
        Math.round(basis.reduce((sum, w) => sum + pick(w.goals[goal]), 0) / basis.length);
      return [
        goal,
        {
          kind,
          trackedMinutes: weekHistories.reduce((sum, w) => sum + w.goals[goal].trackedMinutes, 0),
          averageTrackedMinutesPerWeek: average((g) => g.trackedMinutes),
          averagePlannedMinutesPerWeek: average((g) => g.plannedMinutes),
          followThroughRate: finished > 0 ? followed / finished : null,
          slots,
          mostReliable: comparable
            .filter((s) => rate(s) >= 0.75)
            .sort((a, b) => rate(b) - rate(a) || b.plannedBlocks - a.plannedBlocks)
            .slice(0, MAX_RELIABILITY_LINES)
            .map(reliability),
          leastReliable: comparable
            .filter((s) => rate(s) <= 0.5)
            .sort((a, b) => rate(a) - rate(b) || b.plannedBlocks - a.plannedBlocks)
            .slice(0, MAX_RELIABILITY_LINES)
            .map(reliability),
          mostTracked: slots
            .filter((s) => s.trackedMinutes > 0)
            .sort(
              (a, b) =>
                b.trackedMinutes - a.trackedMinutes || b.weeksWithTracking - a.weeksWithTracking,
            )
            .slice(0, MAX_RELIABILITY_LINES)
            .map(
              (s) =>
                `${s.weekday} ${bandLabel(s.band)}: ${formatGoalAmount(s.trackedMinutes)} erfasst (in ${s.weeksWithTracking} von ${weekHistories.length} Wochen)`,
            ),
          sessionLength: durationStats(sessionLengths),
          plannedBlockLength: durationStats(plannedLengths[goal]),
        },
      ];
    }),
  ) as Record<GoalKey, GoalPattern>;

  const summary = GOAL_KEYS.map((goal) => {
    const p = patterns[goal];
    const withoutPlan = weekHistories.reduce(
      (sum, w) => sum + w.goals[goal].trackedWithoutPlanMinutes,
      0,
    );
    const parts = [
      `Ø ${formatGoalAmount(p.averageTrackedMinutesPerWeek)} erfasst je Woche (geplant Ø ${formatGoalAmount(p.averagePlannedMinutesPerWeek)})`,
      p.followThroughRate === null
        ? "keine vergangenen Planblöcke"
        : `${percent(p.followThroughRate)} der geplanten Blöcke umgesetzt`,
      `${formatGoalAmount(withoutPlan)} ohne Plan`,
    ];
    if (p.sessionLength)
      parts.push(`typische Einheit ${formatGoalAmount(p.sessionLength.medianMinutes)}`);
    const line = `${p.kind}: ${parts.join(", ")}`;
    // „45 Min.“ endet schon mit einem Punkt.
    return line.endsWith(".") ? line : `${line}.`;
  });
  const withoutPublished = weekHistories.filter((w) => !w.publishedPlan).map((w) => w.weekStart);
  if (withoutPublished.length > 0) {
    summary.push(`Ohne veröffentlichten Plan (nur erfasste Zeit): ${withoutPublished.join(", ")}.`);
  }

  return {
    timezone: timeZone,
    from: first.weekStart,
    to: toLocalDate(new Date(rangeEnd - 1), timeZone),
    includesCurrentWeek: weekHistories.some((w) => w.state === "current"),
    definitions: [
      "geplant: Planblöcke der veröffentlichten Version außer „ausgelassen“, bis jetzt",
      "erfasst: tatsächlich erfasste Aktivitäten; laufende bis jetzt, höchstens 24 Std.",
      "im Plan: erfasste Zeit innerhalb geplanter Blöcke desselben Ziels; sonst „ohne Plan“",
      `umgesetzt: vergangener Planblock, als erledigt markiert oder mindestens zu ${percent(FOLLOW_THROUGH_MIN_SHARE)} erfasst; verpasst: weder umgesetzt noch ausgelassen`,
      "Muster nach Wochentag und Zeitfenster (Europe/Berlin); Planblöcke zählen beim Zeitfenster ihres Beginns",
    ],
    weeks: weekHistories,
    patterns,
    summary,
  };
}

const WEEKDAY_ORDER = Object.values(WEEKDAY_SHORT_LABELS);
const weekdayIndex = (label: string) => WEEKDAY_ORDER.indexOf(label);
const bandIndex = (band: ActivityTimeBand) => ACTIVITY_TIME_BANDS.findIndex((b) => b.key === band);

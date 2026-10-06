/** Fachliche Auswertungen über Wochenplan-Einträge. Reine Funktionen ohne Seiteneffekte. */
import {
  type CompletionStatus,
  type EntryCategory,
  type IsoWeekday,
  MAX_ENTRY_DURATION_MINUTES,
  SCHEDULE_TIMEZONE,
} from "./constants";
import {
  type LocalDate,
  type TimeOfDay,
  addDays,
  getDayBounds,
  getWeekBounds,
  getWeekDays,
  minutesBetween,
  parseTimeOfDay,
  toLocalDate,
  zonedDateTimeToInstant,
} from "./time";

/** Minimale Form eines Zeitblocks; alle Eintragstypen erfüllen sie. */
export interface TimedBlock {
  start_at: string;
  end_at: string;
}

export interface IdentifiedBlock extends TimedBlock {
  id: string;
}

export interface CategorizedBlock extends TimedBlock {
  category: EntryCategory;
  completion_status: CompletionStatus;
}

export type EntryTimeState = "past" | "current" | "future";

function startMs(block: TimedBlock): number {
  return Date.parse(block.start_at);
}

function endMs(block: TimedBlock): number {
  return Date.parse(block.end_at);
}

/** Sortiert chronologisch nach Beginn, bei Gleichstand nach Ende. Gibt eine Kopie zurück. */
export function sortEntries<T extends TimedBlock>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => startMs(a) - startMs(b) || endMs(a) - endMs(b));
}

/**
 * Ein Eintrag gehört zu der Woche, in der er beginnt. Er darf über Sonntag 24:00
 * hinausragen (z. B. Schlaf), aber höchstens 24 Stunden dauern.
 */
export function isEntryWithinWeek(
  entry: TimedBlock,
  weekStart: LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): boolean {
  const { start, end } = getWeekBounds(weekStart, timeZone);
  const entryStart = startMs(entry);
  const entryEnd = endMs(entry);
  return (
    entryStart >= start.getTime() &&
    entryStart < end.getTime() &&
    entryEnd > entryStart &&
    entryEnd - entryStart <= MAX_ENTRY_DURATION_MINUTES * 60_000
  );
}

export function blocksOverlap(a: TimedBlock, b: TimedBlock): boolean {
  return startMs(a) < endMs(b) && startMs(b) < endMs(a);
}

export interface Overlap<T> {
  first: T;
  second: T;
  overlapMinutes: number;
}

/**
 * Findet alle Paare sich überschneidender Einträge. Aneinandergrenzende Blöcke
 * (Ende = Beginn des nächsten) gelten nicht als Überschneidung.
 */
export function detectOverlaps<T extends TimedBlock>(entries: readonly T[]): Overlap<T>[] {
  const sorted = sortEntries(entries);
  const overlaps: Overlap<T>[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const first = sorted[i];
    if (!first) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const second = sorted[j];
      if (!second) continue;
      // Sortiert nach Beginn: sobald ein späterer Block nach dem Ende beginnt, ist Schluss.
      if (startMs(second) >= endMs(first)) break;
      const overlapStart = Math.max(startMs(first), startMs(second));
      const overlapEnd = Math.min(endMs(first), endMs(second));
      overlaps.push({
        first,
        second,
        overlapMinutes: Math.round((overlapEnd - overlapStart) / 60_000),
      });
    }
  }
  return overlaps;
}

/** IDs aller Einträge, die an mindestens einer Überschneidung beteiligt sind. */
export function overlappingEntryIds<T extends IdentifiedBlock>(entries: readonly T[]): Set<string> {
  const ids = new Set<string>();
  for (const overlap of detectOverlaps(entries)) {
    ids.add(overlap.first.id);
    ids.add(overlap.second.id);
  }
  return ids;
}

/** Summe der Minuten als Vereinigungsmenge – überlappende Blöcke zählen nicht doppelt. */
function unionMinutes(blocks: readonly TimedBlock[]): number {
  let total = 0;
  let currentStart = Number.NaN;
  let currentEnd = Number.NaN;
  for (const block of sortEntries(blocks)) {
    const s = startMs(block);
    const e = endMs(block);
    if (e <= s) continue;
    if (Number.isNaN(currentEnd) || s > currentEnd) {
      if (!Number.isNaN(currentEnd)) total += currentEnd - currentStart;
      currentStart = s;
      currentEnd = e;
    } else if (e > currentEnd) {
      currentEnd = e;
    }
  }
  if (!Number.isNaN(currentEnd)) total += currentEnd - currentStart;
  return Math.round(total / 60_000);
}

/** Geplante Gewerbeminuten: alle Gewerbe-Blöcke, die nicht als ausgelassen markiert sind. */
export function plannedBusinessMinutes(entries: readonly CategorizedBlock[]): number {
  return unionMinutes(
    entries.filter((e) => e.category === "business" && e.completion_status !== "skipped"),
  );
}

/** Absolvierte Gewerbeminuten: nur ausdrücklich als erledigt markierte Gewerbe-Blöcke. */
export function completedBusinessMinutes(entries: readonly CategorizedBlock[]): number {
  return unionMinutes(
    entries.filter((e) => e.category === "business" && e.completion_status === "completed"),
  );
}

export interface BusinessProgress {
  targetMinutes: number;
  plannedMinutes: number;
  completedMinutes: number;
  /** Anteil geplant/Ziel, 0…n (kann über 1 liegen). */
  plannedRatio: number;
  completedRatio: number;
  /** Noch zu planende Minuten bis zum Ziel (nie negativ). */
  missingPlannedMinutes: number;
}

export function getBusinessProgress(
  entries: readonly CategorizedBlock[],
  targetMinutes: number,
): BusinessProgress {
  const plannedMinutes = plannedBusinessMinutes(entries);
  const completedMinutes = completedBusinessMinutes(entries);
  const safeTarget = Math.max(0, targetMinutes);
  return {
    targetMinutes: safeTarget,
    plannedMinutes,
    completedMinutes,
    plannedRatio: safeTarget === 0 ? 1 : plannedMinutes / safeTarget,
    completedRatio: safeTarget === 0 ? 1 : completedMinutes / safeTarget,
    missingPlannedMinutes: Math.max(0, safeTarget - plannedMinutes),
  };
}

export function getEntryTimeState(entry: TimedBlock, now: Date): EntryTimeState {
  const t = now.getTime();
  if (endMs(entry) <= t) return "past";
  if (startMs(entry) <= t) return "current";
  return "future";
}

/**
 * Aktuell laufender Eintrag. Bei Überschneidung gewinnt der zuletzt begonnene
 * (meist der spezifischere Block), bei Gleichstand der früher endende.
 */
export function getCurrentEntry<T extends TimedBlock>(
  entries: readonly T[],
  now: Date,
): T | undefined {
  const t = now.getTime();
  let best: T | undefined;
  for (const entry of entries) {
    if (startMs(entry) <= t && t < endMs(entry)) {
      if (
        !best ||
        startMs(entry) > startMs(best) ||
        (startMs(entry) === startMs(best) && endMs(entry) < endMs(best))
      ) {
        best = entry;
      }
    }
  }
  return best;
}

/** Nächster Eintrag, der nach `now` beginnt. */
export function getNextEntry<T extends TimedBlock>(
  entries: readonly T[],
  now: Date,
): T | undefined {
  const t = now.getTime();
  return sortEntries(entries).find((entry) => startMs(entry) > t);
}

export function getRemainingMinutes(entry: TimedBlock, now: Date): number {
  return Math.max(0, Math.ceil((endMs(entry) - now.getTime()) / 60_000));
}

export function getEntryDurationMinutes(entry: TimedBlock): number {
  return minutesBetween(new Date(entry.start_at), new Date(entry.end_at));
}

/** Anteil 0…1, wie weit der laufende Block fortgeschritten ist. */
export function getEntryProgress(entry: TimedBlock, now: Date): number {
  const total = endMs(entry) - startMs(entry);
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - startMs(entry)) / total));
}

export interface DayGroup<T> {
  date: LocalDate;
  entries: T[];
}

/** Gruppiert Einträge nach Kalendertag ihres Beginns (Mo–So). */
export function groupEntriesByDay<T extends TimedBlock>(
  entries: readonly T[],
  weekStart: LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): DayGroup<T>[] {
  const groups = getWeekDays(weekStart).map((date) => ({ date, entries: [] as T[] }));
  for (const entry of sortEntries(entries)) {
    const date = toLocalDate(new Date(entry.start_at), timeZone);
    groups.find((group) => group.date === date)?.entries.push(entry);
  }
  return groups;
}

/** Alle Einträge, die einen Kalendertag berühren – auch solche, die am Vortag begonnen haben. */
export function getEntriesForDay<T extends TimedBlock>(
  entries: readonly T[],
  date: LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): T[] {
  const { start, end } = getDayBounds(date, timeZone);
  return sortEntries(
    entries.filter((e) => startMs(e) < end.getTime() && endMs(e) > start.getTime()),
  );
}

/** Berechnet Beginn und Ende aus Datum, Uhrzeiten und „endet am Folgetag“. */
export function resolveTimeRange(
  date: LocalDate,
  startTime: TimeOfDay,
  endTime: TimeOfDay,
  endsNextDay: boolean,
  timeZone: string = SCHEDULE_TIMEZONE,
): { start: Date; end: Date } {
  const start = zonedDateTimeToInstant(date, startTime, timeZone);
  const end = zonedDateTimeToInstant(endsNextDay ? addDays(date, 1) : date, endTime, timeZone);
  return { start, end };
}

export interface RecurringTemplate {
  id: string;
  title: string;
  category: EntryCategory;
  weekday: IsoWeekday;
  start_time: TimeOfDay;
  end_time: TimeOfDay;
  location: string | null;
  note: string | null;
  active: boolean;
}

export interface ExpandedRecurringEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  location: string | null;
  note: string | null;
  source: "recurring";
}

/** Liegt die Endzeit vor oder auf der Startzeit, endet der Block am Folgetag. */
export function recurringEndsNextDay(startTime: TimeOfDay, endTime: TimeOfDay): boolean {
  const s = parseTimeOfDay(startTime);
  const e = parseTimeOfDay(endTime);
  return e.hour * 60 + e.minute <= s.hour * 60 + s.minute;
}

/** Erzeugt aus aktiven Wiederholungen konkrete Einträge für eine Woche. */
export function expandRecurringCommitments(
  commitments: readonly RecurringTemplate[],
  weekStart: LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): ExpandedRecurringEntry[] {
  const expanded = commitments
    .filter((c) => c.active)
    .map((c) => {
      const date = addDays(weekStart, c.weekday - 1);
      const { start, end } = resolveTimeRange(
        date,
        c.start_time,
        c.end_time,
        recurringEndsNextDay(c.start_time, c.end_time),
        timeZone,
      );
      return {
        title: c.title,
        category: c.category,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        location: c.location,
        note: c.note,
        source: "recurring" as const,
      };
    })
    // Zeitumstellung kann eine Uhrzeit verschieben; Ende muss trotzdem nach Beginn liegen.
    .filter((e) => Date.parse(e.end_at) > Date.parse(e.start_at));
  return sortEntries(expanded);
}

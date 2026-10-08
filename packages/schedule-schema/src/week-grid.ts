/**
 * Geometrie des Wochen-Zeitrasters (Zeitachse × Tagesspalten). Reine Funktionen ohne UI: Die App
 * zeichnet daraus ihr natives Raster; die Website rechnet bisher noch mit einer eigenen Kopie
 * derselben Regeln (`apps/web/src/components/week-grid.tsx`).
 *
 * Positionen sind Minuten der Wanduhr (Europe/Berlin) ab 00:00 des jeweiligen Tages. An den
 * Tagen der Zeitumstellung zählt also die angezeigte Uhrzeit, nicht die verstrichene Zeit.
 */
import { SCHEDULE_TIMEZONE } from "./constants";
import { type TimedBlock, getEntriesForDay } from "./schedule";
import { type LocalDate, getDayBounds, getWeekDays, parseTimeOfDay, toLocalTime } from "./time";

/** Ohne frühere bzw. spätere Blöcke zeigt das Raster 06:00–22:00. */
export const WEEK_GRID_DEFAULT_HOURS = { first: 6, last: 22 } as const;

const DAY_MINUTES = 24 * 60;

/** Teil eines Blocks, der auf einen Kalendertag fällt (über Mitternacht geteilt). */
export interface DaySegment<T extends TimedBlock> {
  entry: T;
  /** Minuten ab 00:00 Ortszeit (Wanduhr) innerhalb des Tages. */
  from: number;
  to: number;
  /** Beginnt am Vortag (Fortsetzung über Mitternacht). */
  continued: boolean;
}

/** Segment mit Spur: überschneidende Blöcke stehen nebeneinander statt übereinander. */
export interface PlacedDaySegment<T extends TimedBlock> extends DaySegment<T> {
  lane: number;
  lanes: number;
}

export interface WeekGridDay<T extends TimedBlock> {
  date: LocalDate;
  segments: PlacedDaySegment<T>[];
}

export interface WeekGridLayout<T extends TimedBlock> {
  days: WeekGridDay<T>[];
  /** Erste angezeigte Stunde (inklusive). */
  firstHour: number;
  /** Letzte angezeigte Stunde (exklusive Obergrenze, höchstens 24). */
  lastHour: number;
}

/** Minuten seit 00:00 der Wanduhr in der Planungszeitzone. */
export function localMinutesOfDay(instant: Date, timeZone: string = SCHEDULE_TIMEZONE): number {
  const { hour, minute } = parseTimeOfDay(toLocalTime(instant, timeZone));
  return hour * 60 + minute;
}

/** Alle Segmente eines Tages, chronologisch (auch Blöcke, die am Vortag beginnen). */
export function getDaySegments<T extends TimedBlock>(
  entries: readonly T[],
  date: LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): DaySegment<T>[] {
  const bounds = getDayBounds(date, timeZone);
  return getEntriesForDay(entries, date, timeZone).map((entry) => {
    const start = Date.parse(entry.start_at);
    const end = Date.parse(entry.end_at);
    const continued = start < bounds.start.getTime();
    const from = continued ? 0 : localMinutesOfDay(new Date(start), timeZone);
    const to =
      end >= bounds.end.getTime() ? DAY_MINUTES : localMinutesOfDay(new Date(end), timeZone);
    return { entry, from, to: Math.max(to, from + 1), continued };
  });
}

/** Verteilt überschneidende Segmente auf Spuren (je Überschneidungsgruppe gleich viele). */
export function placeDaySegments<T extends TimedBlock>(
  segments: readonly DaySegment<T>[],
): PlacedDaySegment<T>[] {
  const sorted = [...segments].sort((a, b) => a.from - b.from || a.to - b.to);
  const placed: PlacedDaySegment<T>[] = [];
  let cluster: PlacedDaySegment<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const item of cluster) item.lanes = lanes;
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const segment of sorted) {
    if (segment.from >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= segment.from);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(segment.to);
    } else {
      laneEnds[lane] = segment.to;
    }
    cluster.push({ ...segment, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, segment.to);
  }
  flush();
  return placed;
}

/** Sichtbarer Stundenbereich: Standard 06–22 Uhr, erweitert um frühere bzw. spätere Blöcke. */
export function getVisibleHourRange(segments: readonly DaySegment<TimedBlock>[]): {
  first: number;
  last: number;
} {
  let first: number = WEEK_GRID_DEFAULT_HOURS.first;
  let last: number = WEEK_GRID_DEFAULT_HOURS.last;
  for (const segment of segments) {
    first = Math.min(first, Math.floor(segment.from / 60));
    last = Math.max(last, Math.ceil(segment.to / 60));
  }
  return { first: Math.max(0, first), last: Math.min(24, Math.max(last, first + 1)) };
}

/** Vollständiges Raster einer Woche (Mo–So) mit Spuren und sichtbarem Stundenbereich. */
export function getWeekGridLayout<T extends TimedBlock>(
  entries: readonly T[],
  weekStart: LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): WeekGridLayout<T> {
  const raw = getWeekDays(weekStart).map((date) => ({
    date,
    segments: getDaySegments(entries, date, timeZone),
  }));
  const { first, last } = getVisibleHourRange(raw.flatMap((day) => day.segments));
  return {
    days: raw.map(({ date, segments }) => ({ date, segments: placeDaySegments(segments) })),
    firstHour: first,
    lastHour: last,
  };
}

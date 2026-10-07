import { categoryTone } from "@tagestakt/design-tokens";
import {
  CATEGORY_LABELS,
  type LocalDate,
  type ScheduleEntry,
  WEEKDAY_SHORT_LABELS,
  formatLocalDateShort,
  formatTimeRange,
  getDayBounds,
  getEntriesForDay,
  getWeekDays,
  isoWeekdayOfLocalDate,
  parseLocalDate,
  parseTimeOfDay,
  toLocalTime,
} from "@tagestakt/schedule-schema";
import Link from "next/link";

const DEFAULT_FIRST_HOUR = 6;
const DEFAULT_LAST_HOUR = 22;
const MIN_BLOCK_PX = 24;

interface Segment {
  entry: ScheduleEntry;
  /** Minuten ab 00:00 Ortszeit (Wanduhr) innerhalb des Tages. */
  from: number;
  to: number;
  continued: boolean;
}

function localMinutes(instant: Date): number {
  const { hour, minute } = parseTimeOfDay(toLocalTime(instant));
  return hour * 60 + minute;
}

/** Teil eines Blocks, der auf einen Kalendertag fällt (über Mitternacht geteilt). */
export function daySegments(entries: readonly ScheduleEntry[], date: LocalDate): Segment[] {
  const bounds = getDayBounds(date);
  return getEntriesForDay(entries, date).map((entry) => {
    const start = Date.parse(entry.start_at);
    const end = Date.parse(entry.end_at);
    const continued = start < bounds.start.getTime();
    const from = continued ? 0 : localMinutes(new Date(start));
    const to = end >= bounds.end.getTime() ? 24 * 60 : localMinutes(new Date(end));
    return { entry, from, to: Math.max(to, from + 1), continued };
  });
}

export interface PlacedSegment extends Segment {
  lane: number;
  lanes: number;
}

/** Überschneidende Blöcke nebeneinander statt übereinander (Spalten je Überlappungsgruppe). */
export function placeSegments(segments: readonly Segment[]): PlacedSegment[] {
  const sorted = [...segments].sort((a, b) => a.from - b.from || a.to - b.to);
  const placed: PlacedSegment[] = [];
  let cluster: PlacedSegment[] = [];
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

export function visibleHourRange(segments: readonly Segment[]): { first: number; last: number } {
  let first = DEFAULT_FIRST_HOUR;
  let last = DEFAULT_LAST_HOUR;
  for (const segment of segments) {
    first = Math.min(first, Math.floor(segment.from / 60));
    last = Math.max(last, Math.ceil(segment.to / 60));
  }
  return { first: Math.max(0, first), last: Math.min(24, Math.max(last, first + 1)) };
}

/**
 * Zeitraster einer Woche (breite Bildschirme). Blöcke im Entwurf sind Links zum
 * Bearbeitungsbereich; Verschieben erfolgt dort über Knöpfe (kein Drag-and-drop).
 */
export function WeekGrid({
  weekStart,
  entries,
  overlapIds,
  today,
  now,
  selectedId,
  editHref,
  linkAction = "bearbeiten",
}: {
  weekStart: LocalDate;
  entries: readonly ScheduleEntry[];
  overlapIds: ReadonlySet<string>;
  today: LocalDate;
  now: Date;
  selectedId?: string;
  /** Link zum Bearbeitungs- bzw. Detailbereich eines Blocks. */
  editHref?: (entry: ScheduleEntry) => string;
  /** Wortlaut im zugänglichen Namen des Links („bearbeiten“, „Details anzeigen“). */
  linkAction?: string;
}) {
  const days = getWeekDays(weekStart).map((date) => ({
    date,
    segments: daySegments(entries, date),
  }));
  const { first, last } = visibleHourRange(days.flatMap((d) => d.segments));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const height = `calc(var(--hour-height) * ${last - first})`;
  const top = (minutes: number) => `calc(var(--hour-height) * ${(minutes - first * 60) / 60})`;
  const nowMinutes = localMinutes(now);

  return (
    <div className="wk" role="group" aria-label="Zeitraster der Woche">
      <div className="wk-corner" />
      {days.map(({ date, segments }) => {
        const { day } = parseLocalDate(date);
        return (
          <div key={date} className={`wk-head${date === today ? " is-today" : ""}`}>
            <span className="wk-dn">{WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(date)]}</span>
            <span className="wk-dd">{day}</span>
            <span className="wk-sum">
              {segments.length === 1 ? "1 Block" : `${segments.length} Blöcke`}
            </span>
          </div>
        );
      })}
      <div className="wk-hours" aria-hidden="true" style={{ height }}>
        {hours.map((hour) => (
          <div key={hour}>{String(hour).padStart(2, "0")}:00</div>
        ))}
      </div>
      {days.map(({ date, segments }) => (
        <div
          key={date}
          className={`wk-col${date === today ? " is-today" : ""}`}
          style={{ height }}
          aria-label={formatLocalDateShort(date)}
        >
          {placeSegments(segments).map(({ entry, from, to, continued, lane, lanes }) => {
            const tone = categoryTone[entry.category];
            const classes = [
              "wb",
              `tone-${tone}`,
              overlapIds.has(entry.id) ? "is-overlap" : "",
              entry.id === selectedId ? "is-selected" : "",
              entry.completion_status === "skipped" ? "is-skipped" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const style = {
              top: top(Math.max(from, first * 60)),
              left: `calc(4px + (100% - 8px) * ${lane / lanes})`,
              width: `calc((100% - 8px) / ${lanes} - ${lanes > 1 ? 2 : 0}px)`,
              right: "auto",
              height: `max(${MIN_BLOCK_PX}px, calc(var(--hour-height) * ${(to - Math.max(from, first * 60)) / 60} - 2px))`,
            };
            const label = `${entry.title}, ${CATEGORY_LABELS[entry.category]}, ${formatTimeRange(entry.start_at, entry.end_at)}${continued ? " (Fortsetzung vom Vortag)" : ""}`;
            const content = (
              <>
                <b>
                  {continued ? "↳ " : ""}
                  {entry.title}
                </b>
                <span>{formatTimeRange(entry.start_at, entry.end_at)}</span>
              </>
            );
            const href = editHref?.(entry);
            return href ? (
              <Link
                key={`${entry.id}-${date}`}
                href={href}
                className={classes}
                style={style}
                aria-label={`${label} – ${linkAction}`}
                aria-current={entry.id === selectedId ? "true" : undefined}
              >
                {content}
              </Link>
            ) : (
              <div key={`${entry.id}-${date}`} className={classes} style={style} title={label}>
                {content}
              </div>
            );
          })}
          {date === today && nowMinutes >= first * 60 && nowMinutes <= last * 60 ? (
            <div className="wk-now" style={{ top: top(nowMinutes) }} aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

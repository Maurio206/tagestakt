import {
  type Overlap,
  type ScheduleEntry,
  formatDuration,
  formatLocalDateShort,
  formatTimeRange,
  toLocalDate,
} from "@tagestakt/schedule-schema";

function describe(entry: ScheduleEntry): string {
  return `„${entry.title}“ (${formatLocalDateShort(toLocalDate(new Date(entry.start_at)))} ${formatTimeRange(entry.start_at, entry.end_at)})`;
}

/**
 * Überschneidungen werden nicht verhindert (echte Termine können sich überlagern),
 * sondern gut sichtbar gemeldet.
 */
export function OverlapWarning({ overlaps }: { overlaps: Overlap<ScheduleEntry>[] }) {
  if (overlaps.length === 0) return null;
  return (
    <section className="notice notice--warning" role="status" aria-live="polite">
      <h2 className="notice-title">
        {overlaps.length === 1 ? "1 Zeitüberschneidung" : `${overlaps.length} Zeitüberschneidungen`}
      </h2>
      <p>
        Die folgenden Blöcke überlagern sich. Das ist erlaubt, aber vielleicht nicht beabsichtigt:
      </p>
      <ul>
        {overlaps.map((overlap) => (
          <li key={`${overlap.first.id}-${overlap.second.id}`}>
            {describe(overlap.first)} und {describe(overlap.second)} überschneiden sich (
            {formatDuration(overlap.overlapMinutes)} gemeinsam).
          </li>
        ))}
      </ul>
    </section>
  );
}

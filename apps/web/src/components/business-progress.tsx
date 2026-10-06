import { type BusinessProgress as Progress, formatHours } from "@tagestakt/schedule-schema";

/** Geplante und erledigte Gewerbezeit im Verhältnis zum Wochenziel. */
export function BusinessProgress({ progress }: { progress: Progress }) {
  const plannedPercent = Math.round(Math.min(1, progress.plannedRatio) * 100);
  const completedPercent = Math.round(Math.min(1, progress.completedRatio) * 100);
  const reached = progress.plannedMinutes >= progress.targetMinutes;

  return (
    <div className="progress-block">
      <p className="progress-summary">
        <strong>{formatHours(progress.plannedMinutes)}</strong> von{" "}
        {formatHours(progress.targetMinutes)} geplant
        {progress.completedMinutes > 0
          ? ` · ${formatHours(progress.completedMinutes)} erledigt`
          : ""}
      </p>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Geplante Gewerbezeit im Verhältnis zum Wochenziel"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={plannedPercent}
        aria-valuetext={`${plannedPercent} Prozent des Wochenziels geplant`}
      >
        <div className="progress-planned" style={{ width: `${plannedPercent}%` }} />
        <div className="progress-completed" style={{ width: `${completedPercent}%` }} />
      </div>
      <p className="muted">
        {reached
          ? "Wochenziel ist vollständig eingeplant."
          : `Es fehlen noch ${formatHours(progress.missingPlannedMinutes)} bis zum Wochenziel.`}
      </p>
    </div>
  );
}

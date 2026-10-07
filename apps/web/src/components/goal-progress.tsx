import { categoryTone, goalStatusStyle } from "@tagestakt/design-tokens";
import {
  GOAL_STATUS_LABELS,
  type GoalProgress,
  type GoalStatus,
  formatGoalAmount,
  formatSignedHours,
} from "@tagestakt/schedule-schema";

import { GoalStatusIcon, ToneIcon } from "./icons";

export function GoalStatusChip({ status }: { status: GoalStatus }) {
  return (
    <span className={`status status--${goalStatusStyle[status].tone}`}>
      <GoalStatusIcon status={status} size={15} />
      {GOAL_STATUS_LABELS[status]}
    </span>
  );
}

function percent(value: number, max: number): string {
  return `${Math.min(100, Math.max(0, (value / max) * 100)).toFixed(2)}%`;
}

/** Balken: gestrichelt = geplant, gefüllt = erfasst, Strich = Ziel. Rein dekorativ. */
export function GoalBar({ progress }: { progress: GoalProgress }) {
  const target = progress.targetMinutes;
  if (target === null) {
    return <div className="gbar gbar--unset" aria-hidden="true" />;
  }
  const max = Math.max(target, progress.plannedMinutes, progress.trackedMinutes, 1);
  return (
    <div className="gbar" aria-hidden="true">
      <span className="gbar-plan" style={{ width: percent(progress.plannedMinutes, max) }} />
      <span className="gbar-act" style={{ width: percent(progress.trackedMinutes, max) }} />
      <span className="gbar-target" style={{ left: `calc(${percent(target, max)} - 1px)` }} />
    </div>
  );
}

export function GoalLegend() {
  return (
    <p className="legend">
      <span>
        <i className="legend-act" aria-hidden="true" /> erfasst
      </span>
      <span>
        <i className="legend-plan" aria-hidden="true" /> geplant
      </span>
      <span>
        <i className="legend-target" aria-hidden="true" /> Wochenziel
      </span>
    </p>
  );
}

/** Eine Zielzeile: Name, Status, Werte, Balken und sachlicher Satz. */
export function GoalRow({ progress }: { progress: GoalProgress }) {
  const tone = categoryTone[progress.goal];
  return (
    <li className={`goal tone-${tone}`}>
      <div className="goal-top">
        <span className="goal-name">
          <ToneIcon tone={tone} />
          {progress.label}
        </span>
        <GoalStatusChip status={progress.status} />
        <span className="goal-values num">
          <b>{formatGoalAmount(progress.trackedMinutes)}</b> erfasst ·{" "}
          {formatGoalAmount(progress.plannedMinutes)} geplant
          {progress.targetMinutes !== null
            ? ` · Ziel ${formatGoalAmount(progress.targetMinutes)}`
            : ""}
        </span>
      </div>
      <GoalBar progress={progress} />
      <p className="goal-sentence">{progress.sentence}</p>
    </li>
  );
}

export function GoalList({ goals }: { goals: readonly GoalProgress[] }) {
  return (
    <ul className="goals">
      {goals.map((goal) => (
        <GoalRow key={goal.goal} progress={goal} />
      ))}
    </ul>
  );
}

/** Tabellarische Bilanz: Ziel · geplant · erfasst · Differenz · Status. */
export function GoalTable({ goals, caption }: { goals: readonly GoalProgress[]; caption: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Ziel</th>
            <th scope="col" className="r">
              Wochenziel
            </th>
            <th scope="col" className="r">
              Geplant
            </th>
            <th scope="col" className="r">
              Erfasst
            </th>
            <th scope="col" className="r">
              Differenz
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((goal) => {
            const tone = categoryTone[goal.goal];
            return (
              <tr key={goal.goal}>
                <th scope="row" className={`tone-${tone}`}>
                  <span className="goal-name">
                    <ToneIcon tone={tone} />
                    {goal.label}
                  </span>
                </th>
                <td className="r">
                  {goal.targetMinutes === null ? "–" : formatGoalAmount(goal.targetMinutes)}
                </td>
                <td className="r">{formatGoalAmount(goal.plannedMinutes)}</td>
                <td className="r">{formatGoalAmount(goal.trackedMinutes)}</td>
                <td className="r">
                  {goal.differenceMinutes === null
                    ? "–"
                    : formatSignedHours(goal.differenceMinutes)}
                </td>
                <td>
                  <GoalStatusChip status={goal.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

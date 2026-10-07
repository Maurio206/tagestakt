import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  type CompletionStatus,
  GOAL_KEYS,
  GOAL_LABELS,
  type GoalKey,
  type ScheduleEntry,
  formatDuration,
  formatLocalDateLong,
  formatTime,
  formatTimeRange,
  getEntryProgress,
  getRemainingMinutes,
  getSessionMinutes,
  getWeekStart,
  isGoalKey,
  isLikelyForgotten,
  requiresCorrectionToStop,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { Check, Play, Square, X } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

import type { FormAction } from "@/lib/form";
import { evaluationPath } from "@/lib/paths";

import { ActionButton } from "./action-button";
import { CategoryBadge } from "./category-badge";
import { ToneIcon } from "./icons";
import { LiveTimer } from "./live-timer";

/** Server Actions der Übersicht; die Seite bindet sie (Komponenten importieren nichts aus src/server). */
export interface NowPanelActions {
  start: (goal: GoalKey, entryId: string | null) => FormAction;
  stop: (sessionId: string) => FormAction;
  discard: (sessionId: string) => FormAction;
  switchTo: (runningSessionId: string, goal: GoalKey, entryId: string | null) => FormAction;
  setCompletion: (entryId: string, status: CompletionStatus) => FormAction;
}

function GoalChip({ goal, children }: { goal: GoalKey; children: ReactNode }) {
  const tone = categoryTone[goal];
  return (
    <span className={`chip tone-${tone}`}>
      <ToneIcon tone={tone} size={15} />
      {children}
    </span>
  );
}

function dayPrefix(iso: string, now: Date): string {
  const date = toLocalDate(new Date(iso));
  return date === toLocalDate(now) ? "" : `${formatLocalDateLong(date)}, `;
}

function RunningState({
  session,
  current,
  now,
  actions,
}: {
  session: ActivitySession;
  current: ScheduleEntry | undefined;
  now: Date;
  actions: NowPanelActions;
}) {
  const linked = current && session.schedule_entry_id === current.id ? current : undefined;
  const blocked = requiresCorrectionToStop(session, now);
  const minutes = getSessionMinutes(session, now);
  const switchTarget =
    current && isGoalKey(current.category) && session.schedule_entry_id !== current.id
      ? { goal: current.category, entry: current }
      : undefined;
  const runningLabel = GOAL_LABELS[session.goal_category];

  return (
    <div className="now">
      <div className="row">
        <GoalChip goal={session.goal_category}>{runningLabel} · Läuft</GoalChip>
      </div>
      <h2 className="now-title">{session.title}</h2>
      <LiveTimer startedAt={session.started_at} initialNow={now.toISOString()} />
      <p className="now-meta">
        seit {dayPrefix(session.started_at, now)}
        {formatTime(session.started_at)} Uhr
        {linked ? ` · Plan bis ${formatTime(linked.end_at)}` : ""}
      </p>
      {isLikelyForgotten(session, now) ? (
        <p className="hint hint--warning">
          Vermutlich vergessen – bitte das Ende über „Zeit korrigieren“ eintragen.
        </p>
      ) : null}
      <div className="button-row">
        {blocked ? (
          <p className="hint">
            Läuft seit über 24 Stunden: Beenden ist nur noch über „Zeit korrigieren“ möglich.
          </p>
        ) : (
          <ActionButton
            action={actions.stop(session.id)}
            label="Beenden"
            icon={<Square size={18} aria-hidden="true" />}
            variant="primary"
            size="lg"
            pendingLabel="Wird beendet …"
          />
        )}
        <Link
          className="btn btn--secondary btn--lg"
          href={evaluationPath(getWeekStart(new Date(session.started_at)), {
            correctId: session.id,
          })}
        >
          Zeit korrigieren
        </Link>
        <ActionButton
          action={actions.discard(session.id)}
          label="Abbrechen"
          icon={<X size={18} aria-hidden="true" />}
          variant="ghost"
          size="lg"
          confirmMessage={`Aktivität verwerfen? Die erfasste Zeit (${formatDuration(minutes)}) wird gelöscht.`}
        />
      </div>
      {switchTarget ? (
        <div className="notice">
          <div className="notice-body">
            <p className="notice-title">
              Jetzt geplant: {GOAL_LABELS[switchTarget.goal]} · {switchTarget.entry.title}
            </p>
            <p className="muted">
              {runningLabel} läuft noch. Beim Wechsel wird {runningLabel} mit der aktuellen
              Serverzeit beendet.
            </p>
            <div className="button-row">
              <ActionButton
                action={actions.switchTo(session.id, switchTarget.goal, switchTarget.entry.id)}
                label={`${runningLabel} beenden, ${GOAL_LABELS[switchTarget.goal]} starten`}
                variant="secondary"
                confirmMessage={`${runningLabel} beenden (${formatDuration(minutes)} erfasst) und ${GOAL_LABELS[switchTarget.goal]} starten?`}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Restzeit groß in Ziffern („2:52“ bzw. „35“) mit kleiner Einheit; Screenreader lesen Text. */
function RemainingTime({ minutes }: { minutes: number }) {
  const hours = Math.floor(minutes / 60);
  const digits = hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : String(minutes);
  return (
    <p className="remaining">
      <span aria-hidden="true">{digits}</span>{" "}
      <span className="remaining-unit" aria-hidden="true">
        {hours > 0 ? "Std. übrig" : "Min. übrig"}
      </span>
      <span className="visually-hidden">noch {formatDuration(minutes)}</span>
    </p>
  );
}

function EntryState({
  entry,
  now,
  tracked,
  actions,
}: {
  entry: ScheduleEntry;
  now: Date;
  tracked: boolean;
  actions: NowPanelActions;
}) {
  const goal = isGoalKey(entry.category) ? entry.category : undefined;
  const tone = categoryTone[entry.category];
  return (
    <div className={`now tone-${tone}`}>
      <div className="row">
        {goal ? (
          <GoalChip goal={goal}>Jetzt · {formatTimeRange(entry.start_at, entry.end_at)}</GoalChip>
        ) : (
          <>
            <CategoryBadge category={entry.category} />
            <span className="muted">Jetzt · {formatTimeRange(entry.start_at, entry.end_at)}</span>
          </>
        )}
      </div>
      <h2 className="now-title">{entry.title}</h2>
      <RemainingTime minutes={getRemainingMinutes(entry, now)} />
      <div className="track" aria-hidden="true">
        <span style={{ width: `${Math.round(getEntryProgress(entry, now) * 100)}%` }} />
      </div>
      {entry.location ? <p className="muted">Ort: {entry.location}</p> : null}
      {goal && !tracked ? <p className="hint">Noch nicht erfasst.</p> : null}
      <div className="button-row">
        {goal ? (
          <ActionButton
            action={actions.start(goal, entry.id)}
            label="Fokus starten"
            icon={<Play size={18} aria-hidden="true" />}
            variant="primary"
            size="lg"
            pendingLabel="Wird gestartet …"
          />
        ) : null}
        {entry.completion_status !== "completed" ? (
          <ActionButton
            action={actions.setCompletion(entry.id, "completed")}
            label="Erledigt"
            icon={<Check size={18} aria-hidden="true" />}
            size="lg"
            ariaLabel={`„${entry.title}“ als erledigt markieren`}
          />
        ) : (
          <span className="tag tag--success">Erledigt</span>
        )}
        {entry.completion_status !== "skipped" ? (
          <ActionButton
            action={actions.setCompletion(entry.id, "skipped")}
            label="Ausgelassen"
            variant="ghost"
            size="lg"
            ariaLabel={`„${entry.title}“ als ausgelassen markieren`}
          />
        ) : null}
      </div>
      {goal ? null : <SpontaneousStart actions={actions} size="sm" />}
    </div>
  );
}

function SpontaneousStart({ actions, size }: { actions: NowPanelActions; size: "lg" | "sm" }) {
  return (
    <div className="stack-tight">
      <p className="field-label">Aktivität starten</p>
      <div className="button-row">
        {GOAL_KEYS.map((goal) => (
          <ActionButton
            key={goal}
            action={actions.start(goal, null)}
            label={GOAL_LABELS[goal]}
            icon={<ToneIcon tone={categoryTone[goal]} />}
            size={size}
            variant={size === "lg" ? "secondary" : "ghost"}
            ariaLabel={`Aktivität ${GOAL_LABELS[goal]} starten`}
            pendingLabel="Wird gestartet …"
          />
        ))}
      </div>
    </div>
  );
}

function FreeState({
  next,
  now,
  actions,
}: {
  next: ScheduleEntry | undefined;
  now: Date;
  actions: NowPanelActions;
}) {
  return (
    <div className="now">
      <h2 className="now-title">Gerade nichts geplant</h2>
      <p className="now-meta">
        {next
          ? `Als Nächstes: ${next.title} · ${dayPrefix(next.start_at, now)}${formatTime(next.start_at)} Uhr`
          : "Für den Rest der Woche ist nichts mehr geplant."}
      </p>
      <SpontaneousStart actions={actions} size="lg" />
    </div>
  );
}

/** Die eine Hauptaussage der Übersicht: was jetzt läuft und was zu tun ist. */
export function NowPanel({
  now,
  running,
  current,
  next,
  trackedEntryIds,
  actions,
}: {
  now: Date;
  running: ActivitySession | null;
  current: ScheduleEntry | undefined;
  next: ScheduleEntry | undefined;
  trackedEntryIds: ReadonlySet<string>;
  actions: NowPanelActions;
}) {
  if (running) {
    return <RunningState session={running} current={current} now={now} actions={actions} />;
  }
  if (current) {
    return (
      <EntryState
        entry={current}
        now={now}
        tracked={trackedEntryIds.has(current.id)}
        actions={actions}
      />
    );
  }
  return <FreeState next={next} now={now} actions={actions} />;
}

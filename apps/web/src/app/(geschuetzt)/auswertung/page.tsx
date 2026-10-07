import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  GOAL_KEYS,
  GOAL_LABELS,
  GOAL_STATUS_LABELS,
  addDays,
  formatDuration,
  formatGoalAmount,
  formatLocalDateShort,
  formatTime,
  formatWeekLabel,
  getIsoWeek,
  getSessionMinutes,
  getWeekBounds,
  getWeekGoals,
  getWeekStart,
  getWeekSummarySentence,
  isValidLocalDate,
  toLocalDate,
  toLocalTime,
} from "@tagestakt/schedule-schema";
import { Pencil, Trash } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/action-button";
import { ActivityCorrectionForm, ActivityManualForm } from "@/components/activity-forms";
import { GoalLegend, GoalList, GoalTable } from "@/components/goal-progress";
import { GoalStatusIcon, ToneIcon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { WeekPicker } from "@/components/week-picker";
import { evaluationPath, noticeText } from "@/lib/paths";
import {
  addManualActivityAction,
  correctActivityAction,
  deleteActivityAction,
} from "@/server/actions/activity";
import { listSessions } from "@/server/data/activity";
import { getPublishedWeeks } from "@/server/data/schedule";
import { getSettings } from "@/server/data/settings";

export const metadata: Metadata = { title: "Auswertung" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const HISTORY_WEEKS = 4;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sessionWhen(session: ActivitySession): string {
  const start = new Date(session.started_at);
  const end = session.ended_at ? formatTime(session.ended_at) : "läuft";
  return `${formatLocalDateShort(toLocalDate(start))} ${formatTime(start)}–${end}`;
}

export default async function EvaluationPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requested = single(params.woche);
  const now = new Date();
  const today = toLocalDate(now);
  const weekStart = getWeekStart(requested && isValidLocalDate(requested) ? requested : today);
  const historyStarts = Array.from({ length: HISTORY_WEEKS }, (_, i) =>
    addDays(weekStart, -7 * (i + 1)),
  );
  const firstWeek = historyStarts[historyStarts.length - 1] ?? weekStart;

  const [settings, publishedWeeks, sessions] = await Promise.all([
    getSettings(),
    getPublishedWeeks([weekStart, ...historyStarts]),
    listSessions(getWeekBounds(firstWeek).start, getWeekBounds(weekStart).end),
  ]);

  const goalsFor = (start: string) =>
    getWeekGoals({
      targets: settings.goalTargets,
      entries: publishedWeeks.find((w) => w.week_start === start)?.schedule_entries ?? [],
      sessions,
      weekStart: start,
      now,
    });
  const goals = goalsFor(weekStart);
  const bounds = getWeekBounds(weekStart);
  const weekSessions = sessions
    .filter(
      (s) =>
        Date.parse(s.started_at) < bounds.end.getTime() &&
        (s.ended_at === null || Date.parse(s.ended_at) > bounds.start.getTime()),
    )
    .reverse();
  const correctId = single(params.korrigieren);
  const notice = noticeText(single(params.hinweis));
  const listPath = evaluationPath(weekStart);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Auswertung</p>
          <h1>{formatWeekLabel(weekStart)}</h1>
        </div>
        <WeekPicker
          weekStart={weekStart}
          previousHref={evaluationPath(addDays(weekStart, -7))}
          todayHref={evaluationPath(getWeekStart(today))}
          nextHref={evaluationPath(addDays(weekStart, 7))}
          action="/auswertung"
        />
      </header>

      {notice ? (
        <Notice tone="success" role="status">
          {notice}
        </Notice>
      ) : null}

      <section className="section" aria-labelledby="bilanz-titel">
        <div className="section-head">
          <h2 id="bilanz-titel">Wochenbilanz</h2>
          <Link href="/einstellungen" className="small">
            Ziele ändern
          </Link>
        </div>
        <p className="now-meta">{getWeekSummarySentence(goals)}</p>
        <GoalTable goals={goals} caption={`Wochenbilanz ${formatWeekLabel(weekStart)}`} />
        <GoalLegend />
        <GoalList goals={goals} />
        <p className="small subtle">
          Geplant = veröffentlichte Version dieser Woche (ohne „ausgelassen“). Erfasst = gestartete
          und nachgetragene Aktivitäten. Wochenziele gelten aus den aktuellen Einstellungen.
        </p>
      </section>

      <section className="section" aria-labelledby="verlauf-titel">
        <div className="section-head">
          <h2 id="verlauf-titel">Letzte vier Wochen</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Erfasste Zeit der letzten vier Wochen</caption>
            <thead>
              <tr>
                <th scope="col">Woche</th>
                {GOAL_KEYS.map((goal) => (
                  <th key={goal} scope="col">
                    {GOAL_LABELS[goal]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyStarts.map((start) => {
                const weekGoals = goalsFor(start);
                return (
                  <tr key={start}>
                    <th scope="row">
                      <Link href={evaluationPath(start)}>KW {getIsoWeek(start).week}</Link>
                    </th>
                    {weekGoals.map((goal) => (
                      <td key={goal.goal} className="num">
                        <span className="row">
                          <GoalStatusIcon status={goal.status} size={16} />
                          <span>
                            {formatGoalAmount(goal.trackedMinutes)}
                            {goal.targetMinutes !== null
                              ? ` / ${formatGoalAmount(goal.targetMinutes)}`
                              : ""}
                          </span>
                          <span className="visually-hidden">{GOAL_STATUS_LABELS[goal.status]}</span>
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="erfasst-titel">
        <div className="section-head">
          <h2 id="erfasst-titel">Erfasste Aktivitäten</h2>
        </div>
        {weekSessions.length === 0 ? (
          <p className="muted">In dieser Woche wurde noch keine Zeit erfasst.</p>
        ) : (
          <ul className="list">
            {weekSessions.map((session) => {
              const tone = categoryTone[session.goal_category];
              const start = new Date(session.started_at);
              const end = session.ended_at ? new Date(session.ended_at) : null;
              return session.id === correctId ? (
                <li key={session.id} className="is-editing">
                  <h3 className="list-title">„{session.title}“ – Zeit korrigieren</h3>
                  <ActivityCorrectionForm
                    action={correctActivityAction.bind(null, weekStart)}
                    sessionId={session.id}
                    running={end === null}
                    cancelHref={listPath}
                    defaults={{
                      date: toLocalDate(start),
                      startTime: toLocalTime(start),
                      endTime: end ? toLocalTime(end) : "",
                      endsNextDay: end ? toLocalDate(end) !== toLocalDate(start) : false,
                    }}
                  />
                </li>
              ) : (
                <li key={session.id}>
                  <span className="list-time">{sessionWhen(session)}</span>
                  <div className="list-main">
                    <p className="list-title">{session.title}</p>
                    <div className="list-meta">
                      <span className={`cat tone-${tone}`}>
                        <ToneIcon tone={tone} size={15} />
                        {GOAL_LABELS[session.goal_category]}
                      </span>
                      <span className="num">{formatDuration(getSessionMinutes(session, now))}</span>
                      {session.ended_at === null ? <span className="tag">läuft</span> : null}
                      {session.corrected_at ? <span className="tag">korrigiert</span> : null}
                    </div>
                  </div>
                  <div className="list-actions">
                    <Link
                      className="btn btn--ghost btn--sm"
                      href={evaluationPath(weekStart, { correctId: session.id })}
                      aria-label={`Zeit von „${session.title}“ korrigieren`}
                    >
                      <Pencil size={16} aria-hidden="true" />
                      Zeit korrigieren
                    </Link>
                    <ActionButton
                      action={deleteActivityAction.bind(null, session.id)}
                      label="Löschen"
                      icon={<Trash size={16} aria-hidden="true" />}
                      variant="danger"
                      size="sm"
                      ariaLabel={`„${session.title}“ löschen`}
                      confirmMessage={`Erfasste Zeit „${session.title}“ (${formatDuration(getSessionMinutes(session, now))}) löschen?`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="disclosure">
        <summary>Zeit nachtragen</summary>
        <ActivityManualForm
          action={addManualActivityAction}
          defaults={{
            goal: "business",
            title: "",
            date: weekStart <= today && today < addDays(weekStart, 7) ? today : weekStart,
            startTime: "17:00",
            endTime: "18:00",
            endsNextDay: false,
          }}
        />
      </details>
    </>
  );
}

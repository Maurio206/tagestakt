import {
  addDays,
  formatLocalDateLong,
  formatLocalDateShort,
  formatTime,
  formatTimeRange,
  formatWeekLabel,
  getCurrentEntry,
  getNextEntry,
  getWeekBounds,
  getWeekGoals,
  getWeekStart,
  sortEntries,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { CategoryBadge } from "@/components/category-badge";
import { GoalLegend, GoalList } from "@/components/goal-progress";
import { Notice } from "@/components/notice";
import { NowPanel, type NowPanelActions } from "@/components/now-panel";
import { evaluationPath, weekPlanPath } from "@/lib/paths";
import {
  discardActivityAction,
  startActivityAction,
  stopActivityAction,
  switchActivityAction,
} from "@/server/actions/activity";
import { setCompletionAction } from "@/server/actions/schedule";
import { getRunningSession, listSessions } from "@/server/data/activity";
import { getPublishedWeeks, listWeekVersions } from "@/server/data/schedule";
import { getSettings } from "@/server/data/settings";

export const metadata: Metadata = { title: "Übersicht" };

const nowActions: NowPanelActions = {
  start: (goal, entryId) => startActivityAction.bind(null, goal, entryId),
  stop: (sessionId) => stopActivityAction.bind(null, sessionId),
  discard: (sessionId) => discardActivityAction.bind(null, sessionId),
  switchTo: (runningId, goal, entryId) => switchActivityAction.bind(null, runningId, goal, entryId),
  setCompletion: (entryId, status) => setCompletionAction.bind(null, entryId, status),
};

export default async function DashboardPage() {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const bounds = getWeekBounds(weekStart);
  const [publishedWeeks, settings, versions, sessions, running] = await Promise.all([
    // Vorwoche für Blöcke über Mitternacht (Sonntag → Montag)
    getPublishedWeeks([addDays(weekStart, -7), weekStart, addDays(weekStart, 7)]),
    getSettings(),
    listWeekVersions(weekStart),
    listSessions(bounds.start, bounds.end),
    getRunningSession(),
  ]);

  const currentWeek = publishedWeeks.find((w) => w.week_start === weekStart);
  const entries = sortEntries(publishedWeeks.flatMap((w) => w.schedule_entries));
  const current = getCurrentEntry(entries, now);
  const upcoming = entries.filter((e) => Date.parse(e.start_at) > now.getTime()).slice(0, 3);
  const next = getNextEntry(entries, now);
  const trackedEntryIds = new Set(
    sessions.map((s) => s.schedule_entry_id).filter((id): id is string => id !== null),
  );
  const goals = getWeekGoals({
    targets: settings.goalTargets,
    entries: currentWeek?.schedule_entries ?? [],
    sessions,
    weekStart,
    now,
  });
  const draft = versions.find((v) => v.status === "draft");
  const today = toLocalDate(now);

  return (
    <>
      <AutoRefresh intervalSeconds={60} />
      <header className="page-header">
        <div>
          <p className="eyebrow">{formatWeekLabel(weekStart)}</p>
          <h1>Übersicht</h1>
        </div>
        <p className="muted" aria-live="polite">
          {formatLocalDateLong(today)} · Stand {formatTime(now)} Uhr
        </p>
      </header>

      {!currentWeek ? (
        <Notice tone="info" title="Für diese Woche ist noch kein Plan veröffentlicht.">
          <p>
            <Link href={weekPlanPath(weekStart)}>Zum Wochenplan</Link> – Entwurf anlegen oder
            Wiederholungen übernehmen.
          </p>
        </Notice>
      ) : null}

      <section aria-label="Jetzt">
        <NowPanel
          now={now}
          running={running}
          current={current}
          next={next}
          trackedEntryIds={trackedEntryIds}
          actions={nowActions}
        />
      </section>

      <div className="grid-2">
        <section className="section" aria-labelledby="naechstes-titel">
          <div className="section-head">
            <h2 id="naechstes-titel">Als Nächstes</h2>
          </div>
          {upcoming.length === 0 ? (
            <p className="muted">Nichts mehr geplant.</p>
          ) : (
            <ul className="list">
              {upcoming.map((entry) => {
                const date = toLocalDate(new Date(entry.start_at));
                return (
                  <li key={entry.id}>
                    <span className="list-time">
                      {date === today ? "" : `${formatLocalDateShort(date)} `}
                      {formatTimeRange(entry.start_at, entry.end_at)}
                    </span>
                    <div className="list-main">
                      <p className="list-title">{entry.title}</p>
                      <div className="list-meta">
                        <CategoryBadge category={entry.category} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="section" aria-labelledby="ziele-titel">
          <div className="section-head">
            <h2 id="ziele-titel">Diese Woche</h2>
            <Link href={evaluationPath(weekStart)} className="small">
              Zur Auswertung
            </Link>
          </div>
          <GoalLegend />
          <GoalList goals={goals} />
        </section>
      </div>

      <section className="section" aria-labelledby="planung-titel">
        <div className="section-head">
          <h2 id="planung-titel">Planung</h2>
        </div>
        <p className="muted">
          {currentWeek
            ? `Veröffentlicht ist Version ${currentWeek.version} dieser Woche.`
            : "Diese Woche hat noch keine veröffentlichte Version."}{" "}
          {draft ? `Es gibt einen unveröffentlichten Entwurf (Version ${draft.version}).` : ""}
        </p>
        <div className="button-row">
          <Link className="btn btn--secondary" href={weekPlanPath(weekStart)}>
            Diese Woche bearbeiten
          </Link>
          <Link className="btn btn--secondary" href={weekPlanPath(addDays(weekStart, 7))}>
            Nächste Woche planen
          </Link>
        </div>
      </section>
    </>
  );
}

import {
  type LocalDate,
  addDays,
  formatLocalDateLong,
  formatLocalDateShort,
  formatTimeRange,
  formatWeekLabel,
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
import {
  FocusStage,
  type FocusStageEntry,
  type FocusStageServerActions,
} from "@/components/focus-stage";
import { GoalLegend, GoalList } from "@/components/goal-progress";
import { Notice } from "@/components/notice";
import { TodayNote } from "@/components/today-note";
import { evaluationPath, weekPlanPath } from "@/lib/paths";
import {
  discardActivityAction,
  startActivityAction,
  stopActivityAction,
  switchActivityAction,
} from "@/server/actions/activity";
import { saveDailyNoteAction } from "@/server/actions/daily-notes";
import { setCompletionAction } from "@/server/actions/schedule";
import { getRunningSession, listSessions } from "@/server/data/activity";
import { getDailyNote } from "@/server/data/daily-notes";
import { getPublishedWeeks, listWeekVersions } from "@/server/data/schedule";
import { getSettings } from "@/server/data/settings";
import { settle } from "@/server/settle";

export const metadata: Metadata = { title: "Übersicht" };

const focusActions: FocusStageServerActions = {
  start: startActivityAction,
  stop: stopActivityAction,
  discard: discardActivityAction,
  switchTo: switchActivityAction,
  setCompletion: setCompletionAction,
};

export default async function DashboardPage() {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const today: LocalDate = toLocalDate(now);
  const bounds = getWeekBounds(weekStart);
  const [plan, settings, versions, sessions, running, todayNote] = await Promise.all([
    // Vorwoche für Blöcke über Mitternacht (Sonntag → Montag), Folgewoche für „Danach“.
    settle(getPublishedWeeks([addDays(weekStart, -7), weekStart, addDays(weekStart, 7)]), []),
    getSettings(),
    listWeekVersions(weekStart),
    listSessions(bounds.start, bounds.end),
    getRunningSession(),
    settle(getDailyNote(today), null),
  ]);

  const publishedWeeks = plan.value;
  const currentWeek = publishedWeeks.find((w) => w.week_start === weekStart);
  const entries = sortEntries(publishedWeeks.flatMap((w) => w.schedule_entries));
  // Nur die Felder, die die Fokusfläche braucht (keine Notizen an den Browser).
  const focusEntries: FocusStageEntry[] = entries.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    start_at: e.start_at,
    end_at: e.end_at,
    location: e.location,
    completion_status: e.completion_status,
  }));
  const upcoming = entries.filter((e) => Date.parse(e.start_at) > now.getTime()).slice(0, 3);
  const trackedEntryIds = [
    ...new Set(sessions.map((s) => s.schedule_entry_id).filter((id): id is string => id !== null)),
  ];
  const goals = getWeekGoals({
    targets: settings.goalTargets,
    entries: currentWeek?.schedule_entries ?? [],
    sessions,
    weekStart,
    now,
  });
  const draft = versions.find((v) => v.status === "draft");

  return (
    <>
      <AutoRefresh intervalSeconds={60} />
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {formatWeekLabel(weekStart).split(" · ")[0]} · {formatLocalDateLong(today)}
          </p>
          <h1>Übersicht</h1>
        </div>
        <p className="muted small">Wechselt zur Startzeit automatisch zum nächsten Block.</p>
      </header>

      {!currentWeek && running && !plan.failed ? (
        <Notice tone="info" title="Für diese Woche ist noch kein Plan veröffentlicht.">
          <p>
            <Link href={weekPlanPath(weekStart)}>Zum Wochenplan</Link> – Entwurf anlegen oder
            Wiederholungen übernehmen.
          </p>
        </Notice>
      ) : null}

      <FocusStage
        entries={focusEntries}
        running={running}
        trackedEntryIds={trackedEntryIds}
        hasPublishedPlan={Boolean(currentWeek)}
        planError={plan.failed}
        serverNow={now.toISOString()}
        actions={focusActions}
        weekPlanHref={weekPlanPath(weekStart)}
      />

      <TodayNote
        date={today}
        dateLabel={formatLocalDateLong(today)}
        note={todayNote.value}
        loadError={todayNote.failed}
        save={saveDailyNoteAction}
      />

      <div className="grid-2">
        <section className="section" aria-labelledby="naechstes-titel">
          <div className="section-head">
            <h2 id="naechstes-titel">Als Nächstes</h2>
            <Link href={weekPlanPath(weekStart)} className="small">
              Wochenplan
            </Link>
          </div>
          {plan.failed ? (
            <p className="muted">Der Plan konnte nicht geladen werden.</p>
          ) : upcoming.length === 0 ? (
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
          {plan.failed ? (
            <Notice tone="warning">
              Geplante Zeiten fehlen, weil der Plan nicht geladen werden konnte. Erfasste Zeiten
              stehen in der Auswertung.
            </Notice>
          ) : (
            <>
              <GoalLegend />
              <GoalList goals={goals} />
            </>
          )}
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

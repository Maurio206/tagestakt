import {
  type ScheduleEntry,
  addDays,
  formatDuration,
  formatLocalDateLong,
  formatTime,
  formatTimeRange,
  formatWeekLabel,
  getBusinessProgress,
  getCurrentEntry,
  getNextEntry,
  getRemainingMinutes,
  getWeekStart,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { BusinessProgress } from "@/components/business-progress";
import { CategoryBadge } from "@/components/category-badge";
import { weekPlanPath } from "@/lib/paths";
import { getPublishedWeeks, listWeekVersions } from "@/server/data/schedule";
import { getSettings } from "@/server/data/settings";

export const metadata: Metadata = { title: "Übersicht" };

function EntrySummary({
  entry,
  now,
  label,
  headingId,
}: {
  entry: ScheduleEntry;
  now: Date;
  label: string;
  headingId: string;
}) {
  const isToday = toLocalDate(new Date(entry.start_at)) === toLocalDate(now);
  return (
    <div className="stack-tight">
      <h2 id={headingId} className="eyebrow">
        {label}
      </h2>
      <p className="now-title">{entry.title}</p>
      <p className="now-meta">
        <CategoryBadge category={entry.category} />
        <span>
          {isToday ? "" : `${formatLocalDateLong(toLocalDate(new Date(entry.start_at)))}, `}
          {formatTimeRange(entry.start_at, entry.end_at)}
        </span>
      </p>
      {entry.location ? <p className="muted">Ort: {entry.location}</p> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const [publishedWeeks, settings, versions] = await Promise.all([
    getPublishedWeeks([weekStart, addDays(weekStart, 7)]),
    getSettings(),
    listWeekVersions(weekStart),
  ]);

  const currentWeek = publishedWeeks.find((w) => w.week_start === weekStart);
  const entries = publishedWeeks.flatMap((w) => w.schedule_entries);
  const current = getCurrentEntry(entries, now);
  const next = getNextEntry(entries, now);
  const progress = getBusinessProgress(
    currentWeek?.schedule_entries ?? [],
    settings.weeklyBusinessTargetMinutes,
  );
  const draft = versions.find((v) => v.status === "draft");

  return (
    <div className="stack-loose">
      <AutoRefresh intervalSeconds={60} />
      <header className="page-header">
        <div>
          <p className="eyebrow">{formatWeekLabel(weekStart)}</p>
          <h1>Übersicht</h1>
        </div>
        <p className="muted" aria-live="polite">
          Stand {formatTime(now)} Uhr · {formatLocalDateLong(toLocalDate(now))}
        </p>
      </header>

      {!currentWeek ? (
        <section className="notice notice--info">
          Für diese Woche ist noch kein Plan veröffentlicht.{" "}
          <Link href={weekPlanPath(weekStart)}>Zum Wocheneditor</Link>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card now-card" aria-labelledby="jetzt-titel">
          {current ? (
            <>
              <EntrySummary entry={current} now={now} label="Jetzt" headingId="jetzt-titel" />
              <p className="now-remaining">
                noch {formatDuration(getRemainingMinutes(current, now))}
              </p>
            </>
          ) : (
            <div className="stack-tight">
              <h2 id="jetzt-titel" className="eyebrow">
                Jetzt
              </h2>
              <p className="now-title">Kein geplanter Block</p>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="naechstes-titel">
          {next ? (
            <>
              <EntrySummary
                entry={next}
                now={now}
                label="Als Nächstes"
                headingId="naechstes-titel"
              />
              <p className="muted">
                beginnt in{" "}
                {formatDuration(Math.ceil((Date.parse(next.start_at) - now.getTime()) / 60_000))}
              </p>
            </>
          ) : (
            <div className="stack-tight">
              <h2 id="naechstes-titel" className="eyebrow">
                Als Nächstes
              </h2>
              <p className="now-title">Nichts mehr geplant</p>
            </div>
          )}
        </section>
      </div>

      <section className="card stack" aria-labelledby="gewerbe-titel">
        <h2 id="gewerbe-titel">Gewerbe diese Woche</h2>
        <BusinessProgress progress={progress} />
      </section>

      <section className="card stack" aria-labelledby="planung-titel">
        <h2 id="planung-titel">Planung</h2>
        <p>
          {currentWeek
            ? `Veröffentlicht ist Version ${currentWeek.version} dieser Woche.`
            : "Diese Woche hat noch keine veröffentlichte Version."}{" "}
          {draft ? `Es gibt einen unveröffentlichten Entwurf (Version ${draft.version}).` : ""}
        </p>
        <div className="button-row">
          <Link className="button button--primary" href={weekPlanPath(weekStart)}>
            Diese Woche bearbeiten
          </Link>
          <Link className="button button--secondary" href={weekPlanPath(addDays(weekStart, 7))}>
            Nächste Woche planen
          </Link>
        </div>
      </section>
    </div>
  );
}

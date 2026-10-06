import {
  COMPLETION_STATUS_LABELS,
  ENTRY_SOURCE_LABELS,
  type ScheduleEntry,
  type ScheduleWeek,
  WEEK_STATUS_LABELS,
  addDays,
  detectOverlaps,
  formatLocalDateLong,
  formatTime,
  formatTimeRange,
  formatWeekLabel,
  getBusinessProgress,
  getWeekDays,
  getWeekStart,
  groupEntriesByDay,
  isValidLocalDate,
  overlappingEntryIds,
  toLocalDate,
  toLocalTime,
} from "@tagestakt/schedule-schema";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/action-button";
import { BusinessProgress } from "@/components/business-progress";
import { CategoryBadge } from "@/components/category-badge";
import { EntryForm, type EntryFormDefaults } from "@/components/entry-form";
import { OverlapWarning } from "@/components/overlap-warning";
import { PlanningNoteForm } from "@/components/planning-note-form";
import { noticeText, weekPlanPath } from "@/lib/paths";
import {
  createDraftAction,
  createEntryAction,
  deleteDraftAction,
  deleteEntryAction,
  publishDraftAction,
  savePlanningNoteAction,
  setCompletionAction,
  updateEntryAction,
} from "@/server/actions/schedule";
import { getWeekWithEntries, listWeekVersions } from "@/server/data/schedule";
import { getSettings } from "@/server/data/settings";

export const metadata: Metadata = { title: "Wochenplan" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function pickVersion(versions: ScheduleWeek[], requested: string | undefined) {
  return (
    versions.find((v) => v.id === requested) ??
    versions.find((v) => v.status === "draft") ??
    versions.find((v) => v.status === "published") ??
    versions[0]
  );
}

function entryDefaults(entry: ScheduleEntry): EntryFormDefaults {
  const start = new Date(entry.start_at);
  const end = new Date(entry.end_at);
  return {
    title: entry.title,
    category: entry.category,
    date: toLocalDate(start),
    startTime: toLocalTime(start),
    endTime: toLocalTime(end),
    endsNextDay: toLocalDate(end) !== toLocalDate(start),
    location: entry.location ?? "",
    note: entry.note ?? "",
  };
}

export default async function WeekPlanPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requestedWeek = single(params.woche);
  const today = toLocalDate(new Date());
  const weekStart = getWeekStart(
    requestedWeek && isValidLocalDate(requestedWeek) ? requestedWeek : today,
  );

  const [versions, settings] = await Promise.all([listWeekVersions(weekStart), getSettings()]);
  const selectedMeta = pickVersion(versions, single(params.version));
  const week = selectedMeta ? await getWeekWithEntries(selectedMeta.id) : null;
  const draft = versions.find((v) => v.status === "draft");
  const isDraft = week?.status === "draft";
  const editEntryId = isDraft ? single(params.bearbeiten) : undefined;
  const notice = noticeText(single(params.hinweis));

  const entries = week?.schedule_entries ?? [];
  const overlaps = detectOverlaps(entries);
  const overlapIds = overlappingEntryIds(entries);
  const progress = getBusinessProgress(entries, settings.weeklyBusinessTargetMinutes);
  const days = getWeekDays(weekStart).map((date) => ({
    value: date,
    label: formatLocalDateLong(date),
  }));
  const currentPath = week
    ? weekPlanPath(weekStart, { versionId: week.id })
    : weekPlanPath(weekStart);

  return (
    <div className="stack-loose">
      <header className="page-header">
        <div>
          <p className="eyebrow">Wochenplan</p>
          <h1>{formatWeekLabel(weekStart)}</h1>
        </div>
        <nav aria-label="Woche wechseln" className="week-nav">
          <Link className="button button--ghost" href={weekPlanPath(addDays(weekStart, -7))}>
            ← Vorwoche
          </Link>
          <Link className="button button--ghost" href={weekPlanPath(getWeekStart(today))}>
            Heute
          </Link>
          <Link className="button button--ghost" href={weekPlanPath(addDays(weekStart, 7))}>
            Folgewoche →
          </Link>
        </nav>
      </header>

      <form method="get" action="/wochenplan" className="inline-form week-picker">
        <label htmlFor="woche-auswahl">Kalenderwoche wählen</label>
        <input id="woche-auswahl" name="woche" type="date" defaultValue={weekStart} required />
        <button type="submit" className="button button--secondary">
          Anzeigen
        </button>
      </form>

      {notice ? (
        <p className="notice notice--success" role="status">
          {notice}
        </p>
      ) : null}

      {versions.length > 0 ? (
        <nav aria-label="Versionen dieser Woche" className="version-list">
          {versions.map((version) => (
            <Link
              key={version.id}
              href={weekPlanPath(weekStart, { versionId: version.id })}
              className={`version-chip version-chip--${version.status}`}
              aria-current={version.id === week?.id ? "page" : undefined}
            >
              Version {version.version} · {WEEK_STATUS_LABELS[version.status]}
            </Link>
          ))}
        </nav>
      ) : null}

      {!week ? (
        <section className="card stack">
          <h2>Noch kein Plan für diese Woche</h2>
          <p>
            Lege einen leeren Entwurf an oder übernimm deine{" "}
            <Link href="/wiederholungen">wiederkehrenden Termine</Link>.
          </p>
          <div className="button-row">
            <ActionButton
              action={createDraftAction.bind(null, weekStart)}
              label="Entwurf anlegen"
              variant="primary"
            />
          </div>
        </section>
      ) : (
        <>
          {week.status === "published" ? (
            <section className="status-banner status-banner--published stack-tight">
              <p>
                <strong>Veröffentlicht</strong> · Version {week.version}
                {week.published_at
                  ? ` · seit ${formatLocalDateLong(toLocalDate(new Date(week.published_at)))}, ${formatTime(week.published_at)} Uhr`
                  : ""}
              </p>
              <p>
                Diese Version zeigt die App an. Inhalte sind schreibgeschützt; nur der
                Erledigt-Status lässt sich ändern.
              </p>
              <div className="button-row">
                {draft ? (
                  <Link
                    className="button button--secondary"
                    href={weekPlanPath(weekStart, { versionId: draft.id })}
                  >
                    Zum Entwurf (Version {draft.version})
                  </Link>
                ) : (
                  <ActionButton
                    action={createDraftAction.bind(null, weekStart)}
                    label="Als neue Version bearbeiten"
                  />
                )}
              </div>
            </section>
          ) : null}

          {week.status === "archived" ? (
            <section className="status-banner status-banner--archived">
              <p>
                <strong>Archiviert</strong> · Version {week.version} – nur zur Ansicht.
              </p>
            </section>
          ) : null}

          {isDraft ? (
            <section className="status-banner status-banner--draft stack">
              <p>
                <strong>Entwurf</strong> · Version {week.version} – noch nicht in der App sichtbar.
                Änderungen werden sofort im Entwurf gespeichert.
              </p>
              <PlanningNoteForm
                action={savePlanningNoteAction.bind(null, week.id)}
                defaultNote={week.planning_note ?? ""}
              />
              <div className="button-row">
                <ActionButton
                  action={publishDraftAction.bind(null, week.id, weekStart)}
                  label="Entwurf veröffentlichen"
                  variant="primary"
                  pendingLabel="Wird veröffentlicht …"
                  confirmMessage={
                    overlaps.length > 0
                      ? `Der Entwurf enthält ${overlaps.length} Zeitüberschneidung(en). Trotzdem veröffentlichen? Die bisher veröffentlichte Version wird archiviert.`
                      : "Entwurf jetzt veröffentlichen? Die bisher veröffentlichte Version wird archiviert."
                  }
                />
                <ActionButton
                  action={deleteDraftAction.bind(null, week.id, weekStart)}
                  label="Entwurf verwerfen"
                  variant="danger"
                  confirmMessage="Entwurf mit allen Einträgen endgültig verwerfen?"
                />
              </div>
            </section>
          ) : week.planning_note ? (
            <p className="muted">Planungshinweis: {week.planning_note}</p>
          ) : null}

          <OverlapWarning overlaps={overlaps} />

          <section className="card stack" aria-labelledby="gewerbe-titel">
            <h2 id="gewerbe-titel">Gewerbe in dieser Version</h2>
            <BusinessProgress progress={progress} />
          </section>

          {isDraft ? (
            <details className="card" open={entries.length === 0}>
              <summary>
                <h2>Neuer Eintrag</h2>
              </summary>
              <EntryForm
                action={createEntryAction.bind(null, week.id)}
                days={days}
                idPrefix="neu"
                submitLabel="Eintrag hinzufügen"
                defaults={{
                  title: "",
                  category: "business",
                  date: days.some((d) => d.value === today) ? today : weekStart,
                  startTime: "09:00",
                  endTime: "10:00",
                  endsNextDay: false,
                  location: "",
                  note: "",
                }}
              />
            </details>
          ) : null}

          <section aria-label="Tage der Woche" className="days">
            {groupEntriesByDay(entries, weekStart).map((day) => (
              <section key={day.date} className="day" aria-labelledby={`tag-${day.date}`}>
                <h2
                  id={`tag-${day.date}`}
                  className={day.date === today ? "day-title day-title--today" : "day-title"}
                >
                  {formatLocalDateLong(day.date)}
                  {day.date === today ? <span className="today-tag">Heute</span> : null}
                </h2>
                {day.entries.length === 0 ? (
                  <p className="muted">Keine Einträge.</p>
                ) : (
                  <ul className="entry-list">
                    {day.entries.map((entry) =>
                      entry.id === editEntryId ? (
                        <li key={entry.id} className="entry entry--editing">
                          <h3 className="visually-hidden">„{entry.title}“ bearbeiten</h3>
                          <EntryForm
                            action={updateEntryAction.bind(null, entry.id, weekStart, week.id)}
                            days={days}
                            idPrefix={`bearbeiten-${entry.id}`}
                            submitLabel="Änderungen speichern"
                            defaults={entryDefaults(entry)}
                            cancelHref={currentPath}
                          />
                        </li>
                      ) : (
                        <li
                          key={entry.id}
                          className={`entry${overlapIds.has(entry.id) ? " entry--overlap" : ""}`}
                        >
                          <div className="entry-time">
                            {formatTimeRange(entry.start_at, entry.end_at)}
                          </div>
                          <div className="entry-body">
                            <p className="entry-title">{entry.title}</p>
                            <p className="entry-meta">
                              <CategoryBadge category={entry.category} />
                              {entry.source !== "manual" ? (
                                <span className="tag">{ENTRY_SOURCE_LABELS[entry.source]}</span>
                              ) : null}
                              {entry.completion_status !== "planned" ? (
                                <span className={`tag tag--${entry.completion_status}`}>
                                  {COMPLETION_STATUS_LABELS[entry.completion_status]}
                                </span>
                              ) : null}
                              {overlapIds.has(entry.id) ? (
                                <span className="tag tag--warning">Überschneidung</span>
                              ) : null}
                            </p>
                            {entry.location ? <p className="muted">Ort: {entry.location}</p> : null}
                            {entry.note ? <p className="muted">{entry.note}</p> : null}
                          </div>
                          <div className="entry-actions">
                            {isDraft ? (
                              <>
                                <Link
                                  className="button button--ghost"
                                  href={weekPlanPath(weekStart, {
                                    versionId: week.id,
                                    editEntryId: entry.id,
                                  })}
                                  aria-label={`„${entry.title}“ bearbeiten`}
                                >
                                  Bearbeiten
                                </Link>
                                <ActionButton
                                  action={deleteEntryAction.bind(null, entry.id)}
                                  label="Löschen"
                                  variant="danger"
                                  ariaLabel={`„${entry.title}“ löschen`}
                                  confirmMessage={`„${entry.title}“ wirklich löschen?`}
                                />
                              </>
                            ) : null}
                            {week.status === "published" ? (
                              <>
                                {entry.completion_status !== "completed" ? (
                                  <ActionButton
                                    action={setCompletionAction.bind(null, entry.id, "completed")}
                                    label="Erledigt"
                                    ariaLabel={`„${entry.title}“ als erledigt markieren`}
                                  />
                                ) : null}
                                {entry.completion_status !== "skipped" ? (
                                  <ActionButton
                                    action={setCompletionAction.bind(null, entry.id, "skipped")}
                                    label="Ausgelassen"
                                    variant="ghost"
                                    ariaLabel={`„${entry.title}“ als ausgelassen markieren`}
                                  />
                                ) : null}
                                {entry.completion_status !== "planned" ? (
                                  <ActionButton
                                    action={setCompletionAction.bind(null, entry.id, "planned")}
                                    label="Zurücksetzen"
                                    variant="ghost"
                                    ariaLabel={`Status von „${entry.title}“ zurücksetzen`}
                                  />
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </section>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

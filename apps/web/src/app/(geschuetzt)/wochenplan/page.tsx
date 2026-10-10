import {
  type CompletionStatus,
  type LocalDate,
  type ScheduleEntry,
  type ScheduleWeek,
  WEEK_STATUS_LABELS,
  addDays,
  detectOverlaps,
  formatLocalDateLong,
  formatTime,
  formatWeekLabel,
  getWeekBounds,
  getWeekDays,
  getWeekGoals,
  getWeekStart,
  isValidLocalDate,
  overlappingEntryIds,
  toLocalDate,
  toLocalTime,
} from "@tagestakt/schedule-schema";
import { CalendarPlus, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/action-button";
import { RevealBlockDetails } from "@/components/block-details-reveal";
import { DayNotes } from "@/components/day-notes";
import { EntryDetails } from "@/components/entry-details";
import { EntryEditor } from "@/components/entry-editor";
import { EntryForm, type EntryFormDefaults } from "@/components/entry-form";
import { GoalLegend, GoalList } from "@/components/goal-progress";
import { Notice } from "@/components/notice";
import { OverlapWarning } from "@/components/overlap-warning";
import { PlanningNoteForm } from "@/components/planning-note-form";
import { WeekGrid } from "@/components/week-grid";
import { WeekGridFrame } from "@/components/week-grid-frame";
import { WeekPicker } from "@/components/week-picker";
import { noticeText, parseUndoTimes, planPath, weekPlanPath } from "@/lib/paths";
import { saveDailyNoteAction } from "@/server/actions/daily-notes";
import {
  createDraftAction,
  createEntryAction,
  deleteDraftAction,
  deleteEntryAction,
  nudgeEntryAction,
  publishDraftAction,
  restoreEntryTimesAction,
  savePlanningNoteAction,
  setCompletionAction,
  updateEntryAction,
} from "@/server/actions/schedule";
import { listSessions } from "@/server/data/activity";
import { getDailyNote, listNoteDates } from "@/server/data/daily-notes";
import { getWeekWithEntries, listWeekVersions } from "@/server/data/schedule";
import { getSettings } from "@/server/data/settings";
import { settle } from "@/server/settle";

export const metadata: Metadata = { title: "Wochenplan" };

const setCompletion = (entryId: string, status: CompletionStatus) =>
  setCompletionAction.bind(null, entryId, status);

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
  const now = new Date();
  const today = toLocalDate(now);
  const weekStart = getWeekStart(
    requestedWeek && isValidLocalDate(requestedWeek) ? requestedWeek : today,
  );
  const bounds = getWeekBounds(weekStart);
  const weekDays = getWeekDays(weekStart);
  // Tagesnotiz: gewählter Tag dieser Woche, sonst heute bzw. Montag.
  const requestedNote = single(params.notiz);
  const noteDate: LocalDate =
    requestedNote && weekDays.includes(requestedNote)
      ? requestedNote
      : weekDays.includes(today)
        ? today
        : weekStart;

  const [versions, settings, sessions, noteDates, note] = await Promise.all([
    listWeekVersions(weekStart),
    getSettings(),
    listSessions(bounds.start, bounds.end),
    // Notizen sind unabhängig vom Plan: Ein Ladefehler blockiert den Wochenplan nicht.
    settle(listNoteDates(weekStart, addDays(weekStart, 6)), []),
    settle(getDailyNote(noteDate), null),
  ]);
  const selectedMeta = pickVersion(versions, single(params.version));
  const week = selectedMeta ? await getWeekWithEntries(selectedMeta.id) : null;
  const draft = versions.find((v) => v.status === "draft");
  const isDraft = week?.status === "draft";
  const entries = week?.schedule_entries ?? [];
  // „bearbeiten“: im Entwurf der Bearbeitungsbereich, sonst die Details des Blocks.
  const selectedEntry = entries.find((e) => e.id === single(params.bearbeiten));
  const editEntry = isDraft ? selectedEntry : undefined;
  const notice = noticeText(single(params.hinweis));
  const undoEntryId = single(params.rueckgaengig);
  const undoTimes = parseUndoTimes(single(params.vorher));

  const overlaps = detectOverlaps(entries);
  const overlapIds = overlappingEntryIds(entries);
  const goals = getWeekGoals({
    targets: settings.goalTargets,
    entries,
    sessions,
    weekStart,
    now,
  });
  const days = weekDays.map((date) => ({
    value: date,
    label: formatLocalDateLong(date),
  }));
  const versionPath = week
    ? weekPlanPath(weekStart, { versionId: week.id })
    : weekPlanPath(weekStart);
  const editHref = (entry: ScheduleEntry) =>
    weekPlanPath(weekStart, { versionId: week?.id ?? "", editEntryId: entry.id });
  const dayNotes = {
    dates: new Set(noteDates.value),
    href: (date: LocalDate) => weekPlanPath(weekStart, { versionId: week?.id, noteDate: date }),
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Wochenplan</p>
          <h1>{formatWeekLabel(weekStart)}</h1>
        </div>
        <WeekPicker
          weekStart={weekStart}
          previousHref={weekPlanPath(addDays(weekStart, -7))}
          todayHref={weekPlanPath(getWeekStart(today))}
          nextHref={weekPlanPath(addDays(weekStart, 7))}
          action="/wochenplan"
        />
      </header>

      {notice ? (
        notice && undoEntryId && undoTimes && isDraft && week ? (
          <div className="toast" role="status">
            <span>{notice}</span>
            <ActionButton
              action={restoreEntryTimesAction.bind(
                null,
                undoEntryId,
                weekStart,
                week.id,
                undoTimes.startAt,
                undoTimes.endAt,
              )}
              label="Rückgängig"
              size="sm"
              pendingLabel="…"
            />
          </div>
        ) : (
          <Notice tone="success" role="status">
            {notice}
          </Notice>
        )
      ) : null}

      {versions.length > 0 ? (
        <nav aria-label="Versionen dieser Woche" className="version-list">
          {versions.map((version) => (
            <Link
              key={version.id}
              href={weekPlanPath(weekStart, { versionId: version.id })}
              className={`vchip vchip--${version.status}`}
              aria-current={version.id === week?.id ? "page" : undefined}
            >
              Version {version.version} · {WEEK_STATUS_LABELS[version.status]}
            </Link>
          ))}
        </nav>
      ) : null}

      {!week ? (
        <section className="empty">
          <CalendarPlus size={28} aria-hidden="true" className="icon" />
          <h2>Noch kein Plan für diese Woche</h2>
          <p className="muted">
            Lege einen leeren Entwurf an oder übernimm deine wiederkehrenden Termine.
          </p>
          <div className="button-row">
            <ActionButton
              action={createDraftAction.bind(null, weekStart)}
              label="Entwurf anlegen"
              variant="primary"
            />
            <Link className="btn btn--secondary" href="/wiederholungen">
              <Repeat size={18} aria-hidden="true" />
              Wiederholungen übernehmen
            </Link>
          </div>
        </section>
      ) : (
        <>
          {week.status === "published" ? (
            <Notice
              tone="success"
              title={`Veröffentlicht · Version ${week.version}${
                week.published_at
                  ? ` · seit ${formatLocalDateLong(toLocalDate(new Date(week.published_at)))}, ${formatTime(week.published_at)} Uhr`
                  : ""
              }`}
            >
              <p>
                Diese Version zeigt die App an. Inhalte sind schreibgeschützt; nur der
                Erledigt-Status lässt sich ändern.
              </p>
              <div className="button-row">
                {draft ? (
                  <Link
                    className="btn btn--secondary"
                    href={weekPlanPath(weekStart, { versionId: draft.id })}
                  >
                    Zum Entwurf (Version {draft.version})
                  </Link>
                ) : (
                  <ActionButton
                    action={createDraftAction.bind(null, weekStart)}
                    label="Als neue Version bearbeiten"
                    confirmMessage={`Version ${week.version} ist veröffentlicht. Zum Ändern wird Version ${week.version + 1} als Entwurf angelegt; die App zeigt weiter Version ${week.version}, bis du veröffentlichst.`}
                  />
                )}
              </div>
            </Notice>
          ) : null}

          {week.status === "archived" ? (
            <Notice tone="info" title={`Archiviert · Version ${week.version}`}>
              <p>Nur zur Ansicht.</p>
            </Notice>
          ) : null}

          {isDraft ? (
            <Notice tone="draft" title={`Entwurf · Version ${week.version}`}>
              <p>
                Noch nicht in der App sichtbar. Änderungen werden sofort im Entwurf gespeichert.
              </p>
              {entries.some((entry) => entry.source === "agent") ? (
                <p>
                  Von Claude über den Connector erstellt:{" "}
                  <Link href={planPath(weekStart)}>Prüfübersicht der Wochenplanung</Link> vor dem
                  Veröffentlichen ansehen.
                </p>
              ) : null}
              <div className="button-row">
                <ActionButton
                  action={publishDraftAction.bind(null, week.id, weekStart)}
                  label={`Version ${week.version} veröffentlichen`}
                  variant="primary"
                  pendingLabel="Wird veröffentlicht …"
                  confirmMessage={
                    overlaps.length > 0
                      ? `Version ${week.version} enthält ${overlaps.length} Zeitüberschneidung(en). Trotzdem veröffentlichen? Die bisher veröffentlichte Version wird archiviert.`
                      : `Version ${week.version} jetzt veröffentlichen? Die bisher veröffentlichte Version wird archiviert.`
                  }
                />
                <ActionButton
                  action={deleteDraftAction.bind(null, week.id, weekStart)}
                  label="Entwurf verwerfen"
                  variant="danger"
                  confirmMessage="Entwurf mit allen Einträgen endgültig verwerfen?"
                />
              </div>
              <details className="disclosure">
                <summary>Planungshinweis</summary>
                <PlanningNoteForm
                  action={savePlanningNoteAction.bind(null, week.id)}
                  defaultNote={week.planning_note ?? ""}
                />
              </details>
            </Notice>
          ) : week.planning_note ? (
            <p className="muted">Planungshinweis: {week.planning_note}</p>
          ) : null}

          <OverlapWarning overlaps={overlaps} />

          {isDraft ? (
            <details className="disclosure" open={entries.length === 0}>
              <summary>Neuer Eintrag</summary>
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

          <div className={selectedEntry ? "planner planner--editing" : "planner"}>
            <WeekGridFrame>
              <WeekGrid
                weekStart={weekStart}
                entries={entries}
                overlapIds={overlapIds}
                today={today}
                now={now}
                selectedId={selectedEntry?.id}
                editHref={editHref}
                linkAction={isDraft ? "bearbeiten" : "Details anzeigen"}
                dayNotes={dayNotes}
              />
            </WeekGridFrame>
            {selectedEntry ? <RevealBlockDetails entryId={selectedEntry.id} /> : null}
            {editEntry ? (
              <EntryEditor
                key={editEntry.id + editEntry.updated_at}
                entry={editEntry}
                days={days}
                defaults={entryDefaults(editEntry)}
                updateAction={updateEntryAction.bind(null, editEntry.id, weekStart, week.id)}
                nudgeAction={(kind, minutes) =>
                  nudgeEntryAction.bind(null, editEntry.id, weekStart, week.id, kind, minutes)
                }
                deleteAction={deleteEntryAction.bind(null, editEntry.id)}
                closeHref={versionPath}
              />
            ) : selectedEntry ? (
              <EntryDetails
                entry={selectedEntry}
                status={week.status}
                closeHref={versionPath}
                setCompletion={setCompletion}
              />
            ) : null}
          </div>

          <section className="section" aria-labelledby="ziele-titel">
            <div className="section-head">
              <h2 id="ziele-titel">Ziele in dieser Version</h2>
            </div>
            <GoalLegend />
            <GoalList goals={goals} />
          </section>
        </>
      )}

      <DayNotes
        days={weekDays}
        selected={noteDate}
        today={today}
        noteDates={dayNotes.dates}
        note={note.value}
        loadError={note.failed}
        dayHref={dayNotes.href}
        save={saveDailyNoteAction}
      />
    </>
  );
}

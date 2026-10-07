import {
  COMPLETION_STATUS_LABELS,
  type CompletionStatus,
  ENTRY_SOURCE_LABELS,
  type LocalDate,
  type ScheduleEntry,
  type WeekStatus,
  formatLocalDateLong,
  formatTimeRange,
  groupEntriesByDay,
} from "@tagestakt/schedule-schema";
import { Pencil, Trash } from "lucide-react";
import Link from "next/link";

import type { FormAction } from "@/lib/form";

import { ActionButton } from "./action-button";
import { CategoryBadge } from "./category-badge";

/**
 * Tagesliste einer Wochenversion – auf schmalen Bildschirmen die Hauptansicht,
 * auf breiten zusätzlich zum Zeitraster ausgeblendet (`responsive`).
 */
export interface DayListActions {
  deleteEntry: (entryId: string) => FormAction;
  setCompletion: (entryId: string, status: CompletionStatus) => FormAction;
}

export function DayList({
  weekStart,
  entries,
  overlapIds,
  status,
  today,
  selectedId,
  editHref,
  actions,
  responsive = true,
}: {
  weekStart: LocalDate;
  entries: readonly ScheduleEntry[];
  overlapIds: ReadonlySet<string>;
  status: WeekStatus;
  today: LocalDate;
  selectedId?: string;
  editHref: (entry: ScheduleEntry) => string;
  actions: DayListActions;
  responsive?: boolean;
}) {
  return (
    <div className={responsive ? "day-list day-list--responsive" : "day-list"}>
      {groupEntriesByDay(entries, weekStart).map((day) => (
        <section key={day.date} className="day-group" aria-labelledby={`tag-${day.date}`}>
          <h2 id={`tag-${day.date}`} className="day-title">
            {formatLocalDateLong(day.date)}
            {day.date === today ? <span className="today-tag">Heute</span> : null}
          </h2>
          {day.entries.length === 0 ? (
            <p className="muted small">Keine Einträge.</p>
          ) : (
            <ul className="list">
              {day.entries.map((entry) => (
                <li
                  key={entry.id}
                  className={overlapIds.has(entry.id) ? "is-overlap" : undefined}
                  aria-current={entry.id === selectedId ? "true" : undefined}
                >
                  <span className="list-time">{formatTimeRange(entry.start_at, entry.end_at)}</span>
                  <div className="list-main">
                    <p className="list-title">{entry.title}</p>
                    <div className="list-meta">
                      <CategoryBadge category={entry.category} />
                      {entry.source !== "manual" ? (
                        <span className="tag">{ENTRY_SOURCE_LABELS[entry.source]}</span>
                      ) : null}
                      {entry.completion_status !== "planned" ? (
                        <span
                          className={`tag${entry.completion_status === "completed" ? " tag--success" : ""}`}
                        >
                          {COMPLETION_STATUS_LABELS[entry.completion_status]}
                        </span>
                      ) : null}
                      {overlapIds.has(entry.id) ? (
                        <span className="tag tag--warning">Überschneidung</span>
                      ) : null}
                    </div>
                    {entry.location ? <p className="small muted">Ort: {entry.location}</p> : null}
                    {entry.note ? <p className="small muted">{entry.note}</p> : null}
                  </div>
                  <div className="list-actions">
                    {status === "draft" ? (
                      <>
                        <Link
                          className="btn btn--ghost btn--sm"
                          href={editHref(entry)}
                          aria-label={`„${entry.title}“ bearbeiten`}
                        >
                          <Pencil size={16} aria-hidden="true" />
                          Bearbeiten
                        </Link>
                        <ActionButton
                          action={actions.deleteEntry(entry.id)}
                          label="Löschen"
                          icon={<Trash size={16} aria-hidden="true" />}
                          variant="danger"
                          size="sm"
                          ariaLabel={`„${entry.title}“ löschen`}
                          confirmMessage={`„${entry.title}“ wirklich löschen?`}
                        />
                      </>
                    ) : null}
                    {status === "published" ? (
                      <>
                        {entry.completion_status !== "completed" ? (
                          <ActionButton
                            action={actions.setCompletion(entry.id, "completed")}
                            label="Erledigt"
                            size="sm"
                            ariaLabel={`„${entry.title}“ als erledigt markieren`}
                          />
                        ) : null}
                        {entry.completion_status !== "skipped" ? (
                          <ActionButton
                            action={actions.setCompletion(entry.id, "skipped")}
                            label="Ausgelassen"
                            variant="ghost"
                            size="sm"
                            ariaLabel={`„${entry.title}“ als ausgelassen markieren`}
                          />
                        ) : null}
                        {entry.completion_status !== "planned" ? (
                          <ActionButton
                            action={actions.setCompletion(entry.id, "planned")}
                            label="Zurücksetzen"
                            variant="ghost"
                            size="sm"
                            ariaLabel={`Status von „${entry.title}“ zurücksetzen`}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

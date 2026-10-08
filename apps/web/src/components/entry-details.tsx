import {
  COMPLETION_STATUS_LABELS,
  type CompletionStatus,
  ENTRY_SOURCE_LABELS,
  type ScheduleEntry,
  type WeekStatus,
  formatLocalDateShort,
  formatTimeRange,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { X } from "lucide-react";
import Link from "next/link";

import { BLOCK_DETAILS_ID } from "@/lib/block-details";
import type { FormAction } from "@/lib/form";

import { ActionButton } from "./action-button";
import { CategoryBadge } from "./category-badge";

/**
 * Details eines Blocks in einer veröffentlichten oder archivierten Version. Inhalte sind
 * schreibgeschützt; in der veröffentlichten Version lässt sich der Erledigt-Status ändern.
 */
export function EntryDetails({
  entry,
  status,
  closeHref,
  setCompletion,
}: {
  entry: ScheduleEntry;
  status: WeekStatus;
  closeHref: string;
  setCompletion: (entryId: string, status: CompletionStatus) => FormAction;
}) {
  const when = `${formatLocalDateShort(toLocalDate(new Date(entry.start_at)))} ${formatTimeRange(entry.start_at, entry.end_at)}`;
  return (
    <aside id={BLOCK_DETAILS_ID} className="drawer" aria-labelledby="details-titel">
      <div className="drawer-head">
        <div className="stack-tight">
          <p className="eyebrow">Block</p>
          <h2 id="details-titel">{entry.title}</h2>
          <p className="small muted num">{when}</p>
        </div>
        <Link className="btn btn--ghost btn--icon" href={closeHref} aria-label="Details schließen">
          <X size={20} aria-hidden="true" />
        </Link>
      </div>
      <dl className="details-list">
        <dt>Kategorie</dt>
        <dd>
          <CategoryBadge category={entry.category} />
        </dd>
        <dt>Status</dt>
        <dd>{COMPLETION_STATUS_LABELS[entry.completion_status]}</dd>
        <dt>Quelle</dt>
        <dd>{ENTRY_SOURCE_LABELS[entry.source]}</dd>
        {entry.location ? (
          <>
            <dt>Ort</dt>
            <dd>{entry.location}</dd>
          </>
        ) : null}
        {entry.note ? (
          <>
            <dt>Notiz</dt>
            <dd>{entry.note}</dd>
          </>
        ) : null}
      </dl>
      {status === "published" ? (
        <div className="button-row">
          {entry.completion_status !== "completed" ? (
            <ActionButton
              action={setCompletion(entry.id, "completed")}
              label="Erledigt"
              ariaLabel={`„${entry.title}“ als erledigt markieren`}
            />
          ) : null}
          {entry.completion_status !== "skipped" ? (
            <ActionButton
              action={setCompletion(entry.id, "skipped")}
              label="Ausgelassen"
              variant="ghost"
              ariaLabel={`„${entry.title}“ als ausgelassen markieren`}
            />
          ) : null}
          {entry.completion_status !== "planned" ? (
            <ActionButton
              action={setCompletion(entry.id, "planned")}
              label="Zurücksetzen"
              variant="ghost"
              ariaLabel={`Status von „${entry.title}“ zurücksetzen`}
            />
          ) : null}
        </div>
      ) : (
        <p className="small muted">Archivierte Versionen sind nur zur Ansicht.</p>
      )}
    </aside>
  );
}

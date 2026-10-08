import {
  CATEGORY_LABELS,
  type ScheduleEntry,
  formatLocalDateShort,
  formatTimeRange,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { Trash, X } from "lucide-react";
import Link from "next/link";

import { BLOCK_DETAILS_ID } from "@/lib/block-details";
import type { FormAction } from "@/lib/form";

import { ActionButton } from "./action-button";
import { EntryForm, type EntryFormDefaults } from "./entry-form";

const STEPS = [-30, -15, 15, 30] as const;

function stepLabel(minutes: number): string {
  return `${minutes > 0 ? "+" : "−"}${Math.abs(minutes)}`;
}

/** Bearbeitungsbereich eines Blocks im Entwurf: Formular, Schrittknöpfe, Löschen. */
export function EntryEditor({
  entry,
  days,
  defaults,
  updateAction,
  nudgeAction,
  deleteAction,
  closeHref,
}: {
  entry: ScheduleEntry;
  days: { value: string; label: string }[];
  defaults: EntryFormDefaults;
  updateAction: FormAction;
  /** Verschieben (move) bzw. Dauer ändern (resize) um feste Minutenschritte. */
  nudgeAction: (kind: "move" | "resize", minutes: number) => FormAction;
  deleteAction: FormAction;
  closeHref: string;
}) {
  const when = `${formatLocalDateShort(toLocalDate(new Date(entry.start_at)))} ${formatTimeRange(entry.start_at, entry.end_at)}`;
  return (
    <aside id={BLOCK_DETAILS_ID} className="drawer" aria-labelledby="editor-titel">
      <div className="drawer-head">
        <div className="stack-tight">
          <p className="eyebrow">Block bearbeiten</p>
          <h2 id="editor-titel">{entry.title}</h2>
          <p className="small muted">
            {CATEGORY_LABELS[entry.category]} · {when}
          </p>
        </div>
        <Link
          className="btn btn--ghost btn--icon"
          href={closeHref}
          aria-label="Bearbeitung schließen"
        >
          <X size={20} aria-hidden="true" />
        </Link>
      </div>

      <div className="stack-tight" role="group" aria-labelledby="schritte-titel">
        <p id="schritte-titel" className="field-label">
          Schnell anpassen (Minuten)
        </p>
        <div className="nudge">
          <span className="field-label">Verschieben</span>
          {STEPS.map((minutes) => (
            <ActionButton
              key={`move${minutes}`}
              action={nudgeAction("move", minutes)}
              label={stepLabel(minutes)}
              size="sm"
              ariaLabel={`Um ${Math.abs(minutes)} Minuten ${minutes > 0 ? "später" : "früher"} legen`}
              pendingLabel="…"
            />
          ))}
          <span className="field-label">Dauer</span>
          {STEPS.map((minutes) => (
            <ActionButton
              key={`resize${minutes}`}
              action={nudgeAction("resize", minutes)}
              label={stepLabel(minutes)}
              size="sm"
              ariaLabel={`Um ${Math.abs(minutes)} Minuten ${minutes > 0 ? "verlängern" : "verkürzen"}`}
              pendingLabel="…"
            />
          ))}
        </div>
      </div>

      <EntryForm
        action={updateAction}
        days={days}
        idPrefix={`bearbeiten-${entry.id}`}
        submitLabel="Änderungen speichern"
        defaults={defaults}
        cancelHref={closeHref}
      />

      <div className="button-row">
        <ActionButton
          action={deleteAction}
          label="Block löschen"
          icon={<Trash size={16} aria-hidden="true" />}
          variant="danger"
          confirmMessage={`„${entry.title}“ wirklich löschen?`}
        />
      </div>
    </aside>
  );
}

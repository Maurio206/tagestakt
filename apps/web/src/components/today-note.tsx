"use client";

import { type DailyNoteSnapshot, type LocalDate, notePreview } from "@tagestakt/schedule-schema";
import { ChevronDown, NotebookPen } from "lucide-react";
import { useState } from "react";

import type { SaveDailyNote } from "@/lib/daily-note";

import { DailyNoteEditor } from "./daily-note-editor";

/**
 * Kompakter Zugang zur Tagesnotiz von heute auf der Übersicht: eine Zeile, aufklappbar zum
 * Editor – kein dauerhaft großer Editor auf der Startseite.
 *
 * Wechselt der Tag (Mitternacht, automatisches Aktualisieren), während ungespeicherte Änderungen
 * bestehen, bleibt der Editor beim bisherigen Tag – der Text wird nie einem anderen Tag
 * zugeordnet. Erst ohne offene Änderungen folgt er dem neuen Tag.
 */
export function TodayNote({
  date,
  dateLabel,
  note,
  loadError = false,
  save,
}: {
  date: LocalDate;
  dateLabel: string;
  note: DailyNoteSnapshot | null;
  loadError?: boolean;
  save: SaveDailyNote;
}) {
  const [unsaved, setUnsaved] = useState(false);
  const [shown, setShown] = useState({ date, dateLabel, note });
  if (shown.date === date ? shown.note !== note : !unsaved) {
    setShown({ date, dateLabel, note });
  }
  const isToday = shown.date === date;

  const summary = loadError
    ? "Tagesnotiz konnte nicht geladen werden."
    : !isToday
      ? `Noch nicht gespeichert – Notiz für ${shown.dateLabel}.`
      : shown.note
        ? notePreview(shown.note.content)
        : "Noch keine Notiz für heute.";
  return (
    <details className="note-details">
      <summary className="note-row">
        <NotebookPen size={20} aria-hidden="true" className="icon" />
        <span className="note-row-main">
          <b>Tagesnotiz · {isToday ? "heute" : shown.dateLabel}</b>
          <small>{summary}</small>
        </span>
        <ChevronDown size={18} aria-hidden="true" className="icon note-row-chevron" />
      </summary>
      <div className="note-details-body">
        {loadError && isToday ? (
          <p className="muted">Bitte die Seite neu laden. Es wurde nichts verändert.</p>
        ) : (
          <DailyNoteEditor
            key={shown.date}
            date={shown.date}
            dateLabel={shown.dateLabel}
            initialNote={shown.note}
            save={save}
            onUnsavedChange={setUnsaved}
          />
        )}
      </div>
    </details>
  );
}

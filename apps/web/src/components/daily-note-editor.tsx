"use client";

import {
  DAILY_NOTE_MAX_LENGTH,
  DAILY_NOTE_MESSAGES,
  type DailyNoteSnapshot,
  type LocalDate,
  type NoteEditorState,
  canSaveNote,
  countNoteCharacters,
  createNoteEditorState,
  describeNoteStatus,
  isNoteDirty,
  noteEditorReducer,
  normalizeNoteContent,
  prepareNoteSave,
} from "@tagestakt/schedule-schema";
import { CircleCheck, Dot, LoaderCircle, NotebookPen, TriangleAlert } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useReducer } from "react";

import type { SaveDailyNote } from "@/lib/daily-note";

import { buttonClass } from "./ui";

const STATUS_ICONS = {
  neutral: NotebookPen,
  dirty: Dot,
  busy: LoaderCircle,
  success: CircleCheck,
  error: TriangleAlert,
  warning: TriangleAlert,
} as const;

const NUMBER = new Intl.NumberFormat("de-DE");

const LEAVE_MESSAGE = "Die Tagesnotiz ist noch nicht gespeichert. Trotzdem wechseln?";

/**
 * Tagesnotiz eines Kalendertags: reiner Text, ausdrückliches Speichern mit sichtbarem Status.
 * Der eingegebene Text wird nie durch eine Serverantwort ersetzt; bei Fehlern und Konflikten
 * bleibt er erhalten. Es läuft höchstens eine Speicherung gleichzeitig.
 */
export function DailyNoteEditor({
  date,
  dateLabel,
  initialNote,
  save,
  headingLevel = 3,
  onUnsavedChange,
}: {
  date: LocalDate;
  /** „Mittwoch, 14. Oktober“ */
  dateLabel: string;
  initialNote: DailyNoteSnapshot | null;
  save: SaveDailyNote;
  headingLevel?: 2 | 3;
  /** Meldet ungespeicherte Änderungen (z. B. damit die Übersicht um Mitternacht nicht den Tag wechselt). */
  onUnsavedChange?: (unsaved: boolean) => void;
}) {
  const id = useId();
  const [state, dispatch] = useReducer(noteEditorReducer, initialNote, createNoteEditorState);

  // Neuer Serverstand (z. B. automatisches Aktualisieren) – nur ohne ungespeicherte Änderungen.
  useEffect(() => {
    dispatch({ type: "server_update", note: initialNote });
  }, [initialNote]);

  const unsaved = isNoteDirty(state) || state.status === "saving" || state.status === "conflict";
  useEffect(() => {
    onUnsavedChange?.(unsaved);
  }, [unsaved, onUnsavedChange]);

  // Kein stiller Verlust beim Schließen, Neuladen oder Wechseln der Seite bzw. des Tages.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // Links innerhalb der Website (Client-Navigation) lösen kein „beforeunload“ aus.
    const confirmLeave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (link.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Andere Formulare der Seite (z. B. Plan bearbeiten) laden die Seite neu bzw. leiten um.
    const confirmSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form || event.defaultPrevented) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", confirmLeave, true);
    document.addEventListener("submit", confirmSubmit, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", confirmLeave, true);
      document.removeEventListener("submit", confirmSubmit, true);
    };
  }, [unsaved]);

  async function runSave(from: NoteEditorState) {
    const request = prepareNoteSave(from, date);
    if (!request) return;
    dispatch({
      type: "save_started",
      requestId: request.requestId,
      content: request.input.content,
    });
    try {
      const result = await save(request.input);
      if (result.status === "saved") {
        dispatch({
          type: "save_succeeded",
          requestId: request.requestId,
          note: result.note,
          at: result.at,
        });
      } else if (result.status === "conflict") {
        dispatch({ type: "save_conflict", requestId: request.requestId, latest: result.latest });
      } else {
        dispatch({ type: "save_failed", requestId: request.requestId, message: result.message });
      }
    } catch {
      // Netzwerkfehler (z. B. offline): Text bleibt, erneut speichern ist möglich.
      dispatch({
        type: "save_failed",
        requestId: request.requestId,
        message: DAILY_NOTE_MESSAGES.offline,
      });
    }
  }

  function keepMine() {
    const next = noteEditorReducer(state, { type: "keep_mine" });
    dispatch({ type: "keep_mine" });
    void runSave(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void runSave(state);
    }
  }

  const status = describeNoteStatus(state);
  const StatusIcon = STATUS_ICONS[status.tone];
  const count = countNoteCharacters(normalizeNoteContent(state.draft));
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const saving = state.status === "saving";

  return (
    <section className="note" aria-labelledby={`${id}-titel`} aria-busy={saving}>
      <div className="note-head">
        <Heading id={`${id}-titel`}>{dateLabel}</Heading>
        <span
          className={count > DAILY_NOTE_MAX_LENGTH ? "note-count note-count--over" : "note-count"}
        >
          {NUMBER.format(count)} / {NUMBER.format(DAILY_NOTE_MAX_LENGTH)}
          <span className="visually-hidden"> Zeichen</span>
        </span>
      </div>
      <label className="visually-hidden" htmlFor={`${id}-text`}>
        Tagesnotiz für {dateLabel}
      </label>
      <textarea
        id={`${id}-text`}
        name="content"
        className={status.tone === "error" ? "note-area is-error" : "note-area"}
        rows={7}
        value={state.draft}
        placeholder="Was ist an diesem Tag wichtig? Nur für dich sichtbar."
        spellCheck
        autoComplete="off"
        aria-invalid={status.tone === "error" ? true : undefined}
        aria-describedby={`${id}-status ${id}-hinweis`}
        onChange={(event) => dispatch({ type: "edit", text: event.target.value })}
        onKeyDown={onKeyDown}
      />
      <div className="note-foot">
        <p
          id={`${id}-status`}
          className={`note-status note-status--${status.tone}`}
          role={status.tone === "error" || status.tone === "warning" ? "alert" : "status"}
        >
          <StatusIcon
            size={16}
            aria-hidden="true"
            className={status.tone === "busy" ? "icon icon--spin" : "icon"}
          />
          {status.text}
        </p>
        {state.status === "conflict" ? (
          <div className="note-conflict">
            <p className="field-label" id={`${id}-andere`}>
              {state.conflict
                ? "Andere gespeicherte Fassung:"
                : "Die Notiz wurde andernorts entfernt."}
            </p>
            {state.conflict ? (
              <div
                className="note-conflict-text"
                role="region"
                aria-labelledby={`${id}-andere`}
                tabIndex={0}
              >
                {state.conflict.content}
              </div>
            ) : null}
            <div className="button-row">
              <button type="button" className={buttonClass("primary")} onClick={keepMine}>
                Meine Fassung speichern
              </button>
              <button
                type="button"
                className={buttonClass("secondary")}
                onClick={() => dispatch({ type: "use_latest" })}
              >
                Gespeicherte Fassung laden
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={buttonClass(
              state.status === "error" || isNoteDirty(state) ? "primary" : "secondary",
            )}
            disabled={!canSaveNote(state)}
            aria-disabled={!canSaveNote(state)}
            onClick={() => void runSave(state)}
          >
            {saving
              ? "Wird gespeichert …"
              : state.status === "error"
                ? "Erneut speichern"
                : "Speichern"}
          </button>
        )}
      </div>
      <p id={`${id}-hinweis`} className="small subtle">
        Reiner Text, höchstens 10 000 Zeichen. Leeren und speichern entfernt die Notiz. Speichern
        auch mit Strg + S.
      </p>
    </section>
  );
}

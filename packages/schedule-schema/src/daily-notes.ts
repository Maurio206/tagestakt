/**
 * Tagesnotizen: eine persönliche Notiz (reiner Text) je Kalendertag. Gemeinsame Regeln für
 * Web und App – Normalisierung, Schemas, Fehlertexte und der Zustandsautomat des Editors.
 *
 * Datenschutz: Notizinhalte erscheinen nie in Fehlermeldungen, Logs oder Benachrichtigungen;
 * die App speichert sie nicht im Offline-Cache.
 */
import { z } from "zod";

import { formatTime } from "./format";
import { idSchema, localDateSchema, timestampSchema } from "./schemas";
import { type LocalDate } from "./time";

/** Höchstlänge in Zeichen (Unicode-Codepoints, wie `char_length` in Postgres). */
export const DAILY_NOTE_MAX_LENGTH = 10_000;

/** SQLSTATE der RPC `save_daily_note`, wenn die Notiz inzwischen anderswo geändert wurde. */
export const DAILY_NOTE_CONFLICT_CODE = "TT007";

/** Gültiger Datumsbereich (entspricht dem Check-Constraint der Tabelle). */
export const DAILY_NOTE_MIN_DATE: LocalDate = "2000-01-01";
export const DAILY_NOTE_MAX_DATE: LocalDate = "2099-12-31";

export const DAILY_NOTE_MESSAGES = {
  tooLong: "Die Notiz ist zu lang (höchstens 10 000 Zeichen).",
  conflict: "Diese Notiz wurde inzwischen an anderer Stelle geändert.",
  offline: "Keine Verbindung. Dein Text bleibt hier erhalten – bitte später erneut speichern.",
  failed: "Nicht gespeichert. Bitte erneut versuchen – dein Text bleibt hier erhalten.",
  invalidDate: "Ungültiges Datum.",
} as const;

/** Anzahl Zeichen wie in der Datenbank (Emoji zählen als ein Zeichen). */
export function countNoteCharacters(text: string): number {
  return Array.from(text).length;
}

// Steuerzeichen außer Tabulator (U+0009) und Zeilenumbruch (U+000A).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Normalisiert eine Eingabe: einheitliche Zeilenumbrüche (\n), Unicode-NFC, keine Steuerzeichen,
 * kein Leerraum am Anfang und Ende. Zeilenumbrüche und Leerzeichen innerhalb bleiben erhalten.
 * Das Ergebnis ist reiner Text – es wird nie als HTML interpretiert.
 */
export function normalizeNoteContent(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").normalize("NFC").replace(CONTROL_CHARACTERS, "").trim();
}

/** Leer bzw. nur Leerraum: Speichern entfernt die Notiz. */
export function isBlankNote(raw: string): boolean {
  return normalizeNoteContent(raw) === "";
}

export const noteDateSchema = localDateSchema.refine(
  (date) => date >= DAILY_NOTE_MIN_DATE && date <= DAILY_NOTE_MAX_DATE,
  { error: DAILY_NOTE_MESSAGES.invalidDate },
);

export const dailyNoteContentSchema = z
  .string({ error: "Ungültiger Inhalt" })
  .transform(normalizeNoteContent)
  .refine((value) => countNoteCharacters(value) <= DAILY_NOTE_MAX_LENGTH, {
    error: DAILY_NOTE_MESSAGES.tooLong,
  });

/** Stand, auf dem gespeichert wird: zuletzt gelesene Notiz oder `null` („es gab noch keine“). */
export const dailyNoteVersionSchema = z
  .object({ id: idSchema, revision: z.number().int().positive() })
  .nullable();

export const dailyNoteSaveInputSchema = z.object({
  date: noteDateSchema,
  content: dailyNoteContentSchema,
  expected: dailyNoteVersionSchema,
});
export type DailyNoteSaveInput = z.input<typeof dailyNoteSaveInputSchema>;
export type DailyNoteSaveInputParsed = z.output<typeof dailyNoteSaveInputSchema>;

export const dailyNoteRowSchema = z.object({
  id: idSchema,
  owner_id: idSchema,
  note_date: localDateSchema,
  content: z.string(),
  revision: z.number().int().positive(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type DailyNote = z.infer<typeof dailyNoteRowSchema>;

/** Was die Oberfläche von einer gespeicherten Notiz braucht. */
export interface DailyNoteSnapshot {
  id: string;
  revision: number;
  content: string;
  updatedAt: string;
}

export function toNoteSnapshot(
  row: Pick<DailyNote, "id" | "revision" | "content" | "updated_at">,
): DailyNoteSnapshot {
  return { id: row.id, revision: row.revision, content: row.content, updatedAt: row.updated_at };
}

/**
 * Ergebnis eines Speicherversuchs (Web: Server Action, App: RPC) – ohne interne Details.
 * `saved` mit `note: null` heißt: leerer Inhalt, Notiz entfernt.
 */
export type DailyNoteSaveResult =
  | { status: "saved"; note: DailyNoteSnapshot | null; at: string }
  | { status: "conflict"; latest: DailyNoteSnapshot | null }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Zustandsautomat des Editors (Web und App)
// ---------------------------------------------------------------------------

export type NoteEditorStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export interface NoteEditorState {
  /** Text im Eingabefeld – wird nie durch eine Serverantwort ersetzt (kein stiller Verlust). */
  draft: string;
  /** Zuletzt bekannter Stand auf dem Server (`null` = keine Notiz). */
  saved: DailyNoteSnapshot | null;
  status: NoteEditorStatus;
  /** Laufende Speicherung; Antworten älterer Anfragen werden ignoriert. */
  pending: { requestId: number; content: string } | null;
  lastRequestId: number;
  /** Anzeigbare Fehlermeldung (ohne Notizinhalt). */
  error: string | null;
  /** Fassung auf dem Server bei einem Konflikt (`null` = dort inzwischen entfernt). */
  conflict: DailyNoteSnapshot | null;
  /** Zeitpunkt (ISO) des letzten erfolgreichen Speicherns in dieser Sitzung. */
  savedAt: string | null;
}

export type NoteEditorEvent =
  | { type: "edit"; text: string }
  | { type: "save_started"; requestId: number; content: string }
  | { type: "save_succeeded"; requestId: number; note: DailyNoteSnapshot | null; at: string }
  | { type: "save_failed"; requestId: number; message: string }
  | { type: "save_conflict"; requestId: number; latest: DailyNoteSnapshot | null }
  | { type: "keep_mine" }
  | { type: "use_latest" }
  | { type: "server_update"; note: DailyNoteSnapshot | null };

export function createNoteEditorState(note: DailyNoteSnapshot | null): NoteEditorState {
  return {
    draft: note?.content ?? "",
    saved: note,
    status: "idle",
    pending: null,
    lastRequestId: 0,
    error: null,
    conflict: null,
    savedAt: null,
  };
}

/** Unterscheidet sich der (normalisierte) Text vom gespeicherten Stand? */
export function isNoteDirty(state: Pick<NoteEditorState, "draft" | "saved">): boolean {
  return normalizeNoteContent(state.draft) !== (state.saved?.content ?? "");
}

export function isNoteTooLong(draft: string): boolean {
  return countNoteCharacters(normalizeNoteContent(draft)) > DAILY_NOTE_MAX_LENGTH;
}

export function canSaveNote(state: NoteEditorState): boolean {
  return (
    state.pending === null &&
    state.status !== "conflict" &&
    !isNoteTooLong(state.draft) &&
    (isNoteDirty(state) || state.status === "error")
  );
}

/**
 * Bereitet eine Speicherung vor: liefert die Anfrage (normalisierter Inhalt, erwarteter Stand)
 * oder `null`, wenn gerade nicht gespeichert werden kann. Es läuft immer höchstens eine
 * Speicherung – jede weitere baut auf deren Ergebnis auf.
 */
export function prepareNoteSave(
  state: NoteEditorState,
  date: LocalDate,
): { requestId: number; input: DailyNoteSaveInputParsed } | null {
  if (!canSaveNote(state)) return null;
  const requestId = state.lastRequestId + 1;
  return {
    requestId,
    input: {
      date,
      content: normalizeNoteContent(state.draft),
      expected: state.saved ? { id: state.saved.id, revision: state.saved.revision } : null,
    },
  };
}

function settle(state: NoteEditorState): NoteEditorStatus {
  return isNoteDirty(state) ? "dirty" : "saved";
}

export function noteEditorReducer(state: NoteEditorState, event: NoteEditorEvent): NoteEditorState {
  switch (event.type) {
    case "edit": {
      const next = { ...state, draft: event.text };
      if (state.status === "saving" || state.status === "conflict") return next;
      return { ...next, status: isNoteDirty(next) ? "dirty" : state.savedAt ? "saved" : "idle" };
    }
    case "save_started":
      return {
        ...state,
        status: "saving",
        error: null,
        pending: { requestId: event.requestId, content: event.content },
        lastRequestId: Math.max(state.lastRequestId, event.requestId),
      };
    case "save_succeeded": {
      if (state.pending?.requestId !== event.requestId) return state;
      const next = {
        ...state,
        saved: event.note,
        pending: null,
        error: null,
        conflict: null,
        savedAt: event.at,
      };
      return { ...next, status: settle(next) };
    }
    case "save_failed":
      if (state.pending?.requestId !== event.requestId) return state;
      return { ...state, pending: null, status: "error", error: event.message };
    case "save_conflict": {
      if (state.pending?.requestId !== event.requestId) return state;
      // Steht auf dem Server bereits genau dieser Text (z. B. Antwort ging verloren, erneuter
      // Versuch meldet „veraltet“), ist das kein Konflikt, sondern gespeichert.
      if ((event.latest?.content ?? "") === state.pending.content) {
        const next = {
          ...state,
          saved: event.latest,
          pending: null,
          error: null,
          conflict: null,
          savedAt: event.latest?.updatedAt ?? state.savedAt,
        };
        return { ...next, status: settle(next) };
      }
      return { ...state, pending: null, status: "conflict", conflict: event.latest, error: null };
    }
    case "keep_mine": {
      // Eigene Fassung bleibt; gespeichert wird beim nächsten Mal auf dem neuesten Serverstand.
      if (state.status !== "conflict") return state;
      const next = { ...state, saved: state.conflict, conflict: null };
      return { ...next, status: isNoteDirty(next) ? "dirty" : "saved" };
    }
    case "use_latest": {
      if (state.status !== "conflict") return state;
      return {
        ...state,
        draft: state.conflict?.content ?? "",
        saved: state.conflict,
        conflict: null,
        status: "idle",
      };
    }
    case "server_update": {
      // Neuer Serverstand (z. B. nach Aktualisieren): nur übernehmen, wenn nichts verloren geht.
      // Gleicher Stand (dieselbe Fassung) ändert nichts – sonst würde z. B. ein gerade getipptes
      // Leerzeichen am Ende durch die normalisierte Serverfassung ersetzt.
      const same =
        state.saved?.id === event.note?.id && state.saved?.revision === event.note?.revision;
      // Eine ältere Fassung derselben Notiz (z. B. verspätete Abfrage) ersetzt nie eine neuere.
      const older =
        state.saved !== null &&
        event.note !== null &&
        state.saved.id === event.note.id &&
        event.note.revision < state.saved.revision;
      if (same || older || state.pending || state.status === "conflict" || isNoteDirty(state)) {
        return state;
      }
      return { ...state, saved: event.note, draft: event.note?.content ?? "" };
    }
  }
}

export type NoteStatusTone = "neutral" | "dirty" | "busy" | "success" | "error" | "warning";

/** Statuszeile des Editors – identische Texte in Web und App, nie mit Notizinhalt. */
export function describeNoteStatus(state: NoteEditorState): { tone: NoteStatusTone; text: string } {
  if (isNoteTooLong(state.draft) && state.status !== "saving") {
    return { tone: "error", text: DAILY_NOTE_MESSAGES.tooLong };
  }
  switch (state.status) {
    case "saving":
      return { tone: "busy", text: "Wird gespeichert …" };
    case "error":
      return { tone: "error", text: state.error ?? DAILY_NOTE_MESSAGES.failed };
    case "conflict":
      return {
        tone: "warning",
        text: `${DAILY_NOTE_MESSAGES.conflict} Dein Text wurde nicht gespeichert und bleibt hier erhalten.`,
      };
    case "dirty":
      return { tone: "dirty", text: "Nicht gespeicherte Änderungen" };
    case "saved":
      if (!state.saved) return { tone: "success", text: "Notiz entfernt." };
      return {
        tone: "success",
        text: `Gespeichert um ${formatTime(state.savedAt ?? state.saved.updatedAt)} Uhr`,
      };
    case "idle":
      return state.saved
        ? {
            tone: "neutral",
            text: `Zuletzt gespeichert um ${formatTime(state.saved.updatedAt)} Uhr`,
          }
        : { tone: "neutral", text: "Noch keine Notiz für diesen Tag." };
  }
}

/** Kurze Vorschau für kompakte Zugänge (erste Zeile, gekürzt). */
export function notePreview(content: string, maxLength = 80): string {
  const firstLine = normalizeNoteContent(content).split("\n")[0] ?? "";
  const chars = Array.from(firstLine);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join("")}…` : firstLine;
}

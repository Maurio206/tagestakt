import { ACTIVITY_ERROR_MESSAGES, isActivityErrorCode } from "@tagestakt/schedule-schema";

/** Fehler eines Schreibzugriffs mit einer Meldung, die gefahrlos angezeigt werden darf. */
export class WriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteError";
  }
}

export const OFFLINE_MESSAGE =
  "Keine Verbindung. Starten, Beenden und Bearbeiten sind erst wieder mit Verbindung möglich.";

interface DatabaseErrorLike {
  code?: string;
  message?: string;
}

/**
 * Übersetzt Supabase-/Netzwerkfehler in deutsche Meldungen ohne interne Details.
 * Eigene Trigger-Meldungen (deutsch, ohne Tabellennamen) dürfen angezeigt werden.
 */
export function toWriteError(error: unknown, fallback = "Speichern fehlgeschlagen."): WriteError {
  if (error instanceof WriteError) return error;
  const db = (typeof error === "object" && error !== null ? error : {}) as DatabaseErrorLike;
  if (isActivityErrorCode(db.code)) return new WriteError(ACTIVITY_ERROR_MESSAGES[db.code]);
  if (db.code === "23505") return new WriteError(ACTIVITY_ERROR_MESSAGES.TT001);
  if (db.code === "42501") return new WriteError("Keine Berechtigung für diese Aktion.");
  if ((db.code === "P0001" || db.code === "P0002" || db.code === "22023") && db.message) {
    return new WriteError(db.message);
  }
  if (db.code === "23514" && db.message && !db.message.includes("violates")) {
    return new WriteError(db.message);
  }
  if (error instanceof TypeError || /network|fetch/i.test(db.message ?? "")) {
    return new WriteError(OFFLINE_MESSAGE);
  }
  return new WriteError(fallback);
}

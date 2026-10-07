import "server-only";

import { ACTIVITY_ERROR_MESSAGES, isActivityErrorCode } from "@tagestakt/schedule-schema";

/** Fachlicher Fehler mit einer Meldung, die gefahrlos angezeigt werden darf. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

interface DatabaseErrorLike {
  code?: string;
  message?: string;
}

/** Meldungen unserer eigenen Trigger/Funktionen enthalten keine internen Details. */
const OWN_MESSAGE_CODES = new Set(["P0001", "P0002", "22023"]);

/**
 * Übersetzt Datenbankfehler in verständliche deutsche Meldungen, ohne interne
 * Details (Tabellen-, Constraint- oder Spaltennamen) preiszugeben.
 * Protokolliert wird nur der Fehlercode – niemals Termininhalte oder Tokens.
 */
export function toUserFacingError(operation: string, error: DatabaseErrorLike): UserFacingError {
  console.error(`[tagestakt] ${operation} fehlgeschlagen`, { code: error.code ?? "unbekannt" });

  const message = error.message ?? "";
  // Fehlercodes der Aktivitäts-RPCs (TT001–TT006) → feste, geprüfte Texte.
  if (isActivityErrorCode(error.code)) {
    return new UserFacingError(ACTIVITY_ERROR_MESSAGES[error.code]);
  }
  if (error.code && OWN_MESSAGE_CODES.has(error.code) && message) {
    return new UserFacingError(message);
  }
  if (error.code === "23514") {
    // Eigene Trigger-Meldungen (deutsch) dürfen angezeigt werden, Postgres-Standardtexte nicht.
    return new UserFacingError(
      message && !message.includes("violates")
        ? message
        : "Die Eingabe verletzt eine Planregel. Bitte Zeiten und Angaben prüfen.",
    );
  }
  if (error.code === "23505") {
    return new UserFacingError("Für diese Woche existiert bereits ein Entwurf.");
  }
  if (error.code === "23503") {
    return new UserFacingError("Der zugehörige Wochenplan wurde nicht gefunden.");
  }
  if (error.code === "42501") {
    return new UserFacingError("Keine Berechtigung für diese Aktion.");
  }
  return new UserFacingError("Speichern fehlgeschlagen. Bitte später erneut versuchen.");
}

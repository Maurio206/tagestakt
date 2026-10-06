export interface AuthErrorLike {
  code?: string | undefined;
  status?: number | undefined;
  name?: string | undefined;
}

/** Deutsche, kontoneutrale Fehlermeldungen für die Anmeldung. */
export function loginErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return "Anmeldung fehlgeschlagen. Bitte erneut versuchen.";
  if (error.code === "invalid_credentials" || error.code === "user_not_found") {
    return "E-Mail oder Passwort ist falsch.";
  }
  if (error.code === "email_not_confirmed") return "Die E-Mail-Adresse ist noch nicht bestätigt.";
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Zu viele Anmeldeversuche. Bitte warte einige Minuten.";
  }
  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (error.status ?? 0) >= 500
  ) {
    return "Keine Verbindung zum Server. Bitte Internetverbindung prüfen.";
  }
  return "Anmeldung fehlgeschlagen. Bitte erneut versuchen.";
}

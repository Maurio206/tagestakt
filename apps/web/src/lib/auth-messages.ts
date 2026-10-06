/** Minimal benötigte Form eines Supabase-Auth-Fehlers. */
export interface AuthErrorLike {
  code?: string | undefined;
  status?: number | undefined;
  name?: string | undefined;
}

/**
 * Verständliche deutsche Meldungen für Anmeldefehler. Bewusst ohne Unterscheidung
 * zwischen „E-Mail unbekannt“ und „Passwort falsch“, um keine Konten preiszugeben.
 */
export function loginErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return "Anmeldung fehlgeschlagen. Bitte erneut versuchen.";
  if (error.code === "invalid_credentials" || error.code === "user_not_found") {
    return "E-Mail oder Passwort ist falsch.";
  }
  if (error.code === "email_not_confirmed") {
    return "Die E-Mail-Adresse ist noch nicht bestätigt.";
  }
  if (error.code === "email_provider_disabled") {
    return "Die Anmeldung per E-Mail ist im Supabase-Projekt deaktiviert (siehe docs/setup.md).";
  }
  if (error.code === "user_banned") {
    return "Dieses Konto ist gesperrt.";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Zu viele Anmeldeversuche. Bitte warte einige Minuten.";
  }
  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (error.status ?? 0) >= 500
  ) {
    return "Der Anmeldedienst ist gerade nicht erreichbar. Bitte später erneut versuchen.";
  }
  return "Anmeldung fehlgeschlagen. Bitte erneut versuchen.";
}

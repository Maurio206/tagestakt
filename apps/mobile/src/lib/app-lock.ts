import * as LocalAuthentication from "expo-local-authentication";

/**
 * App-Sperre – ausschließlich lokal auf dem Gerät (Fingerabdruck, Gesicht oder Geräte-PIN).
 * Es werden keine biometrischen Daten gelesen oder übertragen; das Betriebssystem meldet
 * nur „erfolgreich“ oder „nicht erfolgreich“. Standard: ausgeschaltet.
 */

export interface AppLockSettings {
  enabled: boolean;
  timeoutSeconds: number;
}

/** Kaltstart: bei aktiver Sperre immer zuerst entsperren. */
export function shouldLockOnColdStart(settings: AppLockSettings): boolean {
  return settings.enabled;
}

/**
 * Rückkehr aus dem Hintergrund: sperren, wenn die App mindestens `timeoutSeconds` im
 * Hintergrund war (0 = sofort). Ohne bekannten Zeitpunkt wird vorsichtshalber gesperrt.
 */
export function shouldLockOnResume(
  settings: AppLockSettings,
  backgroundedAt: number | null,
  now: number,
): boolean {
  if (!settings.enabled) return false;
  if (backgroundedAt === null) return true;
  return now - backgroundedAt >= settings.timeoutSeconds * 1000;
}

export type LockAvailability = "available" | "no-device-security" | "unavailable";

/**
 * Prüft, ob das Gerät entsperren kann: Biometrie oder mindestens eine Geräte-PIN/-Muster
 * (PIN-Ausweichmöglichkeit). Ohne Bildschirmsperre lässt sich die App-Sperre nicht aktivieren.
 */
export async function getLockAvailability(): Promise<LockAvailability> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return "no-device-security";
    return "available";
  } catch {
    return "unavailable";
  }
}

let systemPrompts = 0;

/**
 * Läuft gerade ein Systemdialog dieser App (Entsperren, Berechtigung)? Die PIN-Eingabe von
 * Android ist eine eigene Activity und schickt die App dabei in den Hintergrund – das darf
 * keine erneute Sperre auslösen.
 */
export function isSystemPromptActive(): boolean {
  return systemPrompts > 0;
}

/** Führt einen Systemdialog aus, ohne dass der kurze Wechsel in den Hintergrund sperrt. */
export async function withSystemPrompt<T>(operation: () => Promise<T>): Promise<T> {
  systemPrompts += 1;
  try {
    return await operation();
  } finally {
    systemPrompts -= 1;
  }
}

export interface UnlockResult {
  success: boolean;
  /** Verständlicher Grund bei Misserfolg (ohne technische Details). */
  message?: string;
}

/** Fordert die Entsperrung an; Geräte-PIN ist als Ausweichmöglichkeit erlaubt. */
export async function requestUnlock(promptMessage = "TagesTakt entsperren"): Promise<UnlockResult> {
  try {
    const result = await withSystemPrompt(() =>
      LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: "Abbrechen",
        disableDeviceFallback: false,
      }),
    );
    if (result.success) return { success: true };
    switch (result.error) {
      case "user_cancel":
      case "system_cancel":
      case "app_cancel":
        return { success: false, message: "Entsperren abgebrochen." };
      case "lockout":
        return {
          success: false,
          message: "Zu viele Versuche. Bitte das Gerät mit PIN entsperren und erneut versuchen.",
        };
      case "not_enrolled":
      case "passcode_not_set":
        return {
          success: false,
          message: "Auf diesem Gerät ist keine Bildschirmsperre eingerichtet.",
        };
      default:
        return { success: false, message: "Entsperren nicht möglich. Bitte erneut versuchen." };
    }
  } catch {
    return { success: false, message: "Entsperren nicht möglich. Bitte erneut versuchen." };
  }
}

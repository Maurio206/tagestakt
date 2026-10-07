import "server-only";

import { unstable_rethrow } from "next/navigation";

/**
 * Lädt einen Seitenteil, ohne bei einem Fehler die ganze Seite abzubrechen: Die Seite zeigt
 * dann einen Hinweis an dieser Stelle. Weiterleitungen (z. B. abgelaufene Sitzung) bleiben
 * wirksam. Fehlerdetails protokolliert bereits die Data-Access-Schicht (nur Fehlercodes).
 */
export async function settle<T>(
  promise: Promise<T>,
  fallback: T,
): Promise<{ value: T; failed: boolean }> {
  try {
    return { value: await promise, failed: false };
  } catch (error) {
    unstable_rethrow(error);
    return { value: fallback, failed: true };
  }
}

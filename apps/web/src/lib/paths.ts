/** URL-Aufbau (nur feste, interne Pfade – keine offenen Redirects). */

import { DAILY_NOTE_ANCHOR } from "./daily-note";

/** Feste Erfolgshinweise; über die URL werden nur diese Schlüssel transportiert. */
export const NOTICES = {
  veroeffentlicht:
    "Der Entwurf wurde veröffentlicht. Die App zeigt ab der nächsten Synchronisierung diese Version.",
  entwurf:
    "Entwurf geöffnet. Änderungen werden sofort im Entwurf gespeichert und erst nach dem Veröffentlichen in der App sichtbar.",
  verworfen: "Der Entwurf wurde verworfen.",
  gespeichert: "Änderung gespeichert.",
  verschoben: "Block geändert.",
  rueckgaengig: "Änderung rückgängig gemacht.",
  korrigiert: "Zeit korrigiert.",
} as const;

export type NoticeKey = keyof typeof NOTICES;

export function noticeText(key: string | undefined): string | undefined {
  return key && key in NOTICES ? NOTICES[key as NoticeKey] : undefined;
}

export function weekPlanPath(
  weekStart: string,
  options: {
    versionId?: string;
    editEntryId?: string;
    notice?: NoticeKey;
    /** Rückgängig nach dem Verschieben: Block und vorherige Zeiten. */
    undo?: { entryId: string; startAt: string; endAt: string };
    /** Tagesnotiz dieses Tages öffnen (springt zum Abschnitt „Tagesnotiz“). */
    noteDate?: string;
  } = {},
): string {
  const params = new URLSearchParams({ woche: weekStart });
  if (options.versionId) params.set("version", options.versionId);
  if (options.editEntryId) params.set("bearbeiten", options.editEntryId);
  if (options.notice) params.set("hinweis", options.notice);
  if (options.undo) {
    params.set("rueckgaengig", options.undo.entryId);
    params.set("vorher", `${options.undo.startAt}_${options.undo.endAt}`);
  }
  if (options.noteDate) params.set("notiz", options.noteDate);
  const anchor = options.noteDate ? `#${DAILY_NOTE_ANCHOR}` : "";
  return `/wochenplan?${params.toString()}${anchor}`;
}

/** Wochenplanung (Entwurfsprüfung) einer Woche (optional mit festem Hinweis). */
export function planPath(weekStart: string, notice?: NoticeKey): string {
  const params = new URLSearchParams({ woche: weekStart });
  if (notice) params.set("hinweis", notice);
  return `/planen?${params.toString()}`;
}

export function evaluationPath(
  weekStart: string,
  options: { correctId?: string; notice?: NoticeKey } = {},
): string {
  const params = new URLSearchParams({ woche: weekStart });
  if (options.correctId) params.set("korrigieren", options.correctId);
  if (options.notice) params.set("hinweis", options.notice);
  return `/auswertung?${params.toString()}`;
}

/** Zustimmungsseite des Claude-Connectors (OAuth-Autorisierung). */
export const AUTHORIZE_PATH = "/oauth/authorize";

/** Öffentliche Connector-Endpunkte: eigene Authentifizierung (OAuth), keine Website-Sitzung. */
export function isConnectorApiPath(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname === "/api/oauth/token" ||
    pathname === "/api/oauth/revoke" ||
    pathname.startsWith("/.well-known/")
  );
}

const RETURN_BASE = "https://tagestakt.invalid";

/**
 * Rücksprung nach der Anmeldung – ausschließlich zur Connector-Freigabe derselben Website.
 * Alles andere (fremde Hosts, andere Pfade, `//…`) wird verworfen: keine offenen Redirects.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > 4096 || !value.startsWith(`${AUTHORIZE_PATH}?`)) return null;
  let url: URL;
  try {
    url = new URL(value, RETURN_BASE);
  } catch {
    return null;
  }
  if (url.origin !== RETURN_BASE || url.pathname !== AUTHORIZE_PATH) return null;
  return `${url.pathname}${url.search}`;
}

export function loginPathWithReturn(returnPath: string | null): string {
  return returnPath ? `/login?${new URLSearchParams({ weiter: returnPath }).toString()}` : "/login";
}

/** Liest „vorher“ (`start_ende` als ISO-Zeitstempel) aus der URL; ungültig → undefined. */
export function parseUndoTimes(
  value: string | undefined,
): { startAt: string; endAt: string } | undefined {
  if (!value) return undefined;
  const [startAt, endAt, ...rest] = value.split("_");
  if (!startAt || !endAt || rest.length > 0) return undefined;
  if (Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt))) return undefined;
  return { startAt, endAt };
}

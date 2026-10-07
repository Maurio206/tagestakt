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

export function evaluationPath(
  weekStart: string,
  options: { correctId?: string; notice?: NoticeKey } = {},
): string {
  const params = new URLSearchParams({ woche: weekStart });
  if (options.correctId) params.set("korrigieren", options.correctId);
  if (options.notice) params.set("hinweis", options.notice);
  return `/auswertung?${params.toString()}`;
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

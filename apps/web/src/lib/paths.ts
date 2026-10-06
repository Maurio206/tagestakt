/** URL-Aufbau für den Wocheneditor (nur feste, interne Pfade – keine offenen Redirects). */
export function weekPlanPath(
  weekStart: string,
  options: { versionId?: string; editEntryId?: string; notice?: NoticeKey } = {},
): string {
  const params = new URLSearchParams({ woche: weekStart });
  if (options.versionId) params.set("version", options.versionId);
  if (options.editEntryId) params.set("bearbeiten", options.editEntryId);
  if (options.notice) params.set("hinweis", options.notice);
  return `/wochenplan?${params.toString()}`;
}

/** Feste Erfolgshinweise; über die URL werden nur diese Schlüssel transportiert. */
export const NOTICES = {
  veroeffentlicht:
    "Der Entwurf wurde veröffentlicht. Die App zeigt ab der nächsten Synchronisierung diese Version.",
  entwurf:
    "Entwurf geöffnet. Änderungen werden sofort im Entwurf gespeichert und erst nach dem Veröffentlichen in der App sichtbar.",
  verworfen: "Der Entwurf wurde verworfen.",
  gespeichert: "Änderung gespeichert.",
} as const;

export type NoticeKey = keyof typeof NOTICES;

export function noticeText(key: string | undefined): string | undefined {
  return key && key in NOTICES ? NOTICES[key as NoticeKey] : undefined;
}

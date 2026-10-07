import { formatLocalDateShort, formatTime, toLocalDate } from "@tagestakt/schedule-schema";

import { type PlanOrigin, isFetchedAtStale } from "@/lib/plan-status";

import { Notice } from "./ui";

function describeFetchedAt(fetchedAt: string, now: Date): string {
  const date = new Date(fetchedAt);
  const sameDay = toLocalDate(date) === toLocalDate(now);
  return sameDay
    ? `heute, ${formatTime(date)} Uhr`
    : `${formatLocalDateShort(toLocalDate(date))} ${formatTime(date)} Uhr`;
}

/**
 * Deutlicher Hinweis, wenn offline der gespeicherte oder ein veralteter Plan angezeigt wird –
 * mit Stand und Folge („Starten … erst wieder mit Verbindung“).
 */
export function StatusBanner({
  origin,
  fetchedAt,
  now,
  errorMessage,
}: {
  origin: PlanOrigin;
  fetchedAt: string;
  now: Date;
  errorMessage?: string;
}) {
  const stale = isFetchedAtStale(fetchedAt, now);
  if (origin === "network" && !stale) return null;
  if (origin === "cache") {
    return (
      <Notice tone="warning" title="Offline – gespeicherter Plan">
        {`Zuletzt aktualisiert: ${describeFetchedAt(fetchedAt, now)}.${errorMessage ? ` ${errorMessage}` : ""} Starten, Beenden und Bearbeiten sind erst wieder mit Verbindung möglich; ein laufender Timer zählt weiter.`}
      </Notice>
    );
  }
  return (
    <Notice tone="warning" title="Plan möglicherweise veraltet">
      {`Zuletzt aktualisiert: ${describeFetchedAt(fetchedAt, now)}. Zum Aktualisieren nach unten ziehen.`}
    </Notice>
  );
}

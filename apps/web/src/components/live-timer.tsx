"use client";

import { formatDurationSpoken, formatElapsed } from "@tagestakt/schedule-schema";
import { useEffect, useState } from "react";

/**
 * Laufzeit einer Aktivität. Rechnet immer aus dem Serverzeitpunkt des Beginns – die
 * Anzeige ist damit nach Neuladen oder Tabwechsel sofort korrekt. Nur die Ziffern
 * ändern sich (keine Layoutverschiebung, keine Animation). Screenreader erhalten eine
 * minutengenaue Beschreibung statt sekündlicher Ansagen.
 */
export function LiveTimer({
  startedAt,
  size = "lg",
  initialNow,
}: {
  startedAt: string;
  size?: "lg" | "md" | "sm";
  /** Serverzeit beim Rendern – verhindert Abweichungen zwischen Server- und Client-HTML. */
  initialNow: string;
}) {
  const [now, setNow] = useState(() => Date.parse(initialNow));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - Date.parse(startedAt));
  const minutes = Math.floor(elapsed / 60_000);
  return (
    <span
      className={`timer timer--${size}`}
      role="timer"
      aria-live="off"
      aria-label={`Läuft seit ${formatDurationSpoken(minutes)}`}
    >
      {formatElapsed(elapsed)}
    </span>
  );
}

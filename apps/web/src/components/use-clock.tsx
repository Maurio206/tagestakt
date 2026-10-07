"use client";

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

const MINUTE_MS = 60_000;

const MinuteClockContext = createContext<Date | null>(null);

/**
 * Uhr mit Minutentakt (an der vollen Minute ausgerichtet). Nur Komponenten, die `useMinuteNow`
 * verwenden, rendern neu – die übrige Seite wird nicht minütlich neu berechnet.
 */
export function MinuteClock({ initialNow, children }: { initialNow: string; children: ReactNode }) {
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    let interval: number | undefined;
    const tick = () => setNow(new Date());
    // Nach dem Laden sofort die Uhr des Geräts übernehmen, danach zu jeder vollen Minute.
    const adopt = window.setTimeout(tick, 0);
    const align = window.setTimeout(
      () => {
        tick();
        interval = window.setInterval(tick, MINUTE_MS);
      },
      MINUTE_MS - (Date.now() % MINUTE_MS) + 20,
    );
    return () => {
      window.clearTimeout(adopt);
      window.clearTimeout(align);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  return <MinuteClockContext.Provider value={now}>{children}</MinuteClockContext.Provider>;
}

export function useMinuteNow(): Date {
  const now = useContext(MinuteClockContext);
  return now ?? new Date();
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Systemeinstellung „Bewegung reduzieren“ (ohne `matchMedia`: keine Reduktion bekannt). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

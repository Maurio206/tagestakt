"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Lädt die Server-Ansicht regelmäßig neu, damit „Jetzt“ aktuell bleibt. */
export function AutoRefresh({ intervalSeconds = 60 }: { intervalSeconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalSeconds * 1000);
    return () => window.clearInterval(id);
  }, [router, intervalSeconds]);
  return null;
}

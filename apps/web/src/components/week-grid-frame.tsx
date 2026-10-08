"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { revealBlockDetails } from "./block-details-reveal";
import { buttonClass } from "./ui";

type FullscreenMode = "off" | "native" | "overlay";

/** Ab dieser Breite gilt die Desktopansicht – dort gibt es kein Vollbild. */
const DESKTOP_QUERY = "(min-width: 1100px)";

function exitNativeFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

/**
 * Rahmen um das Zeitraster der Woche: auf schmalen Bildschirmen mit Schalter „Vollbild“. Nutzt
 * die Fullscreen-API und sonst eine bildschirmfüllende Ebene. Raster (`WeekGrid`) und Daten
 * bleiben dieselben wie auf dem Desktop; Antippen eines Blocks beendet das Vollbild und zeigt
 * dessen Details, die Markierung „Notiz“ beendet es ebenfalls.
 */
export function WeekGridFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<FullscreenMode>("off");
  const active = mode !== "off";

  // Vom System beendetes Vollbild (Esc, Android-Zurück) übernehmen.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement)
        setMode((current) => (current === "native" ? "off" : current));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Antippen eines Blocks oder der Markierung „Notiz“: Vollbild beenden, denn das Ziel liegt
  // außerhalb des Rasters; die Navigation übernimmt der Link selbst. Beim bereits ausgewählten
  // Block wird nicht neu navigiert – dann direkt zu dessen Details.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onBlockClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest("a");
      if (!link) return;
      if (active) {
        exitNativeFullscreen();
        setMode("off");
      }
      if (link.matches("a.wb") && link.getAttribute("aria-current") === "true") {
        revealBlockDetails();
      }
    };
    frame.addEventListener("click", onBlockClick, true);
    return () => frame.removeEventListener("click", onBlockClick, true);
  }, [active]);

  // Während des Vollbilds: Seite dahinter sperren; Esc oder ein breites Fenster beenden es.
  useEffect(() => {
    if (!active) return;
    const leave = () => {
      exitNativeFullscreen();
      setMode("off");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") leave();
    };
    const desktop = window.matchMedia?.(DESKTOP_QUERY);
    const onWide = () => {
      if (desktop?.matches) leave();
    };
    const root = document.documentElement;
    root.classList.add("grid-fullscreen-open");
    document.addEventListener("keydown", onKey);
    desktop?.addEventListener("change", onWide);
    return () => {
      root.classList.remove("grid-fullscreen-open");
      document.removeEventListener("keydown", onKey);
      desktop?.removeEventListener("change", onWide);
    };
  }, [active]);

  async function enter() {
    const frame = frameRef.current;
    if (frame && document.fullscreenEnabled && typeof frame.requestFullscreen === "function") {
      try {
        await frame.requestFullscreen({ navigationUI: "hide" });
        setMode("native");
        return;
      } catch {
        // Abgelehnt oder nicht möglich – bildschirmfüllende Ebene als Ersatz.
      }
    }
    setMode("overlay");
  }

  function leave() {
    exitNativeFullscreen();
    setMode("off");
  }

  return (
    <div
      ref={frameRef}
      className={active ? "week-grid-frame is-fullscreen" : "week-grid-frame"}
      data-fullscreen={mode}
    >
      <div className="week-grid-tools">
        <button
          type="button"
          className={buttonClass("secondary", "sm")}
          onClick={active ? leave : () => void enter()}
        >
          {active ? (
            <Minimize2 size={16} aria-hidden="true" />
          ) : (
            <Maximize2 size={16} aria-hidden="true" />
          )}
          {active ? "Vollbild beenden" : "Vollbild"}
        </button>
      </div>
      <div className="week-grid-wrap">{children}</div>
    </div>
  );
}

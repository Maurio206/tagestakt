"use client";

import { Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { revealBlockDetails } from "./block-details-reveal";
import { buttonClass } from "./ui";

type FullscreenMode = "off" | "native" | "overlay";

/** Ab dieser Breite gilt die Desktopansicht – dort gibt es kein Vollbild. */
const DESKTOP_QUERY = "(min-width: 1100px)";

/**
 * Zoomstufen der Stundenachse auf schmalen Bildschirmen (wie in der App). Gezoomt wird nur die
 * Höhe einer Stunde (`--hour-zoom`, siehe globals.css) – die Tagesbreite bleibt gleich.
 */
export const GRID_ZOOM_LEVELS = [1, 0.75, 0.5] as const;

function exitNativeFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

/**
 * Rahmen um das Zeitraster der Woche: auf schmalen Bildschirmen mit Schalter „Vollbild“. Nutzt
 * die Fullscreen-API und sonst eine bildschirmfüllende Ebene. Raster (`WeekGrid`) und Daten
 * bleiben dieselben wie auf dem Desktop; Antippen eines Blocks beendet das Vollbild und zeigt
 * dessen Details, die Markierung „Notiz“ beendet es ebenfalls. Der Stundenzoom staucht nur die
 * Stundenachse; die oberste sichtbare Stunde bleibt dabei oben.
 */
export function WeekGridFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<FullscreenMode>("off");
  const active = mode !== "off";
  const [zoomLevel, setZoomLevel] = useState(0);
  const zoom = GRID_ZOOM_LEVELS[zoomLevel] ?? 1;

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

  function zoomTo(level: number) {
    const wrap = wrapRef.current;
    const scrollTop = wrap?.scrollTop ?? 0;
    // Erst die neue Höhe anwenden, dann die senkrechte Position im Verhältnis der Stufen setzen.
    flushSync(() => setZoomLevel(level));
    if (wrap) wrap.scrollTop = Math.round(scrollTop * ((GRID_ZOOM_LEVELS[level] ?? 1) / zoom));
  }

  return (
    <div
      ref={frameRef}
      className={active ? "week-grid-frame is-fullscreen" : "week-grid-frame"}
      data-fullscreen={mode}
    >
      <div className="week-grid-tools">
        <div className="week-grid-zoom" role="group" aria-label="Stundenzoom">
          <button
            type="button"
            className={buttonClass("secondary", "sm", "btn--icon")}
            aria-label="Stunden herauszoomen"
            title="Mehr Stunden auf einmal – die Tage bleiben gleich breit"
            disabled={zoomLevel >= GRID_ZOOM_LEVELS.length - 1}
            onClick={() => zoomTo(zoomLevel + 1)}
          >
            <ZoomOut size={16} aria-hidden="true" />
          </button>
          <span className="week-grid-zoom-value" aria-live="polite">
            <span className="visually-hidden">Stundenzoom </span>
            {Math.round(zoom * 100)} %
          </span>
          <button
            type="button"
            className={buttonClass("secondary", "sm", "btn--icon")}
            aria-label="Stunden hineinzoomen"
            disabled={zoomLevel <= 0}
            onClick={() => zoomTo(zoomLevel - 1)}
          >
            <ZoomIn size={16} aria-hidden="true" />
          </button>
        </div>
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
      <div
        ref={wrapRef}
        className="week-grid-wrap"
        style={{ "--hour-zoom": zoom } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}

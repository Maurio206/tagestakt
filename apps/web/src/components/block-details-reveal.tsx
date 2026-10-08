"use client";

import { useEffect } from "react";

import { BLOCK_DETAILS_ID } from "@/lib/block-details";

/** Bis zu diesem Anteil der Fensterhöhe gilt der Anfang des Detailbereichs als „im Blick“. */
const VISIBLE_UNTIL = 0.6;

function scrollToDetails(): void {
  const details = document.getElementById(BLOCK_DETAILS_ID);
  if (!details) return;
  const top = details.getBoundingClientRect().top;
  const margin = Number.parseFloat(getComputedStyle(details).scrollMarginTop) || 0;
  if (top >= margin - 1 && top <= window.innerHeight * VISIBLE_UNTIL) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  details.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * Zeigt den Detailbereich des ausgewählten Blocks: sanft dorthin scrollen, sofern sein Anfang
 * nicht schon im Blick ist – ohne Hash in der URL und ohne den Fokus zu verschieben. Läuft noch
 * ein Vollbild, erst nach dessen Ende (vorher stimmen die Positionen nicht).
 */
export function revealBlockDetails(): void {
  const run = () => requestAnimationFrame(scrollToDetails);
  if (document.fullscreenElement) {
    document.addEventListener("fullscreenchange", run, { once: true });
  } else {
    run();
  }
}

/** Beim Auswählen eines Blocks (neue Id) den Detailbereich zeigen. */
export function RevealBlockDetails({ entryId }: { entryId: string }) {
  useEffect(() => {
    revealBlockDetails();
  }, [entryId]);
  return null;
}

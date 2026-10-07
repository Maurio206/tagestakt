import { ENTRY_CATEGORIES, GOAL_STATUSES } from "@tagestakt/schedule-schema";
import { describe, expect, it } from "vitest";

import {
  type ColorScheme,
  TONES,
  categoryTone,
  contrastRatio,
  cssVariableName,
  goalStatusStyle,
  mixColor,
  palettes,
  planBlockTint,
} from "./index";

const schemes: ColorScheme[] = ["dark", "light"];

describe("Kontraste (WCAG)", () => {
  it.each(schemes)("Text erreicht ≥ 4,5 : 1 auf allen Flächen (%s)", (scheme) => {
    const p = palettes[scheme];
    for (const surface of [p.bg, p.surface1, p.surface2, p.surface3]) {
      for (const text of [p.text, p.textMuted, p.textSubtle]) {
        expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrastRatio(p.onInverse, p.inverse)).toBeGreaterThanOrEqual(7);
  });

  it.each(schemes)("Ziel- und Statusfarben sind als Text lesbar (%s)", (scheme) => {
    const p = palettes[scheme];
    for (const tone of TONES) {
      expect(contrastRatio(p[tone], p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p[tone], p.surface1)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(p.error, p.errorBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.warning, p.warningBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.success, p.successBg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(schemes)("Ränder von Bedienelementen erreichen ≥ 3 : 1 (%s)", (scheme) => {
    const p = palettes[scheme];
    for (const surface of [p.bg, p.surface1, p.surface2]) {
      expect(contrastRatio(p.lineStrong, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it("berechnet bekannte Referenzwerte", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  // Fokusblock = Planblock-Fläche: Text und Fokusring (beide `text`) bleiben lesbar. Chips und
  // Status-Tags stehen dort auf surface1, Knopfränder nutzen textSubtle statt lineStrong.
  it.each(schemes)("Planblock-Fläche aller Töne bleibt lesbar (%s)", (scheme) => {
    const p = palettes[scheme];
    for (const tone of TONES) {
      const block = mixColor(p[tone], p.surface1, planBlockTint.fill);
      for (const text of [p.text, p.textMuted, p.warning]) {
        expect(contrastRatio(text, block)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(p.textSubtle, block)).toBeGreaterThanOrEqual(3); // Knopfrand
      expect(contrastRatio(p[tone], p.surface1)).toBeGreaterThanOrEqual(4.5); // Chip
      expect(contrastRatio(p.success, p.surface1)).toBeGreaterThanOrEqual(4.5); // „Erledigt“
    }
  });
});

describe("Mischung", () => {
  it("entspricht color-mix(in srgb, …)", () => {
    expect(mixColor("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixColor("#E2B04A", "#1A1917", 1)).toBe("#E2B04A");
    expect(mixColor("#E2B04A", "#1A1917", 0)).toBe("#1A1917");
    expect(mixColor("#e2b04a", "#1a1917", planBlockTint.fill)).toBe("#3A311F");
  });

  it("lehnt ungültige Farben ab", () => {
    expect(() => mixColor("#FFF", "#000000", 0.5)).toThrow("Ungültige Farbe");
  });
});

describe("Zuordnungen", () => {
  it("jede Kategorie hat einen Ton und jeder Zielstatus eine Darstellung", () => {
    for (const category of ENTRY_CATEGORIES) expect(TONES).toContain(categoryTone[category]);
    for (const status of GOAL_STATUSES) expect(goalStatusStyle[status].icon).toBeTruthy();
    expect(categoryTone.relationship).toBe("relationship");
  });

  it("ordnet jeder Kategorie den festgelegten Ton zu", () => {
    expect(categoryTone).toEqual({
      business: "business",
      sport: "sport",
      relationship: "relationship",
      duty: "duty",
      appointment: "violet",
      leisure: "violet",
      shopping: "neutral",
      meal: "neutral",
      hygiene: "neutral",
      commute: "neutral",
      sleep: "neutral",
      other: "neutral",
    });
  });

  it("bildet CSS-Variablennamen", () => {
    expect(cssVariableName("bg")).toBe("--tt-bg");
    expect(cssVariableName("textMuted")).toBe("--tt-text-muted");
    expect(cssVariableName("warningBg")).toBe("--tt-warning-bg");
  });
});

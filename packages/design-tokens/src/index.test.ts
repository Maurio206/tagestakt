import { ENTRY_CATEGORIES, GOAL_STATUSES } from "@tagestakt/schedule-schema";
import { describe, expect, it } from "vitest";

import {
  type ColorScheme,
  TONES,
  categoryTone,
  contrastRatio,
  cssVariableName,
  goalStatusStyle,
  palettes,
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
});

describe("Zuordnungen", () => {
  it("jede Kategorie hat einen Ton und jeder Zielstatus eine Darstellung", () => {
    for (const category of ENTRY_CATEGORIES) expect(TONES).toContain(categoryTone[category]);
    for (const status of GOAL_STATUSES) expect(goalStatusStyle[status].icon).toBeTruthy();
    expect(categoryTone.relationship).toBe("relationship");
  });

  it("bildet CSS-Variablennamen", () => {
    expect(cssVariableName("bg")).toBe("--tt-bg");
    expect(cssVariableName("textMuted")).toBe("--tt-text-muted");
    expect(cssVariableName("warningBg")).toBe("--tt-warning-bg");
  });
});

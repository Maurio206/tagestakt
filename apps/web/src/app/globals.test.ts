// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type Palette, cssVariableName, palettes, planBlockTint } from "@tagestakt/design-tokens";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

/** Liest `--tt-*`-Werte aus dem ersten Block, der auf `marker` folgt. */
function variablesAfter(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("}", start));
  const values: Record<string, string> = {};
  for (const match of block.matchAll(/(--tt-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    const [, name, value] = match;
    if (name && value) values[name] = value.toLowerCase();
  }
  return values;
}

describe("globals.css spiegelt die Design-Tokens", () => {
  const dark = variablesAfter(":root {");
  const light = variablesAfter("@media (prefers-color-scheme: light) {");

  it.each(Object.keys(palettes.dark) as (keyof Palette)[])("%s (dunkel und hell)", (token) => {
    expect(dark[cssVariableName(token)]).toBe(palettes.dark[token].toLowerCase());
    expect(light[cssVariableName(token)]).toBe(palettes.light[token].toLowerCase());
  });

  it("lädt keine externen Schriften oder Ressourcen", () => {
    expect(css).not.toMatch(/@import|url\(\s*["']?https?:/i);
  });

  it("respektiert „Bewegung reduzieren“ und zeigt einen Fokusring", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline: 2px solid/);
  });
});

/** Inhalt der Regel auf oberster Ebene, deren Selektor(liste) genau `selector` lautet. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?<!,\\n)^${escaped} \\{([^}]*)\\}`, "m").exec(css);
  expect(match, selector).not.toBeNull();
  return match?.[1]?.trim() ?? "";
}

describe("Fokusblock und Wochenplan-Block", () => {
  it("teilen Fläche und Rand aus planBlockTint – an genau einer Stelle", () => {
    const fill = Math.round(planBlockTint.fill * 100);
    const border = Math.round(planBlockTint.border * 100);
    const shared = rule(".wb,\n.focus-card");
    expect(shared).toContain(
      `background: color-mix(in srgb, var(--g) ${fill}%, var(--tt-surface1));`,
    );
    expect(shared).toContain(
      `border: 1px solid color-mix(in srgb, var(--g) ${border}%, transparent);`,
    );
    expect(rule(".wb")).not.toMatch(/background|border(-color)?:/);
    expect(rule(".focus-card")).not.toMatch(/background|border(-color)?:/);
  });

  it("laufend: gleiche Fläche, nur der Rand im vollen Kategorieton", () => {
    expect(rule(".focus-card.is-running")).toBe("border-color: var(--g);");
  });

  it("hält auf der getönten Fläche die Kontraste wie auf surface1", () => {
    expect(rule(".focus-card.is-tinted .chip,\n.focus-card.is-tinted .tag")).toBe(
      "background: var(--tt-surface1);",
    );
    expect(rule(".focus-card.is-tinted > .focus-head .eyebrow")).toBe(
      "color: var(--tt-text-muted);",
    );
    expect(rule(".focus-card.is-tinted > .button-row .btn--secondary")).toBe(
      "border-color: var(--tt-text-subtle);",
    );
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type Palette, cssVariableName, palettes } from "@tagestakt/design-tokens";
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

import {
  type Palette,
  type Tone,
  categoryTone,
  palettes,
  radius as tokenRadius,
  space,
  typeScale,
} from "@tagestakt/design-tokens";
import { type EntryCategory } from "@tagestakt/schedule-schema";
import { useColorScheme } from "react-native";

/**
 * App-Theme aus packages/design-tokens (dieselben Werte wie die Website).
 * Dark-first: hell nur, wenn das System ausdrücklich hell eingestellt ist.
 */
export interface Theme extends Palette {
  dark: boolean;
}

const dark: Theme = { ...palettes.dark, dark: true };
const light: Theme = { ...palettes.light, dark: false };

export function useTheme(): Theme {
  return useColorScheme() === "light" ? light : dark;
}

export function toneColor(theme: Theme, tone: Tone): string {
  return theme[tone];
}

export function categoryColor(theme: Theme, category: EntryCategory): string {
  return theme[categoryTone[category]];
}

/** Halbtransparente Tönung einer Farbe (#RRGGBB + Alpha). */
export function tint(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

export const spacing = {
  xxs: space["0.5"],
  xs: space["1"],
  sm: space["2"],
  md: space["3"],
  lg: space["4"],
  xl: space["6"],
  xxl: space["8"],
} as const;

export const radius = tokenRadius;

export const type = {
  timer: { fontSize: typeScale.timer.mobile, lineHeight: typeScale.timer.mobile * 1.05 },
  remaining: { fontSize: typeScale.remaining.mobile, lineHeight: typeScale.remaining.mobile * 1.1 },
  nowTitle: { fontSize: typeScale.nowTitle.mobile, lineHeight: typeScale.nowTitle.mobile * 1.15 },
  pageTitle: {
    fontSize: typeScale.pageTitle.mobile,
    lineHeight: typeScale.pageTitle.mobile * 1.25,
  },
  section: { fontSize: typeScale.section.mobile, lineHeight: typeScale.section.mobile * 1.3 },
  body: { fontSize: typeScale.body.mobile, lineHeight: typeScale.body.mobile * 1.45 },
  small: { fontSize: typeScale.small.mobile, lineHeight: typeScale.small.mobile * 1.4 },
  eyebrow: { fontSize: typeScale.eyebrow.mobile, lineHeight: typeScale.eyebrow.mobile * 1.3 },
} as const;

/** Mindesthöhe für Bedienelemente (Android ≥ 48 dp, Primäraktionen 56 dp). */
export const touch = { min: 48, primary: 56 } as const;

/** Monospace für Zeiten und Timer (Systemschrift – keine externen Schriften). */
export const monoFamily = "monospace";

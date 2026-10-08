import {
  type BlockEmphasis,
  type Palette,
  type Tone,
  blockColors,
  categoryTone,
  palettes,
  radius as tokenRadius,
  space,
  typeScale,
} from "@tagestakt/design-tokens";
import { type EntryCategory } from "@tagestakt/schedule-schema";
import { type ViewStyle, useColorScheme } from "react-native";

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

/** Zustand eines Planblocks; jeder Zustand ist auch ohne Farbe erkennbar (Rand, Ring, Text). */
export interface BlockState {
  emphasis: BlockEmphasis;
  /** Läuft gerade: Rand im vollen Kategorieton, doppelt so breit (dazu Text „läuft“). */
  running?: boolean;
  /** Ausgewählt: Ring in Textfarbe außerhalb des Blocks. */
  selected?: boolean;
  /** Ausgelassen: blasser, Titel durchgestrichen (dazu Text „ausgelassen“). */
  skipped?: boolean;
  /** Überschneidung: gestrichelter Rand in Warnfarbe (dazu Symbol bzw. Text). */
  overlap?: boolean;
}

export interface BlockStyle {
  /** Fläche, Rand, Akzentkante links und Zustandsmarkierungen */
  container: ViewStyle;
  accent: string;
  text: string;
  textMuted: string;
}

/**
 * Einzige Stelle, an der die App Planblöcke einfärbt (Fokusblock, Nachbarn, Zeitstrahl,
 * Wochenraster, „Als Nächstes“): Werte aus `blockColors` der Design-Tokens.
 */
export function blockStyle(theme: Theme, category: EntryCategory, state: BlockState): BlockStyle {
  const colors = blockColors(theme, categoryTone[category], state.emphasis);
  const container: ViewStyle = {
    backgroundColor: colors.background,
    borderColor: state.overlap ? theme.warning : state.running ? colors.accent : colors.border,
    borderWidth: state.running ? 2 : 1,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    ...(state.overlap ? { borderStyle: "dashed" as const } : null),
    ...(state.skipped ? { opacity: 0.6 } : null),
    ...(state.selected
      ? {
          outlineColor: theme.text,
          outlineWidth: 2,
          outlineOffset: 2,
          outlineStyle: "solid" as const,
        }
      : null),
  };
  return { container, accent: colors.accent, text: colors.text, textMuted: colors.textMuted };
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

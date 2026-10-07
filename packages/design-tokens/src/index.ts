/**
 * TagesTakt-Designsystem – „Ruhige Präzision für ein volles Leben.“
 *
 * Quelle der Wahrheit für Farben, Abstände, Radien, Typografie, Bewegung und Ebenen.
 * Die Website spiegelt die Farben als CSS-Variablen (apps/web/src/app/globals.css, ein Test
 * prüft die Übereinstimmung), die App liest die Werte direkt (apps/mobile/src/theme.ts).
 * Dokumentation: docs/design/design-system.md
 */
import type { EntryCategory, GoalStatus } from "@tagestakt/schedule-schema";

export type ColorScheme = "dark" | "light";

export interface Palette {
  /** Seitenhintergrund */
  bg: string;
  /** Seitenleiste, Listen, Sheets */
  surface1: string;
  /** Eingabefelder, Timer-Leiste */
  surface2: string;
  /** aktive Navigation, gedrückte Zustände */
  surface3: string;
  /** Haarlinien (dekorativ) */
  line: string;
  /** Ränder von Bedienelementen (≥ 3 : 1) */
  lineStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  /** Fläche des Primärknopfs */
  inverse: string;
  onInverse: string;
  business: string;
  sport: string;
  relationship: string;
  duty: string;
  violet: string;
  neutral: string;
  error: string;
  warning: string;
  success: string;
  errorBg: string;
  warningBg: string;
  successBg: string;
}

export const palettes: Readonly<Record<ColorScheme, Palette>> = {
  dark: {
    bg: "#121110",
    surface1: "#1A1917",
    surface2: "#211F1D",
    surface3: "#2A2825",
    line: "#302E2A",
    lineStrong: "#76716A",
    text: "#F3EFE8",
    textMuted: "#BDB6AA",
    textSubtle: "#979083",
    inverse: "#F3EFE8",
    onInverse: "#141312",
    business: "#E2B04A",
    sport: "#5DBE86",
    relationship: "#EC8FA3",
    duty: "#88A6C6",
    violet: "#A99BD8",
    neutral: "#A59E92",
    error: "#F26A5C",
    warning: "#F09A4A",
    success: "#6CCB91",
    errorBg: "#2B1714",
    warningBg: "#2A1E11",
    successBg: "#132219",
  },
  light: {
    bg: "#F7F5F1",
    surface1: "#FFFFFF",
    surface2: "#F1EEE8",
    surface3: "#E7E3DB",
    line: "#E2DDD4",
    lineStrong: "#857E72",
    text: "#1A1815",
    textMuted: "#4C473F",
    textSubtle: "#665F55",
    inverse: "#1A1815",
    onInverse: "#F7F5F1",
    business: "#875A00",
    sport: "#1E7546",
    relationship: "#AE3A5F",
    duty: "#2E5B88",
    violet: "#5C4AA3",
    neutral: "#655F55",
    error: "#B3261E",
    warning: "#94470A",
    success: "#1E7546",
    errorBg: "#FBE9E7",
    warningBg: "#FDF0E2",
    successBg: "#E5F3EA",
  },
};

/** Farbtöne mit Bedeutung. Zielfarben nur für Ziele/Kategorien, nie für Status. */
export const TONES = ["business", "sport", "relationship", "duty", "violet", "neutral"] as const;
export type Tone = (typeof TONES)[number];

export const categoryTone: Readonly<Record<EntryCategory, Tone>> = {
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
};

/**
 * Kategoriefläche eines Planblocks: Anteil des Kategorietons an der Fläche (gemischt mit
 * `surface1`) und am Rand (als Deckkraft). Gilt für den Block im Wochenraster der Website
 * (`.wb`) und für den Fokusblock der Übersicht bzw. „Jetzt“ – beide zeigen so denselben Ton.
 */
export const planBlockTint = { fill: 0.16, border: 0.45 } as const;

/** Lucide-Symbolnamen je Ton; die Apps bilden sie auf ihre Icon-Komponenten ab. */
export const toneIcon: Readonly<Record<Tone, string>> = {
  business: "briefcase",
  sport: "dumbbell",
  relationship: "heart",
  duty: "building",
  violet: "calendar",
  neutral: "circle",
};

export type StatusTone = "neutral" | "warning" | "success" | "unset";

/** Zielstatus: Darstellung immer als Wort + Symbol (+ Muster). */
export const goalStatusStyle: Readonly<Record<GoalStatus, { tone: StatusTone; icon: string }>> = {
  unset: { tone: "unset", icon: "circle-dashed" },
  on_track: { tone: "neutral", icon: "calendar-check" },
  at_risk: { tone: "warning", icon: "triangle-alert" },
  reached: { tone: "success", icon: "circle-check" },
  over: { tone: "success", icon: "circle-arrow-up" },
  below: { tone: "neutral", icon: "circle-minus" },
};

/** 4er-Raster (px bzw. dp). */
export const space = {
  "0.5": 2,
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64,
} as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, sheet: 22, pill: 999 } as const;

export const fontFamily = {
  /** Web: selbst gehostet über das npm-Paket `geist`. */
  webSans: '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif',
  webMono: '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
} as const;

/** Schriftgrößen (px Web / dp Mobile). */
export const typeScale = {
  timer: { web: 60, mobile: 56, weight: "500", lineHeight: 1 },
  remaining: { web: 40, mobile: 36, weight: "500", lineHeight: 1 },
  nowTitle: { web: 34, mobile: 30, weight: "650", lineHeight: 1.15 },
  pageTitle: { web: 28, mobile: 24, weight: "650", lineHeight: 1.2 },
  section: { web: 18, mobile: 19, weight: "650", lineHeight: 1.3 },
  body: { web: 15, mobile: 16, weight: "400", lineHeight: 1.5 },
  small: { web: 13, mobile: 14, weight: "500", lineHeight: 1.45 },
  eyebrow: { web: 12, mobile: 12, weight: "600", lineHeight: 1.3 },
} as const;

export const motion = {
  fast: 120,
  base: 200,
  calm: 320,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

export const zIndex = {
  content: 0,
  sticky: 10,
  navigation: 20,
  timerBar: 30,
  overlay: 40,
  sheet: 50,
  toast: 60,
  lock: 100,
} as const;

/** Mindestgrößen für Bedienelemente. */
export const touchTarget = { web: 44, mobile: 48, primaryMobile: 56 } as const;

// ---------------------------------------------------------------------------
// Kontrast (WCAG 2.x) – für Tests und Dokumentation
// ---------------------------------------------------------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#RRGGBB` → Kanäle 0–255. */
function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Ungültige Farbe: ${hex}`);
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Deckende Mischung wie CSS `color-mix(in srgb, color amount, base)` (#RRGGBB). */
export function mixColor(color: string, base: string, amount: number): string {
  const [r1, g1, b1] = rgb(color);
  const [r2, g2, b2] = rgb(base);
  const mix = (a: number, b: number) =>
    Math.round(a * amount + b * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`.toUpperCase();
}

/** CSS-Variablennamen der Website (kebab-case mit Präfix `--tt-`). */
export function cssVariableName(token: keyof Palette): string {
  return `--tt-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

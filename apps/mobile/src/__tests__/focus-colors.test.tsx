/**
 * Fokusfläche „Jetzt“: Die Farbe zeigt nur die Kategorie – exakt wie der Planblock im
 * Wochenraster der Website (Fläche 16 % in surface1, Rand 45 % Deckkraft). Eine laufende
 * Aktivität bekommt nur den Rand im vollen Ton, Zustände ohne Kategorie bleiben neutral.
 */
import {
  type ColorScheme,
  type Tone,
  mixColor,
  palettes,
  planBlockTint,
} from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  ENTRY_CATEGORIES,
  type EntryCategory,
  GOAL_KEYS,
} from "@tagestakt/schedule-schema";
import { render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { type NowActions, NowView } from "@/components/now-view";
import { type PlanResult } from "@/lib/plan-status";
import { tint } from "@/theme";

import { NOW, entry, session, snapshot } from "./fixtures";

const mockScheme = jest.fn<ColorScheme, []>(() => "dark");
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockScheme(),
}));

/** Erwartete Töne unabhängig von der Implementierung (Vorgabe je Kategorie). */
const EXPECTED_TONE: Record<EntryCategory, Tone> = {
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

const SCHEMES: ColorScheme[] = ["dark", "light"];

function actions(): NowActions {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    switchTo: jest.fn(),
    discard: jest.fn(),
    setCompletion: jest.fn(),
    openCorrection: jest.fn(),
    openGoals: jest.fn(),
    openNote: jest.fn(),
  };
}

/** Plan mit genau einem Block 16:30–18:00 (NOW = 17:00) und optional laufender Aktivität. */
function planWith(category: EntryCategory, sessions: ActivitySession[] = []) {
  const base = snapshot("2026-10-06T14:55:00.000Z", { sessions });
  const week = base.weeks[0];
  if (!week) throw new Error("Woche fehlt");
  const block = entry("Block (Beispiel)", category, "2026-10-06", "16:30", "18:00");
  const result: PlanResult = {
    snapshot: { ...base, weeks: [{ ...week, schedule_entries: [block] }] },
    origin: "network",
  };
  return result;
}

function cardStyle() {
  return StyleSheet.flatten(screen.getByTestId("focus-card").props.style);
}

describe.each(SCHEMES)("Fokusfläche – Kategoriefarbe (%s)", (scheme) => {
  const p = palettes[scheme];

  beforeEach(() => {
    mockScheme.mockReturnValue(scheme);
  });

  it.each(ENTRY_CATEGORIES)(
    "geplanter Block „%s“: Fläche und Rand wie im Wochenraster",
    async (category) => {
      await render(<NowView result={planWith(category)} now={NOW} actions={actions()} />);
      const color = p[EXPECTED_TONE[category]];
      expect(cardStyle()).toMatchObject({
        backgroundColor: mixColor(color, p.surface1, planBlockTint.fill),
        borderColor: tint(color, planBlockTint.border),
        borderWidth: 1,
      });
    },
  );

  it.each(GOAL_KEYS)(
    "laufende Aktivität „%s“: gleiche Fläche, Rand im vollen Ton",
    async (goal) => {
      const running = session(goal, "2026-10-06T14:40:00.000Z", null);
      await render(<NowView result={planWith("duty", [running])} now={NOW} actions={actions()} />);
      const color = p[EXPECTED_TONE[goal]];
      expect(cardStyle()).toMatchObject({
        backgroundColor: mixColor(color, p.surface1, planBlockTint.fill),
        borderColor: color,
        borderWidth: 1,
      });
    },
  );

  it("Status „erledigt“ ändert die Farbe nicht", async () => {
    const result = planWith("sport");
    const week = result.snapshot.weeks[0];
    const block = week?.schedule_entries[0];
    if (!week || !block) throw new Error("Block fehlt");
    week.schedule_entries = [{ ...block, completion_status: "completed" }];
    await render(<NowView result={result} now={NOW} actions={actions()} />);
    expect(cardStyle().backgroundColor).toBe(mixColor(p.sport, p.surface1, planBlockTint.fill));
  });

  it("freie Zeit bleibt neutral: surface1, gestrichelter Rand", async () => {
    const at = new Date("2026-10-06T16:30:00Z"); // 18:30, nach dem Block
    await render(<NowView result={planWith("business")} now={at} actions={actions()} />);
    expect(cardStyle()).toMatchObject({
      backgroundColor: p.surface1,
      borderColor: p.lineStrong,
      borderStyle: "dashed",
    });
  });

  it("auf der getönten Fläche: Chip auf surface1, Knopfränder textSubtle", async () => {
    await render(<NowView result={planWith("business")} now={NOW} actions={actions()} />);
    const card = screen.getByTestId("focus-card");
    expect(StyleSheet.flatten(within(card).getByTestId("tone-chip").props.style)).toMatchObject({
      backgroundColor: p.surface1,
    });
    const done = within(card).getByRole("button", {
      name: "„Block (Beispiel)“ als erledigt markieren",
    });
    expect(StyleSheet.flatten(done.props.style)).toMatchObject({ borderColor: p.textSubtle });
  });
});

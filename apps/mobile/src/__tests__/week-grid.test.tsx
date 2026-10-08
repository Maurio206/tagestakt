/**
 * Wochenraster der App: Zeitachse × Tagesspalten wie im mobilen Wochenplan der Website,
 * stehende Zeitspalte und Kopfzeile, freies Verschieben mit einem Finger (auch diagonal),
 * Blöcke mit Lage, Dauer, Kategorie, Farbe und Status, Details per Antippen, Vollbild mit
 * Android-Zurück. Alle Daten sind frei erfunden.
 */
import { blockColors, palettes } from "@tagestakt/design-tokens";
import { type ScheduleEntry, getWeekGridLayout } from "@tagestakt/schedule-schema";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { Dimensions, StyleSheet } from "react-native";

import { type PlanResult } from "@/lib/plan-status";
import { WeekGrid, gridMetrics } from "@/components/week-grid";
import { WeekGridFrame, inlineGridHeight } from "@/components/week-grid-frame";
import WeekScreen from "@/app/(tabs)/woche";

import { NOW, businessBlock, entry, pastBlock, snapshot, sportBlock } from "./fixtures";
import { drag, finger } from "./gesture";

jest.mock(
  "react-native-safe-area-context",
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-safe-area-context/jest/mock").default,
);
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockPlan: { current: PlanResult | null } = { current: null };
jest.mock("@/hooks/use-plan", () => ({
  usePlan: () => ({
    result: mockPlan.current,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock("@/hooks/use-now", () => ({ useNow: () => new Date("2026-10-06T15:00:00Z") }));
jest.mock("@/components/timer-bar", () => ({ RunningTimerBar: () => null }));
// Die App ist dark-first; Farbwerte werden gegen die dunkle Palette geprüft.
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => "dark",
}));

const p = palettes.dark;
const WEEK = "2026-10-05";
const laila = entry("Laila-Abend (Beispiel)", "relationship", "2026-10-06", "16:30", "18:00");
const skipped = entry("Dienst (Beispiel)", "duty", "2026-10-07", "08:00", "12:00", "skipped");
const night = entry("Nachtfahrt (Beispiel)", "commute", "2026-10-08", "22:00", "02:00");
// `entry` rechnet ohne Folgetag; die Nachtfahrt endet am Freitag um 02:00.
const nightBlock: ScheduleEntry = {
  ...night,
  end_at: new Date(Date.parse(night.end_at) + 24 * 3_600_000).toISOString(),
};
const ENTRIES = [pastBlock, businessBlock, sportBlock, laila, skipped, nightBlock];
const OVERLAPS = new Set([businessBlock.id, laila.id]);

const hidden = { includeHiddenElements: true };
const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id, hidden).props.style);
const metrics = () => gridMetrics(0, Dimensions.get("window").fontScale);
/** Die Nachtfahrt (Fortsetzung ab 00:00) erweitert das Raster bis Mitternacht. */
const FIRST_HOUR = getWeekGridLayout(ENTRIES, WEEK).firstHour;

type Host = ReturnType<typeof screen.getByTestId>;

/** Verschiebung (translateX/-Y) eines Elements aus seinem Transform. */
function translateOf(host: Host): { x: number; y: number } {
  const transform = (StyleSheet.flatten(host.props.style).transform ?? []) as {
    translateX?: number;
    translateY?: number;
  }[];
  let x = 0;
  let y = 0;
  for (const part of transform) {
    x += part.translateX ?? 0;
    y += part.translateY ?? 0;
  }
  // Interpolationen liefern Gleitkomma-Reste (z. B. -119,99999…): auf 1/1000 dp runden.
  const round = (value: number) => Math.round(value * 1000) / 1000 || 0;
  return { x: round(x), y: round(y) };
}
const translate = (id: string) => translateOf(screen.getByTestId(id));

async function renderGrid(props: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const onSelect = jest.fn();
  const result = await render(
    <WeekGrid
      weekStart={WEEK}
      entries={ENTRIES}
      overlapIds={OVERLAPS}
      now={NOW}
      onSelect={onSelect}
      height={500}
      {...props}
    />,
  );
  return { ...result, onSelect };
}

describe("WeekGrid – Aufbau", () => {
  it("zeigt sieben Tagesspalten nebeneinander, heute markiert – keine Tagesliste", async () => {
    await renderGrid();
    const heads = ["05", "06", "07", "08", "09", "10", "11"].map((d) =>
      screen.getByTestId(`week-grid-head-2026-10-${d}`),
    );
    expect(heads).toHaveLength(7);
    expect(heads[1]?.props.accessibilityLabel).toBe("Dienstag, 6. Oktober, heute, 3 Blöcke");
    expect(heads[0]?.props.accessibilityLabel).toBe("Montag, 5. Oktober, 1 Block");
    // Tagesspalten liegen in einer Zeile im verschiebbaren Inhalt.
    const content = screen.getByTestId("week-grid-content");
    expect(within(content).getByTestId("week-grid-col-2026-10-05")).toBeTruthy();
    expect(within(content).getByTestId("week-grid-col-2026-10-11")).toBeTruthy();
  });

  it("Zeitspalte und Kopfzeile liegen außerhalb des verschiebbaren Inhalts", async () => {
    await renderGrid();
    const content = screen.getByTestId("week-grid-content");
    // Stunden laufen nur vertikal mit (eigene Spalte), die Kopfzeile nur horizontal.
    expect(within(screen.getByTestId("week-grid-hours")).getByText("08:00")).toBeTruthy();
    expect(within(content).queryByText("08:00")).toBeNull();
    expect(within(content).queryByTestId("week-grid-head-2026-10-06")).toBeNull();
    // Keine verschachtelten ScrollViews mehr (deren Achsensperre verhinderte die Diagonale).
    expect(screen.queryByTestId("week-grid-vertical")).toBeNull();
    expect(screen.queryByTestId("week-grid-horizontal")).toBeNull();
  });

  it("platziert Blöcke nach Uhrzeit und Dauer, Überschneidungen nebeneinander", async () => {
    await renderGrid();
    const { hourHeight, dayWidth } = metrics();
    const business = flat(`week-grid-block-${businessBlock.id}`);
    expect(business.top).toBeCloseTo((15.5 - FIRST_HOUR) * hourHeight);
    expect(business.height).toBeCloseTo(4 * hourHeight - 2);
    const lailaStyle = flat(`week-grid-block-${laila.id}`);
    expect(business.width).toBeCloseTo((dayWidth - 6) / 2 - 2);
    expect(lailaStyle.left).toBeGreaterThan(business.left as number);
  });

  it("teilt Blöcke über Mitternacht und kennzeichnet die Fortsetzung", async () => {
    await renderGrid();
    const parts = screen.getAllByTestId(`week-grid-block-${nightBlock.id}`);
    expect(parts).toHaveLength(2);
    expect(parts[1]?.props.accessibilityLabel).toMatch(
      /Freitag, 9\. Oktober.*Fortsetzung vom Vortag/,
    );
    expect(within(parts[1]!).getByText(/↳/)).toBeTruthy();
  });

  it("zeigt die Jetzt-Linie nur in der heutigen Spalte", async () => {
    await renderGrid();
    const today = screen.getByTestId("week-grid-col-2026-10-06");
    expect(within(today).getByTestId("week-grid-now", hidden)).toBeTruthy();
    expect(screen.getAllByTestId("week-grid-now", hidden)).toHaveLength(1);
    expect(flat("week-grid-now").top).toBeCloseTo((17 - FIRST_HOUR) * metrics().hourHeight);
  });
});

describe("WeekGrid – Farben und Status", () => {
  it("aktueller Block = Hauptphase mit breitem Rand; vergangen gedämpft; kommend regulär", async () => {
    await renderGrid();
    const strong = blockColors(p, "business", "strong");
    expect(flat(`week-grid-block-${businessBlock.id}`)).toMatchObject({
      backgroundColor: strong.background,
      borderWidth: 2,
      borderLeftColor: strong.accent,
    });
    expect(flat(`week-grid-block-${pastBlock.id}`).backgroundColor).toBe(
      blockColors(p, "business", "muted").background,
    );
    expect(flat(`week-grid-block-${sportBlock.id}`).backgroundColor).toBe(
      blockColors(p, "sport", "base").background,
    );
    expect(
      screen.getByTestId(`week-grid-block-${businessBlock.id}`).props.accessibilityLabel,
    ).toMatch(/läuft gerade, Überschneidung$/);
  });

  it("Status ist auch ohne Farbe erkennbar", async () => {
    await renderGrid({ selectedId: sportBlock.id });
    // erledigt: Haken + Wort im zugänglichen Namen
    const done = screen.getByTestId(`week-grid-block-${pastBlock.id}`);
    expect(within(done).getByTestId("icon-Check")).toBeTruthy();
    expect(done.props.accessibilityLabel).toMatch(/erledigt$/);
    // ausgelassen: blasser, Titel durchgestrichen
    expect(flat(`week-grid-block-${skipped.id}`).opacity).toBe(0.6);
    expect(StyleSheet.flatten(screen.getByText("Dienst (Beispiel)").props.style)).toMatchObject({
      textDecorationLine: "line-through",
    });
    // Überschneidung: gestrichelter Rand in Warnfarbe und Warnsymbol
    expect(flat(`week-grid-block-${laila.id}`)).toMatchObject({
      borderStyle: "dashed",
      borderColor: p.warning,
    });
    expect(
      within(screen.getByTestId(`week-grid-block-${laila.id}`)).getByTestId("icon-TriangleAlert"),
    ).toBeTruthy();
    // ausgewählt: Ring in Textfarbe und Zustand für Screenreader
    const selected = screen.getByTestId(`week-grid-block-${sportBlock.id}`);
    expect(selected.props.accessibilityState).toMatchObject({ selected: true });
    expect(flat(`week-grid-block-${sportBlock.id}`)).toMatchObject({
      outlineWidth: 2,
      outlineColor: p.text,
    });
  });

  it("Antippen meldet den Block (Details öffnen)", async () => {
    const { onSelect } = await renderGrid();
    await fireEvent.press(screen.getByTestId(`week-grid-block-${sportBlock.id}`));
    expect(onSelect).toHaveBeenCalledWith(sportBlock);
  });
});

describe("Maße", () => {
  it("Hoch- und Querformat: Mindestbreite je Tag, breite Bildschirme teilen sich die Breite", () => {
    expect(gridMetrics(360, 1)).toEqual({ hourHeight: 52, timeWidth: 48, dayWidth: 90 });
    expect(gridMetrics(800, 1).dayWidth).toBe(Math.floor((800 - 48) / 7));
  });

  it("große Systemschrift: höhere Stunden und breitere Zeitspalte (begrenzt)", () => {
    expect(gridMetrics(360, 1.3)).toEqual({ hourHeight: 68, timeWidth: 62, dayWidth: 117 });
    expect(gridMetrics(360, 2).hourHeight).toBe(78);
  });

  it("eingebettete Höhe folgt dem sichtbaren Bereich (≈ 70 %)", () => {
    expect(inlineGridHeight(0)).toBe(420);
    expect(inlineGridHeight(700)).toBe(490);
    expect(inlineGridHeight(330)).toBe(260);
  });

  it("nutzt die gemeinsame Geometrie aus schedule-schema", () => {
    // Fortsetzung über Mitternacht (ab 00:00) und Block bis 24:00 erweitern den Bereich.
    const layout = getWeekGridLayout(ENTRIES, WEEK);
    expect([layout.firstHour, layout.lastHour]).toEqual([0, 24]);
    expect(getWeekGridLayout([sportBlock], WEEK)).toMatchObject({ firstHour: 6, lastHour: 22 });
  });
});

describe("WeekGridFrame – Vollbild", () => {
  async function renderFrame() {
    const onFullscreenChange = jest.fn();
    const utils = await render(
      <WeekGridFrame
        title="KW 41 (Beispiel)"
        weekStart={WEEK}
        entries={ENTRIES}
        overlapIds={OVERLAPS}
        now={NOW}
        selectedId={null}
        onSelect={jest.fn()}
        fullscreen={false}
        onFullscreenChange={onFullscreenChange}
      />,
    );
    return { ...utils, onFullscreenChange };
  }

  it("bietet einen gut erreichbaren Schalter (≥ 48 dp)", async () => {
    const { onFullscreenChange } = await renderFrame();
    const toggle = screen.getByRole("button", { name: "Wochenraster im Vollbild anzeigen" });
    expect(StyleSheet.flatten(toggle.props.style).minHeight).toBeGreaterThanOrEqual(48);
    await fireEvent.press(toggle);
    expect(onFullscreenChange).toHaveBeenCalledWith(true);
  });

  it("diagonal auch im Vollbild; Position wandert hinein und zurück; Zurück beendet es", async () => {
    const { rerender, onFullscreenChange } = await renderFrame();
    const frame = (fullscreen: boolean) => (
      <WeekGridFrame
        title="KW 41 (Beispiel)"
        weekStart={WEEK}
        entries={ENTRIES}
        overlapIds={OVERLAPS}
        now={NOW}
        selectedId={null}
        onSelect={jest.fn()}
        fullscreen={fullscreen}
        onFullscreenChange={onFullscreenChange}
      />
    );
    // Eingebettet diagonal ziehen: 120 nach links, 80 nach oben.
    await drag(screen.getByTestId("week-grid-body"), { dx: -120, dy: -80 });
    expect(translate("week-grid-content")).toEqual({ x: -120, y: -80 });

    await fireEvent.press(
      screen.getByRole("button", { name: "Wochenraster im Vollbild anzeigen" }),
    );
    await rerender(frame(true));
    const modal = screen.getByTestId("week-grid-modal");
    expect(modal.props.visible).toBe(true);
    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(modal.props.navigationBarTranslucent).toBe(true);
    const full = screen.getByTestId("week-grid-fullscreen");
    const fullContent = () => within(full).getByTestId("week-grid-content");
    expect(translateOf(fullContent())).toEqual({ x: -120, y: -80 });

    // Im Vollbild: diagonal, horizontal, vertikal ohne Pause, dann wieder diagonal.
    const fullBody = within(full).getByTestId("week-grid-body");
    await drag(fullBody, { dx: -20, dy: -20 }, { release: "fast" });
    await drag(fullBody, { dx: -20, dy: 0 }, { release: "fast" });
    await drag(fullBody, { dx: 0, dy: -30 }, { release: "fast" });
    expect(translateOf(fullContent())).toEqual({ x: -160, y: -130 });
    await drag(fullBody, { dx: 10, dy: 10 });
    expect(translateOf(fullContent())).toEqual({ x: -150, y: -120 });

    // Android-Zurück (onRequestClose) beendet das Vollbild statt die App …
    await fireEvent(modal, "requestClose");
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
    // … und das eingebettete Raster steht an der zuletzt gezeigten Stelle.
    await rerender(frame(false));
    expect(screen.queryByTestId("week-grid-fullscreen")).toBeNull();
    expect(translate("week-grid-content")).toEqual({ x: -150, y: -120 });
  });
});

describe("WeekGrid – freies Verschieben (eine Geste, beide Achsen)", () => {
  /** Rahmen 390 dp breit, sichtbarer Ausschnitt der Tage 300 × 400 dp. */
  async function renderMeasured(props: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
    const utils = await renderGrid(props);
    await fireEvent(screen.getByTestId("week-grid"), "layout", {
      nativeEvent: { layout: { width: 390, height: 500 } },
    });
    await fireEvent(screen.getByTestId("week-grid-viewport"), "layout", {
      nativeEvent: { layout: { width: 300, height: 400 } },
    });
    const { dayWidth, hourHeight } = gridMetrics(390, Dimensions.get("window").fontScale);
    const maxX = dayWidth * 7 - 300;
    const maxY = hourHeight * (24 - FIRST_HOUR) - 400;
    return { ...utils, maxX, maxY };
  }

  it("diagonal: X und Y ändern sich gleichzeitig, Kopfzeile und Zeitspalte synchron", async () => {
    await renderMeasured();
    await drag(screen.getByTestId("week-grid-body"), { dx: -90, dy: -150 });
    expect(translate("week-grid-content")).toEqual({ x: -90, y: -150 });
    expect(translate("week-grid-heads")).toEqual({ x: -90, y: 0 }); // nur seitlich
    expect(translate("week-grid-hours")).toEqual({ x: 0, y: -150 }); // nur vertikal
  });

  it("rein horizontal: nur die Tage wandern, die Zeitspalte bleibt stehen", async () => {
    await renderMeasured();
    await drag(screen.getByTestId("week-grid-body"), { dx: -140, dy: 0 });
    expect(translate("week-grid-content")).toEqual({ x: -140, y: 0 });
    expect(translate("week-grid-hours")).toEqual({ x: 0, y: 0 });
  });

  it("rein vertikal: nur die Stunden wandern, die Kopfzeile bleibt stehen", async () => {
    await renderMeasured();
    await drag(screen.getByTestId("week-grid-body"), { dx: 0, dy: -260 });
    expect(translate("week-grid-content")).toEqual({ x: 0, y: -260 });
    expect(translate("week-grid-heads")).toEqual({ x: 0, y: 0 });
  });

  it("Antippen bleibt Antippen, erst Ziehen gehört dem Raster", async () => {
    const { onSelect } = await renderMeasured();
    const body = screen.getByTestId("week-grid-body");
    const f = finger(body);
    // Beginn einer Berührung: das Raster beansprucht sie nicht (Blöcke bekommen das Antippen).
    expect(f.down()).toEqual({ capture: false, bubble: false });
    // Kleine Bewegung (≤ 6 dp) ist noch kein Ziehen …
    expect(await f.move(4, 3)).toBe(false);
    // … darüber übernimmt das Raster und gibt die Geste nicht mehr ab (Antippen wird abgebrochen).
    expect(await f.move(12, 3)).toBe(true);
    expect(body.props.onResponderTerminationRequest(f.event(12, 3))).toBe(false);
    await f.up();
    expect(onSelect).not.toHaveBeenCalled();
    // Ein kurzes Antippen öffnet weiterhin die Details.
    await fireEvent.press(screen.getByTestId(`week-grid-block-${sportBlock.id}`));
    expect(onSelect).toHaveBeenCalledWith(sportBlock);
  });

  it("begrenzt beide Achsen auf den Inhalt (kein Überscrollen)", async () => {
    const { maxX, maxY } = await renderMeasured();
    const body = screen.getByTestId("week-grid-body");
    await drag(body, { dx: 50, dy: 50 }); // über den Anfang hinaus
    expect(translate("week-grid-content")).toEqual({ x: 0, y: 0 });
    await drag(body, { dx: -5000, dy: -5000 }); // weit über das Ende hinaus
    expect(translate("week-grid-content")).toEqual({ x: -maxX, y: -maxY });
    expect(translate("week-grid-heads").x).toBe(-maxX);
    expect(translate("week-grid-hours").y).toBe(-maxY);
  });

  it("20 diagonale Gesten direkt nacheinander: Raster, Kopfzeile und Zeitspalte folgen sofort", async () => {
    await renderMeasured();
    const body = screen.getByTestId("week-grid-body");
    for (let i = 1; i <= 20; i += 1) {
      await drag(body, { dx: -12, dy: -20 });
      expect(translate("week-grid-content")).toEqual({ x: -12 * i, y: -20 * i });
      expect(translate("week-grid-heads")).toEqual({ x: -12 * i, y: 0 });
      expect(translate("week-grid-hours")).toEqual({ x: 0, y: -20 * i });
    }
  });

  it("diagonal → horizontal → vertikal ohne Pause, auch nach schnellem Loslassen", async () => {
    await renderMeasured();
    const body = screen.getByTestId("week-grid-body");
    await drag(body, { dx: -80, dy: -60 }, { release: "fast" });
    expect(translate("week-grid-content")).toEqual({ x: -80, y: -60 });
    await drag(body, { dx: -50, dy: 0 }, { release: "fast" });
    expect(translate("week-grid-content")).toEqual({ x: -130, y: -60 });
    await drag(body, { dx: 0, dy: -90 }, { release: "fast" });
    expect(translate("week-grid-content")).toEqual({ x: -130, y: -150 });
    await drag(body, { dx: 30, dy: 40 });
    expect(translate("week-grid-content")).toEqual({ x: -100, y: -110 });
  });

  it("Antippen direkt nach einer Bewegung öffnet die Details", async () => {
    const { onSelect } = await renderMeasured();
    await drag(screen.getByTestId("week-grid-body"), { dx: -40, dy: -40 }, { release: "fast" });
    await fireEvent.press(screen.getByTestId(`week-grid-block-${sportBlock.id}`));
    expect(onSelect).toHaveBeenCalledWith(sportBlock);
  });

  it("meldet die Position; Neuzeichnen (Details auf/zu) verschiebt nichts", async () => {
    const onOffsetChange = jest.fn();
    const { rerender, onSelect } = await renderMeasured({ onOffsetChange });
    await drag(screen.getByTestId("week-grid-body"), { dx: -60, dy: -70 });
    expect(onOffsetChange).toHaveBeenLastCalledWith({ x: 60, y: 70 });
    const props = {
      weekStart: WEEK,
      entries: ENTRIES,
      overlapIds: OVERLAPS,
      now: NOW,
      onSelect,
      height: 500,
      onOffsetChange,
    };
    await rerender(<WeekGrid {...props} selectedId={sportBlock.id} />);
    expect(translate("week-grid-content")).toEqual({ x: -60, y: -70 });
    await rerender(<WeekGrid {...props} selectedId={null} />);
    expect(translate("week-grid-content")).toEqual({ x: -60, y: -70 });
  });
});

describe("Woche (Bildschirm)", () => {
  beforeEach(() => {
    const base = snapshot("2026-10-06T14:55:00.000Z");
    const week = base.weeks[0];
    if (!week) throw new Error("Woche fehlt");
    mockPlan.current = {
      snapshot: { ...base, weeks: [{ ...week, schedule_entries: ENTRIES }] },
      origin: "network",
    };
    mockPush.mockClear();
  });

  it("Seite scrollt nicht mit, solange ein Finger auf dem Raster liegt", async () => {
    await render(<WeekScreen />);
    const page = () => screen.getByTestId("screen-scroll");
    expect(page().props.scrollEnabled).toBe(true);
    // Rohe Berührungsereignisse wie auf dem Gerät (die Testbibliothek filtert sie bei
    // Respondern, die eine Berührung nicht sofort beanspruchen).
    const body = screen.getByTestId("week-grid-body");
    await act(async () => body.props.onTouchStart({}));
    expect(page().props.scrollEnabled).toBe(false);
    await act(async () => body.props.onTouchEnd({}));
    expect(page().props.scrollEnabled).toBe(true);
  });

  it("Sperre gilt nur während der Rastergeste: Loslassen und Abbruch lösen sie sofort", async () => {
    await render(<WeekScreen />);
    const page = () => screen.getByTestId("screen-scroll");
    const body = screen.getByTestId("week-grid-body");
    // Geste ohne abschließendes touchEnd (z. B. verlorenes Ereignis): Loslassen genügt.
    const f = await drag(body, { dx: -40, dy: -40 }, { release: "none" });
    expect(page().props.scrollEnabled).toBe(false);
    await f.up();
    expect(page().props.scrollEnabled).toBe(true);
    // Abbruch durch das System löst die Sperre ebenso.
    await drag(body, { dx: 0, dy: -30 }, { release: "terminate" });
    expect(page().props.scrollEnabled).toBe(true);
    // Und sofort wieder bedienbar.
    await drag(body, { dx: -20, dy: 0 });
    expect(page().props.scrollEnabled).toBe(true);
  });

  it("Wechsel ins Vollbild mitten in der Geste hinterlässt keine gesperrte Seite", async () => {
    await render(<WeekScreen />);
    const page = () => screen.getByTestId("screen-scroll");
    await drag(screen.getByTestId("week-grid-body"), { dx: -30, dy: -30 }, { release: "none" });
    expect(page().props.scrollEnabled).toBe(false);
    // Vollbild öffnen und schließen baut das eingebettete Raster neu auf (alte Geste endet).
    await fireEvent.press(
      screen.getByRole("button", { name: "Wochenraster im Vollbild anzeigen" }),
    );
    await fireEvent(screen.getByTestId("week-grid-modal"), "requestClose");
    expect(page().props.scrollEnabled).toBe(true);
  });

  it("zeigt das Zeitraster statt einer Tagesliste", async () => {
    await render(<WeekScreen />);
    expect(screen.getByTestId("week-grid")).toBeTruthy();
    expect(screen.queryByRole("header", { name: "Tage" })).toBeNull();
  });

  it("Antippen öffnet die Details; „Tag öffnen“ führt in die vorhandene Tagesansicht", async () => {
    await render(<WeekScreen />);
    await fireEvent.press(screen.getByTestId(`week-grid-block-${laila.id}`));
    const details = screen.getByTestId("block-details");
    expect(within(details).getByLabelText("Zeit: 16:30–18:00 · 1 Std. 30 Min.")).toBeTruthy();
    expect(
      within(details).getByText(/Gleichzeitig geplant: „Gewerbe-Block \(Beispiel\)“/),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Tag öffnen" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag", params: { date: "2026-10-06" } });
    expect(screen.queryByTestId("block-details")).toBeNull();
  });

  it("im Vollbild erscheinen die Details über dem Raster; „Tag öffnen“ beendet das Vollbild", async () => {
    await render(<WeekScreen />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Wochenraster im Vollbild anzeigen" }),
    );
    const full = screen.getByTestId("week-grid-fullscreen");
    await fireEvent.press(within(full).getByTestId(`week-grid-block-${sportBlock.id}`));
    expect(
      within(screen.getByTestId("week-grid-fullscreen")).getByTestId("block-details"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Tag öffnen" }));
    expect(screen.queryByTestId("week-grid-fullscreen")).toBeNull();
  });
});

import {
  act,
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { AccessibilityInfo, Dimensions, StyleSheet } from "react-native";

import { LoginView } from "@/components/login-view";
import { type NowActions, NowView, ghostPeek } from "@/components/now-view";
import { ViewportProvider } from "@/components/screen";
import { type PlanResult } from "@/lib/plan-status";

import { NOW, businessBlock, entry, session, snapshot } from "./fixtures";

function actions(): jest.Mocked<NowActions> {
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

const online = (overrides = {}): PlanResult => ({
  snapshot: snapshot("2026-10-06T14:55:00.000Z", overrides),
  origin: "network",
});

describe("NowView – Jetzt-Ansicht", () => {
  it("zeigt den aktuellen Block, die Restzeit und den nächsten Block", async () => {
    await render(<NowView result={online()} now={NOW} actions={actions()} />);
    expect(screen.getByText("17:00")).toBeOnTheScreen();
    expect(screen.getAllByText("Gewerbe-Block (Beispiel)").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("noch 2 Std. 30 Min.")).toBeOnTheScreen();
    expect(screen.getAllByText("Training (Beispiel)").length).toBeGreaterThan(0);
    expect(screen.getByText("Noch nicht erfasst.")).toBeOnTheScreen();
  });

  it("„Fokus starten“ startet das Ziel des aktuellen Blocks mit Verknüpfung", async () => {
    const a = actions();
    await render(<NowView result={online()} now={NOW} actions={a} />);
    await fireEvent.press(screen.getByRole("button", { name: "Fokus starten" }));
    expect(a.start).toHaveBeenCalledWith("business", businessBlock.id);
  });

  it("markiert einen Block als erledigt oder ausgelassen", async () => {
    const a = actions();
    await render(<NowView result={online()} now={NOW} actions={a} />);
    await fireEvent.press(
      screen.getByRole("button", { name: "„Gewerbe-Block (Beispiel)“ als erledigt markieren" }),
    );
    expect(a.setCompletion).toHaveBeenCalledWith(businessBlock.id, "completed");
  });

  it("zeigt bei laufender Aktivität „Beenden“ und „Zeit korrigieren“", async () => {
    const a = actions();
    const running = session("business", "2026-10-06T13:30:00.000Z", null, businessBlock.id);
    await render(<NowView result={online({ sessions: [running] })} now={NOW} actions={a} />);
    await fireEvent.press(screen.getByRole("button", { name: "Beenden" }));
    expect(a.stop).toHaveBeenCalledWith(running.id);
    await fireEvent.press(screen.getByRole("button", { name: "Zeit korrigieren" }));
    expect(a.openCorrection).toHaveBeenCalledWith(running.id);
  });

  it("bietet beim Wechsel drei klare Optionen und wechselt erst nach Bestätigung", async () => {
    const a = actions();
    // Sport läuft noch, geplant ist jetzt Gewerbe.
    const running = session("sport", "2026-10-06T14:40:00.000Z", null);
    await render(<NowView result={online({ sessions: [running] })} now={NOW} actions={a} />);
    await fireEvent.press(screen.getByRole("button", { name: "Zu Gewerbe wechseln" }));
    expect(a.switchTo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Sport beenden, Gewerbe starten" }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Nur Sport beenden" })).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Abbrechen – Sport läuft weiter" }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Sport beenden, Gewerbe starten" }));
    expect(a.switchTo).toHaveBeenCalledWith(running.id, "business", businessBlock.id);
  });

  it("offline: deutlicher Hinweis, Plan lesbar, Starten gesperrt", async () => {
    const a = actions();
    const result: PlanResult = {
      snapshot: snapshot("2026-10-06T06:00:00.000Z"),
      origin: "cache",
      errorMessage: "Keine Verbindung zum Server.",
    };
    await render(<NowView result={result} now={NOW} actions={a} />);
    expect(screen.getByText("Offline – gespeicherter Plan")).toBeOnTheScreen();
    expect(screen.getByText(/heute, 08:00 Uhr/)).toBeOnTheScreen();
    expect(screen.getAllByText("Gewerbe-Block (Beispiel)").length).toBeGreaterThan(0);
    const start = screen.getByRole("button", { name: "Fokus starten" });
    expect(start).toBeDisabled();
    await fireEvent.press(start);
    expect(a.start).not.toHaveBeenCalled();
  });

  it("warnt bei veraltetem Plan auch ohne Netzwerkfehler", async () => {
    const result: PlanResult = {
      snapshot: snapshot("2026-10-05T06:00:00.000Z"),
      origin: "network",
    };
    await render(<NowView result={result} now={NOW} actions={actions()} />);
    expect(screen.getByText("Plan möglicherweise veraltet")).toBeOnTheScreen();
  });

  it("meldet eine Woche ohne veröffentlichten Plan und erlaubt spontanes Starten", async () => {
    const a = actions();
    await render(<NowView result={online({ weeks: [] })} now={NOW} actions={a} />);
    expect(
      screen.getByText("Für diese Woche ist noch kein Plan veröffentlicht."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Aktivität Laila starten" }));
    expect(a.start).toHaveBeenCalledWith("relationship", null);
  });

  it("zeigt den Wochenfortschritt nur aus erfasster Zeit", async () => {
    const done = session("business", "2026-10-05T13:00:00.000Z", "2026-10-05T18:00:00.000Z");
    await render(<NowView result={online({ sessions: [done] })} now={NOW} actions={actions()} />);
    expect(screen.getAllByText(/5 h/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/20 h/).length).toBeGreaterThan(0);
  });
});

describe("LoginView", () => {
  it("bietet keine Registrierung an", async () => {
    await render(<LoginView onSubmit={jest.fn()} />);
    expect(screen.getByLabelText("E-Mail")).toBeOnTheScreen();
    expect(screen.getByLabelText("Passwort")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Registrier/i })).toBeNull();
    expect(
      screen.getByText("Privater Zugang. Eine Registrierung ist nicht möglich."),
    ).toBeOnTheScreen();
  });

  it("meldet fehlende Eingaben ohne Anfrage an den Server", async () => {
    const onSubmit = jest.fn();
    await render(<LoginView onSubmit={onSubmit} />);
    await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByText("Bitte E-Mail und Passwort eingeben.")).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("NowView – Fokusfläche", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("Nachbarblöcke sind blass, ohne Bedienelemente und für Screenreader verborgen", async () => {
    // 19:35 Berlin: Gewerbe ist vorbei, Training beginnt um 19:45.
    const at = new Date("2026-10-06T17:35:00Z");
    await render(<NowView result={online()} now={at} actions={actions()} />);
    for (const id of ["focus-ghost-prev", "focus-ghost-next"]) {
      const ghost = screen.getByTestId(id, { includeHiddenElements: true });
      expect(isHiddenFromAccessibility(ghost)).toBe(true);
      expect(ghost.props.pointerEvents).toBe("none");
      expect(ghost.props.importantForAccessibility).toBe("no-hide-descendants");
      expect(within(ghost).queryAllByRole("button", { includeHiddenElements: true })).toHaveLength(
        0,
      );
    }
    // Davor/Danach stehen zusätzlich als zugänglicher Text im Fokusblock.
    expect(screen.getByText(/Davor:/)).toHaveTextContent(
      "Davor: Gewerbe-Block (Beispiel) bis 19:30",
    );
    expect(screen.getByText(/Danach:/)).toHaveTextContent(
      "Danach: 19:45 Training (Beispiel) · in 10 Min.",
    );
  });

  it("freie Zeit: Überschrift, Countdown zum nächsten Block, nichts startet automatisch", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-06T17:35:00Z") });
    const a = actions();
    await render(<NowView result={online()} now={new Date("2026-10-06T17:35:00Z")} actions={a} />);
    expect(screen.getByRole("header", { name: "Freie Zeit" })).toBeOnTheScreen();
    expect(screen.getByLabelText("noch 10 Min. bis zum nächsten Block")).toBeOnTheScreen();
    expect(screen.getByText("Als Nächstes: 19:45 Training (Beispiel)")).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(a.start).not.toHaveBeenCalled();
  });

  it("wechselt zur Startzeit ohne Neuladen in den nächsten Block und sagt ihn an", async () => {
    const at = new Date("2026-10-06T13:29:30Z"); // 15:29:30, vor dem ersten Block
    jest.useFakeTimers({ now: at });
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await render(<NowView result={online()} now={at} actions={actions()} />);
    expect(screen.getByRole("header", { name: "Noch frei bis 15:30" })).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(29_000);
    });
    expect(screen.getByRole("header", { name: "Noch frei bis 15:30" })).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(1_100);
    });
    expect(screen.getByRole("header", { name: "Gewerbe-Block (Beispiel)" })).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith("Jetzt im Fokus: Gewerbe-Block (Beispiel)");
    const card = StyleSheet.flatten(screen.getByTestId("focus-card").props.style);
    expect(card.transform).toBeDefined();
  });

  it("„Bewegung reduzieren“: Wechsel ohne Bewegung oder Einblendung", async () => {
    const at = new Date("2026-10-06T13:29:30Z");
    jest.useFakeTimers({ now: at });
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await render(<NowView result={online()} now={at} actions={actions()} />);
    await act(async () => {
      jest.advanceTimersByTime(30_100);
    });
    expect(screen.getByRole("header", { name: "Gewerbe-Block (Beispiel)" })).toBeOnTheScreen();
    const card = StyleSheet.flatten(screen.getByTestId("focus-card").props.style);
    expect(card.transform).toBeUndefined();
    expect(card.opacity).toBeUndefined();
  });

  it("Überschneidung: Hinweis und Fokus auch für den gleichzeitig laufenden Zielblock", async () => {
    const overlap = entry("Laila-Abend (Beispiel)", "relationship", "2026-10-06", "16:30", "18:00");
    const base = online();
    const week = base.snapshot.weeks[0];
    if (!week) throw new Error("Woche fehlt");
    const result: PlanResult = {
      ...base,
      snapshot: {
        ...base.snapshot,
        weeks: [{ ...week, schedule_entries: [...week.schedule_entries, overlap] }],
      },
    };
    const a = actions();
    await render(<NowView result={result} now={NOW} actions={a} />);
    expect(screen.getByRole("header", { name: "Laila-Abend (Beispiel)" })).toBeOnTheScreen();
    expect(screen.getByText(/Überschneidung: gleichzeitig/)).toHaveTextContent(
      "Überschneidung: gleichzeitig „Gewerbe-Block (Beispiel)“ (15:30–19:30)",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Fokus für „Gewerbe-Block (Beispiel)“ starten" }),
    );
    expect(a.start).toHaveBeenCalledWith("business", businessBlock.id);
  });

  it("Nachbarn laufen zur Bildschirmkante weich aus (Verlauf statt hartem Beschnitt)", async () => {
    const at = new Date("2026-10-06T17:35:00Z");
    await render(<NowView result={online()} now={at} actions={actions()} />);
    const hidden = { includeHiddenElements: true };
    const prev = screen.getByTestId("focus-ghost-prev", hidden);
    const next = screen.getByTestId("focus-ghost-next", hidden);
    // Der Verlauf liegt jeweils auf der äußeren, angeschnittenen Kante.
    expect(within(prev).getByTestId("focus-fade-top", hidden)).toBeTruthy();
    expect(within(next).getByTestId("focus-fade-bottom", hidden)).toBeTruthy();
    // Der Block selbst ist schmaler als sein Ausschnitt: Unschärfe wird seitlich nicht beschnitten.
    const block = StyleSheet.flatten(
      screen.getByTestId("focus-ghost-next-block", hidden).props.style,
    );
    expect(block.width).toBe("88%");
    expect(StyleSheet.flatten(next.props.style)).toMatchObject({ alignSelf: "stretch" });
  });

  it("kompakter Notizzugang: erste Zeile, öffnet den Editor; offline ehrlich", async () => {
    const a = actions();
    const note = {
      id: "6f9619ff-8b86-4d01-b42d-00c04fc964ff",
      revision: 1,
      content: "Material bereitlegen (Beispiel)\nZweite Zeile",
      updatedAt: "2026-10-06T06:12:00.000Z",
    };
    const { rerender } = await render(
      <NowView result={online()} now={NOW} actions={a} todayNote={{ status: "ready", note }} />,
    );
    const row = screen.getByRole("button", { name: /Tagesnotiz von heute öffnen/ });
    expect(row).toHaveTextContent(/Material bereitlegen \(Beispiel\)/);
    expect(row).not.toHaveTextContent(/Zweite Zeile/);
    await fireEvent.press(row);
    expect(a.openNote).toHaveBeenCalled();

    await rerender(
      <NowView result={online()} now={NOW} actions={a} todayNote={{ status: "offline" }} />,
    );
    expect(screen.getByRole("button", { name: /Tagesnotiz von heute öffnen/ })).toHaveTextContent(
      /Ohne Verbindung nicht verfügbar/,
    );
  });
});

describe("NowView – erster Bildschirm", () => {
  const note = {
    id: "6f9619ff-8b86-4d01-b42d-00c04fc964ff",
    revision: 1,
    content: "Notiz (Beispiel)",
    updatedAt: "2026-10-06T06:12:00.000Z",
  };

  /** Wie `online()`, zusätzlich ein Block am Vormittag: Davor, Jetzt und Danach liegen heute. */
  function fullDay(): PlanResult {
    const base = online();
    const week = base.snapshot.weeks[0];
    if (!week) throw new Error("Woche fehlt");
    const morning = entry("Vormittag (Beispiel)", "duty", "2026-10-06", "09:00", "12:00");
    return {
      ...base,
      snapshot: {
        ...base.snapshot,
        weeks: [{ ...week, schedule_entries: [...week.schedule_entries, morning] }],
      },
    };
  }

  function renderIn(viewport: { height: number; width: number }) {
    return render(
      <ViewportProvider value={{ ...viewport, paddingTop: 8 }}>
        <NowView
          result={fullDay()}
          now={NOW}
          actions={actions()}
          todayNote={{ status: "ready", note }}
        />
      </ViewportProvider>,
    );
  }

  it.each([
    ["kleines Handy", { height: 560, width: 360 }],
    ["großes Handy", { height: 820, width: 412 }],
    ["Querformat", { height: 330, width: 780 }],
  ])(
    "%s: Fokusbereich füllt die gemessene Höhe, „Als Nächstes“ folgt darunter",
    async (_, viewport) => {
      await renderIn(viewport);
      const fold = screen.getByTestId("now-fold");
      expect(StyleSheet.flatten(fold.props.style).minHeight).toBe(viewport.height - 8);
      // Im Fokusbereich: Uhrzeit, Nachbarn, aktueller Block und Tagesnotiz …
      const hidden = { includeHiddenElements: true };
      expect(within(fold).getByTestId("focus-card")).toBeTruthy();
      expect(within(fold).getByTestId("focus-ghost-prev", hidden)).toBeTruthy();
      expect(within(fold).getByTestId("focus-ghost-next", hidden)).toBeTruthy();
      expect(
        within(fold).getByRole("button", { name: /Tagesnotiz von heute öffnen/ }),
      ).toBeTruthy();
      // … „Als Nächstes“ und die Wochenziele erst danach.
      expect(within(fold).queryByRole("header", { name: "Als Nächstes" })).toBeNull();
      expect(within(fold).queryByRole("header", { name: "Diese Woche" })).toBeNull();
      expect(screen.getByRole("header", { name: "Als Nächstes" })).toBeOnTheScreen();
    },
  );

  it("ohne gemessene Höhe (z. B. erster Frame) keine feste Mindesthöhe", async () => {
    await render(<NowView result={online()} now={NOW} actions={actions()} />);
    expect(
      StyleSheet.flatten(screen.getByTestId("now-fold").props.style).minHeight,
    ).toBeUndefined();
  });

  it("Anschnitt der Nachbarn wächst mit Bildschirmhöhe und Schriftgröße, begrenzt", () => {
    expect(ghostPeek(0, 1)).toBe(48);
    expect(ghostPeek(330, 1)).toBe(36);
    expect(ghostPeek(700, 1)).toBe(56);
    expect(ghostPeek(1200, 1)).toBe(72);
    expect(ghostPeek(700, 1.3)).toBe(73);
    expect(ghostPeek(700, 2)).toBe(78);
    expect(ghostPeek(700, 0.85)).toBe(56);
  });

  it("nutzt die Höhe für den Anschnitt der Nachbarn", async () => {
    await renderIn({ height: 700, width: 400 });
    const ghost = screen.getByTestId("focus-ghost-next", { includeHiddenElements: true });
    expect(StyleSheet.flatten(ghost.props.style).height).toBe(
      ghostPeek(700, Dimensions.get("window").fontScale),
    );
  });
});

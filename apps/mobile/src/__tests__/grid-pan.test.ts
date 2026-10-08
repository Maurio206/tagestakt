/**
 * Gestenlogik des Wochenrasters: Schwelle, beide Achsen, Grenzen und – als Regressionstest für
 * den Gerätefehler „erste Geste geht, danach verzögert/blockiert/nur eine Achse“ – beliebig viele
 * Gesten unmittelbar nacheinander über die echte PanResponder-Anbindung.
 */
import { Animated } from "react-native";

import { DRAG_SLOP, clampOffset, createGridPan, isDrag, panTo } from "@/components/grid-pan";

import { drag, finger } from "./gesture";

const bounds = { maxX: 500, maxY: 800 };

function setup(initial = { x: 0, y: 0 }) {
  const pan = createGridPan(initial);
  const onOffsetChange = jest.fn();
  const onActiveChange = jest.fn();
  pan.update(bounds, { onOffsetChange, onActiveChange });
  const target = { props: pan.panHandlers as unknown as Record<string, unknown> };
  const shown = () => ({
    x: (pan.x as unknown as { __getValue: () => number }).__getValue(),
    y: (pan.y as unknown as { __getValue: () => number }).__getValue(),
  });
  return { pan, target, shown, onOffsetChange, onActiveChange };
}

describe("Gestenlogik Wochenraster – Grundregeln", () => {
  it("unterscheidet Antippen (≤ 6 dp) von Ziehen", () => {
    expect(DRAG_SLOP).toBe(6);
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(5, -6)).toBe(false);
    expect(isDrag(7, 0)).toBe(true);
    expect(isDrag(0, -7)).toBe(true);
    expect(isDrag(5, 5)).toBe(false); // leichtes Zittern bleibt ein Antippen
  });

  it("bewegt diagonal beide Achsen zugleich, gerade nur eine", () => {
    const start = { x: 100, y: 200 };
    expect(panTo(start, -40, -60, bounds)).toEqual({ x: 140, y: 260 });
    expect(panTo(start, -40, 0, bounds)).toEqual({ x: 140, y: 200 });
    expect(panTo(start, 0, 60, bounds)).toEqual({ x: 100, y: 140 });
  });

  it("begrenzt auf den Inhalt – auch, wenn nichts zu verschieben ist", () => {
    expect(panTo({ x: 10, y: 10 }, 50, 50, bounds)).toEqual({ x: 0, y: 0 });
    expect(panTo({ x: 490, y: 790 }, -50, -50, bounds)).toEqual({ x: 500, y: 800 });
    expect(clampOffset({ x: 300, y: 300 }, { maxX: 0, maxY: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("zieht die Position nach, wenn der Ausschnitt größer wird (Drehen, Vollbild)", () => {
    const report = jest.fn();
    const pan = createGridPan({ x: 450, y: 700 });
    pan.update(bounds, { onOffsetChange: report });
    expect(report).not.toHaveBeenCalled(); // passt noch
    pan.update({ maxX: 300, maxY: 900 }, { onOffsetChange: report });
    expect(report).toHaveBeenLastCalledWith({ x: 300, y: 700 });
    expect(pan.position()).toEqual({ x: 300, y: 700 });
  });
});

describe("Gestenlogik Wochenraster – über die echte PanResponder-Anbindung", () => {
  it("20 diagonale Gesten unmittelbar nacheinander: jede wirkt sofort und vollständig", async () => {
    const { target, shown } = setup();
    for (let i = 1; i <= 20; i += 1) {
      await drag(target, { dx: -10, dy: -15 });
      expect(shown()).toEqual({ x: 10 * i, y: 15 * i });
    }
  });

  it("diagonal → horizontal → vertikal ohne Pause, mehrfach im Wechsel", async () => {
    const { target, shown } = setup({ x: 100, y: 100 });
    for (let round = 0; round < 3; round += 1) {
      const before = shown();
      await drag(target, { dx: -40, dy: -30 });
      expect(shown()).toEqual({ x: before.x + 40, y: before.y + 30 });
      await drag(target, { dx: 25, dy: 0 });
      expect(shown()).toEqual({ x: before.x + 15, y: before.y + 30 });
      await drag(target, { dx: 0, dy: 20 });
      expect(shown()).toEqual({ x: before.x + 15, y: before.y + 10 });
    }
  });

  it("schnelles Loslassen: kein Nachlaufen, nichts animiert – die nächste Berührung greift sofort", async () => {
    const decay = jest.spyOn(Animated, "decay");
    const timing = jest.spyOn(Animated, "timing");
    const spring = jest.spyOn(Animated, "spring");
    const { pan, target, shown } = setup();
    await drag(target, { dx: -200, dy: -200 }, { release: "fast" });
    expect(shown()).toEqual({ x: 200, y: 200 }); // steht exakt dort, wo losgelassen wurde
    expect(decay).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalled();
    expect(spring).not.toHaveBeenCalled();
    // Werte bleiben in JS: `setValue` wirkt sofort, die Position ist synchron lesbar.
    expect((pan.x as unknown as { __isNative: boolean }).__isNative).toBe(false);
    await drag(target, { dx: 50, dy: -20 }, { release: "fast" });
    expect(shown()).toEqual({ x: 150, y: 220 });
    jest.restoreAllMocks();
  });

  it("neue Berührung, obwohl das Ende der vorigen verloren ging: setzt an der sichtbaren Stelle an", async () => {
    const { target, shown } = setup();
    await drag(target, { dx: -60, dy: -40 }, { release: "none" }); // kein Loslassen-Ereignis
    expect(shown()).toEqual({ x: 60, y: 40 });
    await drag(target, { dx: -20, dy: -20 });
    expect(shown()).toEqual({ x: 80, y: 60 });
  });

  it("Loslassen und Abbruch lösen jede Sperre und melden die sichtbare Endposition", async () => {
    const { target, onActiveChange, onOffsetChange } = setup();
    await drag(target, { dx: -30, dy: -30 }, { release: "up" });
    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
    expect(onOffsetChange).toHaveBeenLastCalledWith({ x: 30, y: 30 });

    onActiveChange.mockClear();
    await drag(target, { dx: -10, dy: 0 }, { release: "terminate" });
    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
    expect(onOffsetChange).toHaveBeenLastCalledWith({ x: 40, y: 30 });

    // Danach sofort wieder bedienbar.
    await drag(target, { dx: 0, dy: -10 });
    expect(onOffsetChange).toHaveBeenLastCalledWith({ x: 40, y: 40 });
  });

  it("Ausblenden mitten in der Geste löst die Sperre (z. B. Vollbild schließen)", async () => {
    const { pan, target, onActiveChange } = setup();
    await drag(target, { dx: -30, dy: 0 }, { release: "none" });
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    pan.cancel();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("Antippen beansprucht das Raster nicht; erst Bewegung über der Schwelle", async () => {
    const { target } = setup();
    const f = finger(target);
    expect(f.down()).toEqual({ capture: false, bubble: false });
    expect(await f.move(3, -4)).toBe(false);
    expect(await f.move(9, -4)).toBe(true);
  });
});

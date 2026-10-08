import { useEffect, useMemo, useState } from "react";
import { Animated, PanResponder } from "react-native";

/**
 * Freies zweidimensionales Verschieben des Wochenrasters mit einem Finger (diagonal, rein
 * horizontal oder rein vertikal) – ohne die Achsensperre verschachtelter ScrollViews. Nur
 * Bordmittel von React Native: `PanResponder` für die Geste, `Animated` für die Verschiebung.
 *
 * Bewusst **ohne Nachlaufen (Momentum)**: Ein nativ animierter Schwung macht die Werte „nativ“;
 * danach ist die aktuelle Position nur noch asynchron lesbar (`stopAnimation` → Rückruf über die
 * native Brücke). Das verzögerte bzw. verschluckte im Gerätetest neue Gesten und verschob
 * Achsen. Hier gilt: Die Position lebt synchron in JS, ist immer die sichtbare Endposition, und
 * jede neue Berührung übernimmt sie sofort – ohne Timer, Rückruf oder Wartezeit.
 */

export interface GridOffset {
  x: number;
  y: number;
}

export interface GridBounds {
  /** Größte Verschiebung (Inhalt minus sichtbarer Ausschnitt), mindestens 0. */
  maxX: number;
  maxY: number;
}

/** Ab dieser Bewegung (dp) gilt eine Berührung als Ziehen – darunter bleibt es ein Antippen. */
export const DRAG_SLOP = 6;

export function isDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP;
}

export function clampOffset(offset: GridOffset, bounds: GridBounds): GridOffset {
  return {
    x: Math.min(Math.max(offset.x, 0), bounds.maxX),
    y: Math.min(Math.max(offset.y, 0), bounds.maxY),
  };
}

/** Neue Position: Der Inhalt folgt dem Finger auf beiden Achsen zugleich, begrenzt auf den Inhalt. */
export function panTo(start: GridOffset, dx: number, dy: number, bounds: GridBounds): GridOffset {
  return clampOffset({ x: start.x - dx, y: start.y - dy }, bounds);
}

/** Verschiebung als Transform (zusätzlich begrenzt, falls Grenzen und Wert kurz abweichen). */
function shift(value: Animated.Value, max: number) {
  return value.interpolate({
    inputRange: [0, Math.max(1, max)],
    outputRange: [0, -max],
    extrapolate: "clamp",
  });
}

export interface GridPanCallbacks {
  /** Position nach jeder Geste (Loslassen bzw. Abbruch) oder nach dem Nachziehen der Grenzen. */
  onOffsetChange?: (offset: GridOffset) => void;
  /** Geste aktiv (true) bzw. beendet (false) – z. B. für die Scrollsperre der Seite. */
  onActiveChange?: (active: boolean) => void;
}

/**
 * Gesten-Steuerung ohne React: Position, Startpunkt und Grenzen leben in dieser Closure und
 * werden nur in Gesten-Ereignissen bzw. über `update` (Effekt) gelesen und geschrieben. Die
 * Werte werden nie nativ animiert, `setValue` wirkt deshalb sofort.
 */
export function createGridPan(initial: GridOffset) {
  const x = new Animated.Value(initial.x);
  const y = new Animated.Value(initial.y);
  let position: GridOffset = { ...initial };
  let start: GridOffset | null = null;
  let bounds: GridBounds = { maxX: Number.MAX_SAFE_INTEGER, maxY: Number.MAX_SAFE_INTEGER };
  let callbacks: GridPanCallbacks = {};

  const moveTo = (next: GridOffset) => {
    position = next;
    x.setValue(next.x);
    y.setValue(next.y);
  };

  /** Ende einer Geste (Loslassen, Abbruch, Ausblenden): Sperren lösen, Position melden. */
  const finish = () => {
    if (!start) return;
    start = null;
    callbacks.onActiveChange?.(false);
    callbacks.onOffsetChange?.(position);
  };

  const responder = PanResponder.create({
    // Antippen gehört den Blöcken; erst eine echte Bewegung übernimmt das Raster.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_, g) => isDrag(g.dx, g.dy),
    onMoveShouldSetPanResponder: (_, g) => isDrag(g.dx, g.dy),
    onPanResponderGrant: () => {
      // Sofort von der sichtbaren Stelle aus weiterziehen – auch falls ein Ende verloren ging.
      start = clampOffset(position, bounds);
      position = start;
      callbacks.onActiveChange?.(true);
    },
    onPanResponderMove: (_, g) => {
      if (start) moveTo(panTo(start, g.dx, g.dy, bounds));
    },
    onPanResponderRelease: finish,
    onPanResponderTerminate: finish,
    // Seite und System dürfen die Geste nicht mittendrin übernehmen.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  });

  return {
    x,
    y,
    panHandlers: responder.panHandlers,
    /** Aktuelle (sichtbare) Position. */
    position: () => ({ ...position }),
    /** Laufende Geste beenden, z. B. beim Ausblenden des Rasters. */
    cancel: finish,
    /** Neue Grenzen (Drehen, Vollbild, Schriftgröße) übernehmen und die Position nachziehen. */
    update(next: GridBounds, nextCallbacks: GridPanCallbacks = {}) {
      bounds = next;
      callbacks = nextCallbacks;
      const clamped = clampOffset(position, bounds);
      if (clamped.x !== position.x || clamped.y !== position.y) {
        moveTo(clamped);
        if (start) start = clampOffset(start, bounds);
        else callbacks.onOffsetChange?.(clamped);
      }
    },
  };
}

export function useGridPan({
  initial,
  maxX,
  maxY,
  onOffsetChange,
  onActiveChange,
}: GridBounds &
  GridPanCallbacks & {
    initial: GridOffset;
  }) {
  const [pan] = useState(() => createGridPan(initial));
  useEffect(() => {
    pan.update({ maxX, maxY }, { onOffsetChange, onActiveChange });
  }, [pan, maxX, maxY, onOffsetChange, onActiveChange]);
  // Ausblenden mitten in der Geste (Vollbild schließen, Tab wechseln): Sperren lösen.
  useEffect(() => () => pan.cancel(), [pan]);
  const shiftX = useMemo(() => shift(pan.x, maxX), [pan, maxX]);
  const shiftY = useMemo(() => shift(pan.y, maxY), [pan, maxY]);
  return { panHandlers: pan.panHandlers, shiftX, shiftY };
}

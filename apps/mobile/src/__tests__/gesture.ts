/**
 * Testhilfe: Ein Finger auf einem Responder (z. B. dem Wochenraster). Erzeugt Ereignisse mit
 * Berührungsverlauf (`touchHistory`), wie React Native sie an die Responder-Props liefert – so
 * läuft die echte PanResponder-Logik, keine nachgebaute Gestenerkennung.
 */
import { act } from "@testing-library/react-native";

type Handler = (event: unknown) => unknown;

/** Element bzw. Objekt mit Responder-Props (`panHandlers`). */
export interface ResponderTarget {
  props: Record<string, unknown>;
}

function handler(target: ResponderTarget, name: string): Handler {
  const fn = target.props[name];
  if (typeof fn !== "function") throw new Error(`Responder-Prop fehlt: ${name}`);
  return fn as Handler;
}

export function finger(target: ResponderTarget, from = { x: 200, y: 200 }) {
  let time = 1000;
  let previous = { ...from };
  let granted = false;
  const event = (dx: number, dy: number, active = true, pause = 16) => {
    time += pause;
    const x = from.x + dx;
    const y = from.y + dy;
    const touch = {
      pageX: x,
      pageY: y,
      locationX: x,
      locationY: y,
      identifier: 0,
      timestamp: time,
    };
    const result = {
      nativeEvent: { ...touch, touches: active ? [touch] : [], changedTouches: [touch] },
      touchHistory: {
        numberActiveTouches: active ? 1 : 0,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: time,
        touchBank: [
          {
            touchActive: active,
            startPageX: from.x,
            startPageY: from.y,
            startTimeStamp: 1000,
            currentPageX: x,
            currentPageY: y,
            currentTimeStamp: time,
            previousPageX: previous.x,
            previousPageY: previous.y,
            previousTimeStamp: time - pause,
          },
        ],
      },
    };
    previous = { x, y };
    return result;
  };
  const rest = () => ({ dx: previous.x - from.x, dy: previous.y - from.y });
  return {
    event,
    /** Finger auf: fragt ab, ob das Ziel die Berührung sofort beansprucht. */
    down() {
      const start = event(0, 0, true, 0);
      return {
        capture: handler(target, "onStartShouldSetResponderCapture")(start),
        bubble: handler(target, "onStartShouldSetResponder")(start),
      };
    },
    /** Bewegung relativ zum Startpunkt; liefert, ob das Ziel die Geste führt. */
    async move(dx: number, dy: number, pause = 16) {
      const e = event(dx, dy, true, pause);
      if (!granted) {
        if (!handler(target, "onMoveShouldSetResponderCapture")(e)) return false;
        granted = true;
        await act(async () => handler(target, "onResponderGrant")(e));
        return true;
      }
      await act(async () => handler(target, "onResponderMove")(e));
      return true;
    },
    /** Finger ab; `fast` = ohne vorheriges Ruhen (hohe Geschwindigkeit beim Loslassen). */
    async up({ fast = false }: { fast?: boolean } = {}) {
      const { dx, dy } = rest();
      if (granted && !fast)
        await act(async () => handler(target, "onResponderMove")(event(dx, dy)));
      await act(async () => handler(target, "onResponderRelease")(event(dx, dy, false)));
    },
    /** Das System bricht die Geste ab (z. B. ein anderer Responder übernimmt). */
    async terminate() {
      const { dx, dy } = rest();
      await act(async () => handler(target, "onResponderTerminate")(event(dx, dy, false)));
    },
  };
}

/** Ziehen um (dx, dy): erst über die Schwelle, dann in Schritten ans Ziel; danach loslassen. */
export async function drag(
  target: ResponderTarget,
  { dx, dy }: { dx: number; dy: number },
  { release = "up" }: { release?: "up" | "fast" | "terminate" | "none" } = {},
) {
  const f = finger(target);
  f.down();
  // Über die Schwelle (6 dp): ab dort zählt die Bewegung – wie auf dem Gerät.
  const sx = dx === 0 ? 10 : Math.sign(dx) * 10;
  const sy = dy === 0 ? 0 : Math.sign(dy) * 10;
  await f.move(sx, sy);
  const steps = 4;
  for (let i = 1; i <= steps; i += 1) await f.move(sx + (dx * i) / steps, sy + (dy * i) / steps);
  if (release === "up") await f.up();
  if (release === "fast") await f.up({ fast: true });
  if (release === "terminate") await f.terminate();
  return f;
}

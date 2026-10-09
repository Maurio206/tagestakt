import { type Tone, categoryTone } from "@tagestakt/design-tokens";
import {
  type PlanSnapshot,
  type WidgetTimeline,
  buildWidgetTimeline,
} from "@tagestakt/schedule-schema";
import { NativeModules, Platform } from "react-native";

/**
 * Android-Startbildschirm-Widget „Jetzt und danach“ – Brücke zum nativen Widget, das
 * `plugins/with-android-widget.js` beim Prebuild erzeugt.
 *
 * Das Widget hat keine eigene Datenquelle und keinen Netzwerkzugang: Nach jedem Planstand der
 * App wird aus dem vorhandenen Snapshot eine bereinigte Zeitleiste berechnet
 * (`buildWidgetTimeline`, nur veröffentlichte Blöcke, ohne Notizen und Orte, bei App-Sperre
 * ohne Titel) und im app-internen Speicher des Widgets abgelegt. Keine Tokens, keine
 * API-Antworten. Beim Abmelden wird alles gelöscht.
 */

export const HOME_WIDGET_MODULE = "TagesTaktWidget";

interface NativeHomeWidget {
  setData(json: string): Promise<boolean>;
  clear(): Promise<boolean>;
}

function nativeWidget(): NativeHomeWidget | null {
  if (Platform.OS !== "android") return null;
  const modules = NativeModules as Record<string, NativeHomeWidget | undefined>;
  return modules[HOME_WIDGET_MODULE] ?? null;
}

interface PayloadSegment {
  from: number;
  until: number;
  kind: "plan" | "empty";
  description: string;
  current?: { kind: "block" | "free"; tone: Tone | "free"; title: string; meta: string };
  next?: { tone: Tone; time: string; text: string } | null;
}

/** Format für das native Widget (v1): Kategorie als Farbton der Design-Tokens. */
export function toWidgetPayload(timeline: WidgetTimeline): string {
  const segments = timeline.segments.map((segment): PayloadSegment => {
    const { from, until, description } = segment;
    if (segment.kind === "empty") return { from, until, kind: "empty", description };
    const { current, next } = segment;
    return {
      from,
      until,
      kind: "plan",
      description,
      current: {
        kind: current.kind,
        tone: current.kind === "block" ? categoryTone[current.category] : "free",
        title: current.title,
        meta: current.meta,
      },
      next: next ? { tone: categoryTone[next.category], time: next.time, text: next.text } : null,
    };
  });
  return JSON.stringify({
    v: timeline.version,
    generatedAt: timeline.generatedAt,
    validUntil: timeline.validUntil,
    segments,
  });
}

/** Aktualisiert das Widget aus dem aktuellen Planstand (ohne natives Widget: nichts). */
export async function updateHomeWidget(input: {
  snapshot: PlanSnapshot;
  /** false bei aktiver App-Sperre – dann nur Kategorie und Zeit. */
  showTitles: boolean;
  now: Date;
}): Promise<void> {
  const widget = nativeWidget();
  if (!widget) return;
  const timeline = buildWidgetTimeline({
    weeks: input.snapshot.weeks,
    fetchedAt: input.snapshot.fetchedAt,
    now: input.now,
    showTitles: input.showTitles,
  });
  await widget.setData(toWidgetPayload(timeline));
}

/** Löscht die Widget-Daten sofort; das Widget zeigt danach einen neutralen Zustand. */
export async function clearHomeWidget(): Promise<void> {
  const widget = nativeWidget();
  if (!widget) return;
  await widget.clear();
}

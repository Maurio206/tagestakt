/**
 * Startbildschirm-Widget – App-Seite: bereinigte Daten aus dem vorhandenen Plan-Snapshot
 * (keine zweite Datenquelle), Farbtöne aus den Design-Tokens, keine Notizen/Orte/IDs, bei
 * App-Sperre ohne Titel, Löschen beim Abmelden; ohne natives Modul (iOS, Tests) kein Fehler.
 */
import { categoryTone } from "@tagestakt/design-tokens";
import { buildWidgetTimeline, resolveWidgetView } from "@tagestakt/schedule-schema";
import { NativeModules, Platform } from "react-native";

import {
  HOME_WIDGET_MODULE,
  clearHomeWidget,
  toWidgetPayload,
  updateHomeWidget,
} from "@/lib/home-widget";

import { NOW, businessBlock, entry, snapshot, sportBlock } from "./fixtures";

type Payload = {
  v: number;
  generatedAt: number;
  validUntil: number;
  segments: {
    from: number;
    until: number;
    kind: string;
    description: string;
    current?: { kind: string; tone: string; title: string; meta: string };
    next?: { tone: string; time: string; text: string } | null;
  }[];
};

const native = {
  setData: jest.fn(async (_json: string) => true),
  clear: jest.fn(async () => true),
};
const modules = NativeModules as Record<string, unknown>;

function setPlatform(os: "android" | "ios") {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

beforeEach(() => {
  modules[HOME_WIDGET_MODULE] = native;
  setPlatform("android");
});

afterAll(() => {
  delete modules[HOME_WIDGET_MODULE];
});

function sentPayload(): Payload {
  const json = native.setData.mock.calls.at(-1)?.[0];
  if (!json) throw new Error("setData wurde nicht aufgerufen");
  return JSON.parse(json) as Payload;
}

describe("updateHomeWidget", () => {
  it("überträgt die vorberechnete Zeitleiste aus dem Plan-Snapshot", async () => {
    await updateHomeWidget({ snapshot: snapshot(NOW.toISOString()), showTitles: true, now: NOW });
    const payload = sentPayload();
    expect(payload.v).toBe(1);
    expect(payload.generatedAt).toBe(NOW.getTime());
    const first = payload.segments[0];
    expect(first?.kind).toBe("plan");
    expect(first?.current).toEqual({
      kind: "block",
      tone: categoryTone.business,
      title: "Gewerbe-Block (Beispiel)",
      meta: "Gewerbe · 15:30–19:30",
    });
    expect(first?.next).toEqual({
      tone: categoryTone.sport,
      time: "19:45",
      text: "Training (Beispiel) · Sport",
    });
  });

  it("entspricht genau buildWidgetTimeline (gleiche Segmente wie die Zeitlogik)", async () => {
    const data = snapshot(NOW.toISOString());
    await updateHomeWidget({ snapshot: data, showTitles: true, now: NOW });
    const timeline = buildWidgetTimeline({
      weeks: data.weeks,
      fetchedAt: data.fetchedAt,
      now: NOW,
      showTitles: true,
    });
    expect(sentPayload().segments.map((s) => [s.from, s.until, s.kind])).toEqual(
      timeline.segments.map((s) => [s.from, s.until, s.kind]),
    );
    expect(sentPayload()).toEqual(JSON.parse(toWidgetPayload(timeline)));
  });

  it("enthält keine Notizen, Orte, IDs oder Rohdaten des Plans", async () => {
    const secret = {
      ...entry("Arzt (Beispiel)", "appointment", "2026-10-06", "21:00", "22:00"),
      location: "Praxis Musterstraße (Beispiel)",
      note: "Vertraulich (Beispiel)",
    };
    const data = snapshot(NOW.toISOString());
    data.weeks[0]?.schedule_entries.push(secret);
    await updateHomeWidget({ snapshot: data, showTitles: true, now: NOW });
    const json = native.setData.mock.calls.at(-1)?.[0] ?? "";
    expect(json).not.toContain("Praxis");
    expect(json).not.toContain("Vertraulich");
    expect(json).not.toContain(businessBlock.id);
    expect(json).not.toContain(data.weeks[0]?.owner_id ?? "-");
    expect(json).not.toMatch(/"(id|owner_id|note|location|start_at|end_at|access_token)"/);
  });

  it("App-Sperre aktiv: nur Kategorie und Zeit, keine Titel", async () => {
    await updateHomeWidget({ snapshot: snapshot(NOW.toISOString()), showTitles: false, now: NOW });
    const json = native.setData.mock.calls.at(-1)?.[0] ?? "";
    expect(json).not.toContain("Beispiel");
    expect(sentPayload().segments[0]?.current).toMatchObject({
      title: "Gewerbe",
      meta: "15:30–19:30",
    });
    expect(sentPayload().segments[0]?.next?.text).toBe("Sport");
  });

  it("ignoriert Entwürfe im Snapshot", async () => {
    const data = snapshot(NOW.toISOString());
    const draft = { ...data, weeks: data.weeks.map((w) => ({ ...w, status: "draft" as const })) };
    await updateHomeWidget({
      snapshot: draft as unknown as typeof data,
      showTitles: true,
      now: NOW,
    });
    expect(sentPayload().segments.map((s) => s.kind)).toEqual(["empty"]);
  });

  it("zu alter Offline-Stand: keine Segmente – das Widget zeigt „Plan nicht aktuell“", async () => {
    const old = new Date(NOW.getTime() - 3 * 24 * 3_600_000).toISOString();
    await updateHomeWidget({ snapshot: snapshot(old), showTitles: true, now: NOW });
    expect(sentPayload().segments).toHaveLength(0);
    const timeline = buildWidgetTimeline({
      weeks: [],
      fetchedAt: old,
      now: NOW,
      showTitles: true,
    });
    expect(resolveWidgetView(timeline, NOW).state).toBe("stale");
  });

  it("ohne natives Modul (z. B. iOS) passiert nichts", async () => {
    setPlatform("ios");
    await updateHomeWidget({ snapshot: snapshot(NOW.toISOString()), showTitles: true, now: NOW });
    expect(native.setData).not.toHaveBeenCalled();
    setPlatform("android");
    delete modules[HOME_WIDGET_MODULE];
    await expect(
      updateHomeWidget({ snapshot: snapshot(NOW.toISOString()), showTitles: true, now: NOW }),
    ).resolves.toBeUndefined();
    await expect(clearHomeWidget()).resolves.toBeUndefined();
  });
});

describe("clearHomeWidget", () => {
  it("löscht die Widget-Daten über das native Modul", async () => {
    await clearHomeWidget();
    expect(native.clear).toHaveBeenCalledTimes(1);
  });
});

describe("Datenformat", () => {
  it("bildet jede Kategorie auf einen Farbton der Design-Tokens ab", () => {
    const blocks = [businessBlock, sportBlock];
    const timeline = buildWidgetTimeline({
      weeks: [{ status: "published", schedule_entries: blocks }],
      fetchedAt: NOW,
      now: NOW,
      showTitles: true,
    });
    const payload = JSON.parse(toWidgetPayload(timeline)) as Payload;
    const tones = new Set(
      payload.segments.flatMap((s) => [s.current?.tone, s.next?.tone]).filter(Boolean),
    );
    for (const tone of tones) {
      expect([...Object.values(categoryTone), "free"]).toContain(tone);
    }
  });
});

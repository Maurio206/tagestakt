import { describe, expect, it } from "vitest";

import type { EntryCategory } from "./constants";
import { resolveTimeRange } from "./schedule";
import { zonedDateTimeToInstant } from "./time";
import {
  WIDGET_MAX_AGE_HOURS,
  WIDGET_PAYLOAD_VERSION,
  type WidgetBlockSource,
  type WidgetTimeline,
  type WidgetWeekSource,
  buildWidgetTimeline,
  resolveWidgetView,
} from "./widget";

interface TestEntry extends WidgetBlockSource {
  location: string | null;
  note: string | null;
}

/** Block in Berliner Ortszeit (frei erfundene Beispieldaten). */
function block(
  id: string,
  category: EntryCategory,
  date: string,
  start: string,
  end: string,
  title = `${id} (Beispiel)`,
  nextDay = false,
): TestEntry {
  const range = resolveTimeRange(date, start, end, nextDay);
  return {
    id,
    title,
    category,
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
    location: "Ort (Beispiel)",
    note: "Vertrauliche Notiz (Beispiel)",
  };
}

const at = (date: string, time: string) => zonedDateTimeToInstant(date, time);
const week = (entries: TestEntry[], status = "published"): WidgetWeekSource<TestEntry> => ({
  status,
  schedule_entries: entries,
});

function timeline(
  entries: TestEntry[],
  now: Date,
  options: { showTitles?: boolean; fetchedAt?: Date; status?: string } = {},
): WidgetTimeline {
  return buildWidgetTimeline({
    weeks: [week(entries, options.status)],
    fetchedAt: options.fetchedAt ?? now,
    now,
    showTitles: options.showTitles ?? true,
  });
}

function view(t: WidgetTimeline, now: Date) {
  return resolveWidgetView(t, now);
}

// Freitag, 09.10.2026 (Sommerzeit, UTC+2)
const DAY = "2026-10-09";
const akquise = block("akquise", "business", DAY, "09:00", "11:00", "Akquise (Beispiel)");
const training = block("training", "sport", DAY, "11:30", "12:30", "Training (Beispiel)");
const abend = block("abend", "relationship", DAY, "19:00", "21:00", "Abend (Beispiel)");
const samstag = block("samstag", "duty", "2026-10-10", "07:00", "15:00", "Dienst (Beispiel)");
const plan = [abend, training, akquise, samstag];

describe("buildWidgetTimeline – aktueller und nächster Block", () => {
  it("zeigt den laufenden Block hervorgehoben und den nächsten mit Uhrzeit", () => {
    const now = at(DAY, "10:00");
    const result = view(timeline(plan, now), now);
    expect(result.state).toBe("plan");
    if (result.state !== "plan") return;
    expect(result.segment.current).toEqual({
      kind: "block",
      category: "business",
      title: "Akquise (Beispiel)",
      meta: "Gewerbe · 09:00–11:00",
    });
    expect(result.segment.next).toEqual({
      category: "sport",
      time: "11:30",
      text: "Training (Beispiel) · Sport",
    });
    expect(result.segment.description).toBe(
      "Jetzt: Akquise (Beispiel), Gewerbe, 09:00 bis 11:00. Danach: 11:30 Training (Beispiel), Sport.",
    );
  });

  it("behandelt Blöcke halboffen: zur Endzeit frei, zur Startzeit der nächste Block", () => {
    const t = timeline(plan, at(DAY, "10:00"));
    const atEnd = view(t, at(DAY, "11:00"));
    expect(atEnd.state === "plan" && atEnd.segment.current).toEqual({
      kind: "free",
      title: "Freie Zeit",
      meta: "bis 11:30",
    });
    const atStart = view(t, at(DAY, "11:30"));
    expect(atStart.state === "plan" && atStart.segment.current.title).toBe("Training (Beispiel)");
  });

  it("zeigt vor dem ersten Block freie Zeit bis zum Beginn", () => {
    const now = at(DAY, "06:00");
    const result = view(timeline(plan, now), now);
    expect(result.state === "plan" && result.segment.current.meta).toBe("bis 09:00");
    expect(result.state === "plan" && result.segment.next?.time).toBe("09:00");
  });

  it("nennt bei Überschneidung den zuletzt begonnenen Block (wie „Jetzt“)", () => {
    const lang = block("lang", "duty", DAY, "08:00", "12:00", "Lang (Beispiel)");
    const kurz = block("kurz", "appointment", DAY, "10:00", "10:30", "Kurz (Beispiel)");
    const t = timeline([lang, kurz], at(DAY, "07:00"));
    const during = view(t, at(DAY, "10:15"));
    expect(during.state === "plan" && during.segment.current.title).toBe("Kurz (Beispiel)");
    const after = view(t, at(DAY, "10:30"));
    expect(after.state === "plan" && after.segment.current.title).toBe("Lang (Beispiel)");
    expect(after.state === "plan" && after.segment.next).toBeNull();
  });

  it("meldet, wenn nach dem aktuellen Block nichts mehr geplant ist", () => {
    const now = at("2026-10-10", "08:00");
    const result = view(timeline(plan, now), now);
    expect(result.state === "plan" && result.segment.next).toBeNull();
    expect(result.state === "plan" && result.segment.description).toBe(
      "Jetzt: Dienst (Beispiel), Dienst, 07:00 bis 15:00. Danach nichts mehr geplant.",
    );
  });

  it("wiederholt die Kategorie nicht, wenn der Titel ihr entspricht", () => {
    const sport = block("sport", "sport", DAY, "09:00", "10:00", "  Sport ");
    const now = at(DAY, "09:30");
    const result = view(timeline([sport], now), now);
    expect(result.state === "plan" && result.segment.current).toMatchObject({
      title: "Sport",
      meta: "09:00–10:00",
    });
  });

  it("macht Titel einzeilig und lässt Steuerzeichen weg", () => {
    const mehrzeilig = block("x", "other", DAY, "09:00", "10:00", "Zeile 1\nZeile\t2 (Beispiel)");
    const now = at(DAY, "09:30");
    const result = view(timeline([mehrzeilig], now), now);
    expect(result.state === "plan" && result.segment.current.title).toBe(
      "Zeile 1 Zeile 2 (Beispiel)",
    );
  });
});

describe("buildWidgetTimeline – Zeitleiste", () => {
  it("bildet lückenlose Segmente von jetzt bis zum Ablauf", () => {
    const now = at(DAY, "10:00");
    const t = timeline(plan, now);
    expect(t.version).toBe(WIDGET_PAYLOAD_VERSION);
    expect(t.generatedAt).toBe(now.getTime());
    expect(t.validUntil).toBe(now.getTime() + WIDGET_MAX_AGE_HOURS * 3_600_000);
    expect(t.segments[0]?.from).toBe(now.getTime());
    expect(t.segments.at(-1)?.until).toBe(t.validUntil);
    t.segments.forEach((segment, i) => {
      expect(segment.from).toBeLessThan(segment.until);
      if (i > 0) expect(segment.from).toBe(t.segments[i - 1]?.until);
    });
  });

  it("wechselt um Mitternacht (Berlin) die Beschriftung von „morgen“ auf die Uhrzeit", () => {
    const t = timeline(plan, at(DAY, "22:00"));
    const evening = view(t, at(DAY, "23:59"));
    expect(evening.state === "plan" && evening.segment.current.meta).toBe(
      "Heute nichts mehr geplant",
    );
    expect(evening.state === "plan" && evening.segment.next?.time).toBe("morgen 07:00");
    const midnight = at("2026-10-10", "00:00").getTime();
    expect(t.segments.some((s) => s.from === midnight)).toBe(true);
    const night = view(t, new Date(midnight));
    expect(night.state === "plan" && night.segment.current.meta).toBe("bis 07:00");
    expect(night.state === "plan" && night.segment.next?.time).toBe("07:00");
  });

  it("zeigt über den Wochenwechsel den ersten Block der nächsten veröffentlichten Woche", () => {
    const sonntag = block("sonntag", "leisure", "2026-10-11", "18:00", "19:00");
    const montag = block("montag", "duty", "2026-10-12", "07:00", "15:00", "Montag (Beispiel)");
    const now = at("2026-10-11", "20:00");
    const result = resolveWidgetView(
      buildWidgetTimeline({
        weeks: [week([sonntag]), week([montag])],
        fetchedAt: now,
        now,
        showTitles: true,
      }),
      now,
    );
    expect(result.state === "plan" && result.segment.next).toEqual({
      category: "duty",
      time: "morgen 07:00",
      text: "Montag (Beispiel) · Dienst",
    });
  });

  it("beschriftet Zeiten in Europe/Berlin – auch wenn der UTC-Tag abweicht", () => {
    // 00:30 Berlin = 22:30 UTC am Vortag
    const nacht = block("nacht", "sleep", "2026-10-10", "00:30", "06:30");
    const now = at("2026-10-10", "00:45");
    expect(now.toISOString()).toBe("2026-10-09T22:45:00.000Z");
    const result = view(timeline([nacht], now), now);
    expect(result.state === "plan" && result.segment.current.meta).toBe("Schlaf · 00:30–06:30");
  });

  it("rechnet über das Ende der Sommerzeit korrekt (25.10.2026, 03:00 → 02:00)", () => {
    const umstellung = block(
      "umstellung",
      "sleep",
      "2026-10-25",
      "01:30",
      "04:00",
      "Nacht (Beispiel)",
    );
    const morgens = block("morgens", "sport", "2026-10-25", "08:00", "09:00", "Lauf (Beispiel)");
    const montag = block("montag", "duty", "2026-10-26", "07:00", "15:00");
    const t = timeline([umstellung, morgens, montag], at("2026-10-24", "22:00"));
    // 3,5 Stunden statt 2,5: 01:30 CEST = 23:30 UTC, 04:00 CET = 03:00 UTC
    const during = view(t, new Date("2026-10-25T01:30:00.000Z"));
    expect(during.state === "plan" && during.segment.current.meta).toBe("Schlaf · 01:30–04:00");
    expect(during.state === "plan" && during.segment.next?.time).toBe("08:00");
    const saturday = view(t, at("2026-10-24", "23:00"));
    expect(saturday.state === "plan" && saturday.segment.next?.time).toBe("morgen 01:30");
    // Mitternacht zum Montag liegt im Winter bei 23:00 UTC
    const sundayLate = view(t, new Date("2026-10-25T22:59:00.000Z"));
    expect(sundayLate.state === "plan" && sundayLate.segment.next?.time).toBe("morgen 07:00");
    expect(t.segments.some((s) => s.from === Date.parse("2026-10-25T23:00:00.000Z"))).toBe(true);
    const monday = view(t, new Date("2026-10-25T23:00:00.000Z"));
    expect(monday.state === "plan" && monday.segment.next?.time).toBe("07:00");
    const after = view(t, new Date("2026-10-25T03:00:00.000Z"));
    expect(after.state === "plan" && after.segment.current).toEqual({
      kind: "free",
      title: "Freie Zeit",
      meta: "bis 08:00",
    });
  });

  it("rechnet über den Beginn der Sommerzeit korrekt (29.03.2026, 02:00 → 03:00)", () => {
    const umstellung = block(
      "umstellung",
      "sleep",
      "2026-03-29",
      "01:00",
      "04:00",
      "Nacht (Beispiel)",
    );
    const now = at("2026-03-29", "01:15");
    const t = timeline([umstellung], now);
    const result = view(t, now);
    expect(result.state === "plan" && result.segment.current.meta).toBe("Schlaf · 01:00–04:00");
    // Blockende 04:00 CEST = 02:00 UTC; Mitternacht zum Montag 22:00 UTC
    expect(t.segments.some((s) => s.from === Date.parse("2026-03-29T02:00:00.000Z"))).toBe(true);
  });
});

describe("buildWidgetTimeline – leere, verdeckte und nicht verfügbare Daten", () => {
  it("leerer Plan: ein leeres Segment bis zum Ablauf", () => {
    const now = at(DAY, "10:00");
    const t = buildWidgetTimeline({ weeks: [], fetchedAt: now, now, showTitles: true });
    expect(t.segments).toHaveLength(1);
    expect(t.segments[0]).toMatchObject({
      kind: "empty",
      from: now.getTime(),
      until: t.validUntil,
    });
    expect(view(t, now).state).toBe("empty");
  });

  it("ignoriert Entwürfe und archivierte Wochen", () => {
    const now = at(DAY, "10:00");
    expect(view(timeline(plan, now, { status: "draft" }), now).state).toBe("empty");
    expect(view(timeline(plan, now, { status: "archived" }), now).state).toBe("empty");
  });

  it("leer, wenn nach dem letzten Block nichts mehr folgt", () => {
    const now = at("2026-10-10", "16:00");
    expect(view(timeline(plan, now), now).state).toBe("empty");
  });

  it("App-Sperre: nur Kategorie und Zeit, keine Titel", () => {
    const now = at(DAY, "10:00");
    const t = timeline(plan, now, { showTitles: false });
    const result = view(t, now);
    expect(result.state === "plan" && result.segment.current).toEqual({
      kind: "block",
      category: "business",
      title: "Gewerbe",
      meta: "09:00–11:00",
    });
    expect(result.state === "plan" && result.segment.next?.text).toBe("Sport");
    expect(JSON.stringify(t)).not.toContain("Beispiel");
  });

  it("übernimmt nie Notizen, Orte oder IDs", () => {
    const now = at(DAY, "08:00");
    const json = JSON.stringify(timeline(plan, now));
    expect(json).not.toContain("Notiz");
    expect(json).not.toContain("Ort (Beispiel)");
    expect(json).not.toContain('akquise"');
    expect(json).not.toMatch(/"(id|note|location|start_at|end_at)"/);
  });

  it("Abmeldung: ohne Daten neutraler Zustand", () => {
    expect(resolveWidgetView(null, new Date())).toEqual({ state: "signed_out" });
  });

  it("veraltete Daten: nach Ablauf kein altes Segment mehr", () => {
    const now = at(DAY, "10:00");
    const t = timeline(plan, now);
    expect(view(t, new Date(t.validUntil - 1)).state).not.toBe("stale");
    expect(view(t, new Date(t.validUntil)).state).toBe("stale");
    expect(view(t, new Date(t.validUntil + 86_400_000)).state).toBe("stale");
  });

  it("veraltete Daten: zu alter Abruf ergibt sofort „veraltet“", () => {
    const now = at(DAY, "10:00");
    const fetchedAt = new Date(now.getTime() - (WIDGET_MAX_AGE_HOURS + 1) * 3_600_000);
    const t = timeline(plan, now, { fetchedAt });
    expect(t.segments).toHaveLength(0);
    expect(view(t, now).state).toBe("stale");
  });

  it("die Gültigkeit richtet sich nach dem Abruf, nicht nach dem Erzeugen", () => {
    const now = at(DAY, "10:00");
    const fetchedAt = new Date(now.getTime() - 40 * 3_600_000);
    const t = timeline(plan, now, { fetchedAt });
    expect(t.validUntil).toBe(fetchedAt.getTime() + WIDGET_MAX_AGE_HOURS * 3_600_000);
    expect(view(t, new Date(now.getTime() + 9 * 3_600_000)).state).toBe("stale");
  });

  it("Uhr vor dem Erzeugungszeitpunkt (zurückgestellt): „veraltet“ statt Rätselraten", () => {
    const now = at(DAY, "10:00");
    expect(view(timeline(plan, now), new Date(now.getTime() - 60_000)).state).toBe("stale");
  });

  it("unbekannte Formatversion gilt als veraltet", () => {
    const now = at(DAY, "10:00");
    const t = { ...timeline(plan, now), version: 99 } as unknown as WidgetTimeline;
    expect(view(t, now).state).toBe("stale");
  });
});

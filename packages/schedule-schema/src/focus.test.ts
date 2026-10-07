import { describe, expect, it } from "vitest";

import type { EntryCategory } from "./constants";
import {
  type FocusEntry,
  formatStartLabel,
  formatStartsIn,
  getFocusKey,
  getFocusState,
  minutesUntil,
  msUntilFocusChange,
} from "./focus";
import { getRemainingMinutes, resolveTimeRange } from "./schedule";
import { zonedDateTimeToInstant } from "./time";

interface TestEntry extends FocusEntry {
  title: string;
}

/** Block in Berliner Ortszeit. */
function block(
  id: string,
  category: EntryCategory,
  date: string,
  start: string,
  end: string,
  nextDay = false,
): TestEntry {
  const range = resolveTimeRange(date, start, end, nextDay);
  return {
    id,
    title: id,
    category,
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
  };
}

const at = (date: string, time: string) => zonedDateTimeToInstant(date, time);

// Mittwoch, 14.10.2026 (Beispieldaten wie im Design-Artefakt)
const DAY = "2026-10-14";
const duschen = block("duschen", "hygiene", DAY, "06:15", "06:45");
const dienst = block("dienst", "duty", DAY, "07:00", "16:30");
const kunde = block("kunde", "business", DAY, "17:00", "20:00");
const essen = block("essen", "meal", DAY, "20:00", "20:45");
const freizeit = block("freizeit", "leisure", DAY, "21:00", "22:00");
const morgen = block("morgen", "duty", "2026-10-15", "07:00", "16:30");
const week = [freizeit, essen, kunde, dienst, duschen, morgen];

function focus(
  now: Date,
  entries: TestEntry[] = week,
  running: Parameters<typeof getFocusState>[0]["running"] = null,
) {
  return getFocusState({ entries, running, now, hasPublishedPlan: true });
}

describe("getFocusState – Auswahl", () => {
  it("wählt den aktuell laufenden Block mit vorherigem und nächstem Block", () => {
    const state = focus(at(DAY, "18:05"));
    expect(state.kind).toBe("block");
    expect(state.current?.id).toBe("kunde");
    expect(state.previous?.id).toBe("dienst");
    expect(state.next?.id).toBe("essen");
    expect(state.nextIsToday).toBe(true);
    expect(state.overlapping).toEqual([]);
  });

  it("eine laufende Aktivität hat Vorrang vor dem geplanten Block", () => {
    const session = {
      id: "s1",
      schedule_entry_id: "kunde",
      started_at: at(DAY, "17:04").toISOString(),
      ended_at: null,
    };
    const state = focus(at(DAY, "18:05"), week, session);
    expect(state.kind).toBe("running");
    expect(state.session?.id).toBe("s1");
    expect(state.linked?.id).toBe("kunde");
    expect(state.current?.id).toBe("kunde");
    expect(state.previous?.id).toBe("dienst");
    expect(state.next?.id).toBe("essen");
  });

  it("eine laufende Aktivität ohne Planblock hat auch in freier Zeit Vorrang", () => {
    const session = {
      id: "s2",
      schedule_entry_id: null,
      started_at: at(DAY, "16:35").toISOString(),
      ended_at: null,
    };
    const state = focus(at(DAY, "16:40"), week, session);
    expect(state.kind).toBe("running");
    expect(state.linked).toBeUndefined();
    expect(state.current).toBeUndefined();
  });

  it("beendete Aktivitäten zählen nicht als laufend", () => {
    const session = {
      id: "s3",
      schedule_entry_id: null,
      started_at: at(DAY, "16:00").toISOString(),
      ended_at: at(DAY, "16:20").toISOString(),
    };
    expect(focus(at(DAY, "16:40"), week, session).kind).toBe("free");
  });

  it("freie Zeit zwischen zwei Blöcken: Davor und Danach, keine erfundene Aktivität", () => {
    const state = focus(at(DAY, "16:40"));
    expect(state.kind).toBe("free");
    expect(state.current).toBeUndefined();
    expect(state.session).toBeUndefined();
    expect(state.previous?.id).toBe("dienst");
    expect(state.next?.id).toBe("kunde");
    expect(minutesUntil(state.next?.start_at ?? "", at(DAY, "16:40"))).toBe(20);
  });

  it("vor dem ersten Block des Tages", () => {
    const state = focus(at(DAY, "05:50"));
    expect(state.kind).toBe("before_first");
    expect(state.previous).toBeUndefined();
    expect(state.next?.id).toBe("duschen");
  });

  it("nach dem letzten Block: nächster Block liegt morgen", () => {
    const state = focus(at(DAY, "22:40"));
    expect(state.kind).toBe("after_last");
    expect(state.previous?.id).toBe("freizeit");
    expect(state.next?.id).toBe("morgen");
    expect(state.nextIsToday).toBe(false);
  });

  it("ohne Blöcke heute: leerer Tag bzw. kein veröffentlichter Plan", () => {
    const now = at("2026-10-16", "12:00");
    expect(getFocusState({ entries: week, now, hasPublishedPlan: true }).kind).toBe("day_empty");
    expect(getFocusState({ entries: [], now, hasPublishedPlan: false }).kind).toBe("no_plan");
  });

  it("Davor zählt nur Blöcke von heute (nicht den Abend gestern)", () => {
    const state = focus(at("2026-10-15", "06:00"));
    expect(state.kind).toBe("before_first");
    expect(state.previous).toBeUndefined();
  });

  it("ein Block über Mitternacht zählt am Folgetag als vorheriger Block", () => {
    const schlaf = block("schlaf", "sleep", "2026-10-14", "22:30", "06:30", true);
    const state = focus(at("2026-10-15", "06:45"), [schlaf, morgen]);
    expect(state.kind).toBe("free");
    expect(state.previous?.id).toBe("schlaf");
    expect(state.next?.id).toBe("morgen");
  });

  it("bei Überschneidung steht der zuletzt begonnene Block im Fokus, der andere wird genannt", () => {
    const abend = block("abend", "relationship", "2026-10-16", "19:00", "23:00");
    const essenFr = block("essen-fr", "meal", "2026-10-16", "19:30", "20:15");
    const state = focus(at("2026-10-16", "19:40"), [abend, essenFr]);
    expect(state.kind).toBe("block");
    expect(state.current?.id).toBe("essen-fr");
    expect(state.overlapping.map((e) => e.id)).toEqual(["abend"]);
    expect(state.previous).toBeUndefined();
    // Nach dem Ende des Abendessens rückt der überlappende Block in den Fokus.
    expect(state.nextChangeAt.toISOString()).toBe(essenFr.end_at);
    const after = focus(state.nextChangeAt, [abend, essenFr]);
    expect(after.current?.id).toBe("abend");
    expect(after.overlapping).toEqual([]);
  });
});

describe("getFocusState – Zeitgrenzen", () => {
  it("Blöcke sind halboffen: zur Startzeit beginnt der Block, zur Endzeit ist er vorbei", () => {
    expect(focus(new Date(kunde.start_at)).current?.id).toBe("kunde");
    const atEnd = focus(new Date(dienst.end_at));
    expect(atEnd.current).toBeUndefined();
    expect(atEnd.previous?.id).toBe("dienst");
    // 20:00: Kundenprojekt endet genau, Abendessen beginnt genau – kein Zwischenzustand.
    expect(focus(new Date(kunde.end_at)).current?.id).toBe("essen");
  });

  it("nennt den Zeitpunkt der nächsten Änderung und wechselt dort automatisch", () => {
    const free = focus(at(DAY, "16:40"));
    expect(free.nextChangeAt.toISOString()).toBe(kunde.start_at);
    expect(msUntilFocusChange(free, at(DAY, "16:40"))).toBe(20 * 60_000);

    const running = focus(free.nextChangeAt);
    expect(running.kind).toBe("block");
    expect(running.current?.id).toBe("kunde");
    expect(getFocusKey(running)).not.toBe(getFocusKey(free));

    const block = focus(at(DAY, "18:05"));
    expect(block.nextChangeAt.toISOString()).toBe(kunde.end_at);
    const after = focus(block.nextChangeAt);
    expect(after.current?.id).toBe("essen");
  });

  it("der Schlüssel bleibt innerhalb desselben Zustands stabil", () => {
    expect(getFocusKey(focus(at(DAY, "17:10")))).toBe(getFocusKey(focus(at(DAY, "19:50"))));
  });

  it("nach dem letzten Block ist Mitternacht die nächste Änderung", () => {
    const state = focus(at(DAY, "22:40"));
    expect(state.nextChangeAt.toISOString()).toBe(at("2026-10-15", "00:00").toISOString());
    expect(focus(state.nextChangeAt).kind).toBe("before_first");
  });

  it("deckelt lange Wartezeiten (Neuberechnung spätestens nach einer Stunde)", () => {
    const state = focus(at(DAY, "08:00"));
    expect(state.nextChangeAt.toISOString()).toBe(dienst.end_at);
    expect(msUntilFocusChange(state, at(DAY, "08:00"))).toBe(60 * 60_000);
  });

  it("Wochenwechsel (So → Mo): Danach liegt in der Folgewoche, Mitternacht wechselt den Tag", () => {
    const sonntag = block("so-abend", "leisure", "2026-10-18", "18:00", "20:00");
    const schlaf = block("so-schlaf", "sleep", "2026-10-18", "22:30", "06:30", true);
    const montag = block("mo-dienst", "duty", "2026-10-19", "07:00", "16:30");
    const entries = [sonntag, schlaf, montag];

    const sundayEvening = focus(at("2026-10-18", "21:00"), entries);
    expect(sundayEvening.kind).toBe("free");
    expect(sundayEvening.today).toBe("2026-10-18");
    expect(sundayEvening.next?.id).toBe("so-schlaf");

    // Schlaf läuft über Mitternacht in die neue Woche; der Kalendertag wechselt um 00:00.
    const midnight = focus(at("2026-10-19", "00:00"), entries);
    expect(midnight.today).toBe("2026-10-19");
    expect(midnight.kind).toBe("block");
    expect(midnight.current?.id).toBe("so-schlaf");
    expect(midnight.nextChangeAt.toISOString()).toBe(schlaf.end_at);

    // Montag nach dem Schlaf: Davor ist der Block über Mitternacht, Danach der Dienst.
    const monday = focus(at("2026-10-19", "06:40"), entries);
    expect(monday.kind).toBe("free");
    expect(monday.previous?.id).toBe("so-schlaf");
    expect(monday.next?.id).toBe("mo-dienst");
    expect(formatStartLabel(montag.start_at, at("2026-10-18", "21:00"))).toBe("morgen 07:00");
  });

  it("Hinweisgrenzen einer laufenden Aktivität (12 h, 24 h) lösen eine Neuberechnung aus", () => {
    const session = {
      id: "lang",
      schedule_entry_id: null,
      started_at: at(DAY, "00:30").toISOString(),
      ended_at: null,
    };
    const state = getFocusState({
      entries: [],
      running: session,
      now: at(DAY, "12:00"),
      hasPublishedPlan: true,
    });
    expect(state.nextChangeAt.toISOString()).toBe(at(DAY, "12:30").toISOString());
  });
});

describe("getFocusState – Europe/Berlin und Zeitumstellung", () => {
  it("Winterzeit (25.10.2026, 25-Stunden-Tag): Mitternacht und Restzeit stimmen", () => {
    const nacht = block("nacht", "sleep", "2026-10-25", "01:30", "03:30");
    const state = getFocusState({
      entries: [nacht],
      now: at("2026-10-25", "01:45"),
      hasPublishedPlan: true,
    });
    expect(state.current?.id).toBe("nacht");
    // 01:30–03:30 Ortszeit dauert an diesem Tag drei Stunden (02:00–03:00 doppelt).
    expect(getRemainingMinutes(nacht, at("2026-10-25", "01:45"))).toBe(165);
    const after = getFocusState({
      entries: [nacht],
      now: new Date(nacht.end_at),
      hasPublishedPlan: true,
    });
    expect(after.kind).toBe("after_last");
    expect(after.nextChangeAt.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("Sommerzeit (29.03.2026, 23-Stunden-Tag): Tagesgrenze um 22:00 UTC", () => {
    const abend = block("abend", "leisure", "2026-03-29", "20:00", "21:00");
    const state = getFocusState({
      entries: [abend],
      now: at("2026-03-29", "21:30"),
      hasPublishedPlan: true,
    });
    expect(state.kind).toBe("after_last");
    expect(state.nextChangeAt.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(state.today).toBe("2026-03-29");
  });

  it("der Kalendertag richtet sich nach Berlin, nicht nach UTC", () => {
    // 23:30 UTC am 14.10. ist in Berlin schon der 15.10.
    const state = getFocusState({
      entries: [morgen],
      now: new Date("2026-10-14T23:30:00Z"),
      hasPublishedPlan: true,
    });
    expect(state.today).toBe("2026-10-15");
    expect(state.kind).toBe("before_first");
  });
});

describe("Zeittexte der Fokusfläche", () => {
  it("formatiert relative Starts", () => {
    const now = at(DAY, "16:40");
    expect(formatStartsIn(kunde.start_at, now)).toBe("in 20 Min.");
    expect(formatStartsIn(essen.start_at, at(DAY, "18:05"))).toBe("in 1 Std. 55 Min.");
    expect(formatStartsIn(kunde.start_at, at(DAY, "17:00"))).toBe("jetzt");
  });

  it("nennt Tag und Uhrzeit, wenn der Block nicht heute beginnt", () => {
    expect(formatStartLabel(essen.start_at, at(DAY, "18:05"))).toBe("20:00");
    expect(formatStartLabel(morgen.start_at, at(DAY, "22:40"))).toBe("morgen 07:00");
    expect(formatStartLabel(morgen.start_at, at("2026-10-13", "22:40"))).toBe("Do 15.10. 07:00");
  });
});

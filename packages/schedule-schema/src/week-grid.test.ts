import { describe, expect, it } from "vitest";

import { resolveTimeRange } from "./schedule";
import {
  WEEK_GRID_DEFAULT_HOURS,
  getDaySegments,
  getVisibleHourRange,
  getWeekGridLayout,
  localMinutesOfDay,
  placeDaySegments,
} from "./week-grid";

interface TestBlock {
  id: string;
  start_at: string;
  end_at: string;
}

/** Block in Berliner Ortszeit (frei erfundene Beispiele). */
function block(id: string, date: string, start: string, end: string, nextDay = false): TestBlock {
  const range = resolveTimeRange(date, start, end, nextDay);
  return { id, start_at: range.start.toISOString(), end_at: range.end.toISOString() };
}

const ids = (segments: readonly { entry: TestBlock }[]) => segments.map((s) => s.entry.id);

describe("getDaySegments", () => {
  it("liefert Minuten der Wanduhr innerhalb des Tages", () => {
    const [segment] = getDaySegments([block("a", "2026-10-06", "09:15", "10:45")], "2026-10-06");
    expect(segment).toMatchObject({ from: 9 * 60 + 15, to: 10 * 60 + 45, continued: false });
  });

  it("teilt Blöcke über Mitternacht auf beide Tage auf", () => {
    const night = block("nacht", "2026-10-06", "22:00", "02:00", true);
    expect(getDaySegments([night], "2026-10-06")).toMatchObject([
      { from: 22 * 60, to: 24 * 60, continued: false },
    ]);
    expect(getDaySegments([night], "2026-10-07")).toMatchObject([
      { from: 0, to: 2 * 60, continued: true },
    ]);
  });

  it("zeigt einen Block bis genau Mitternacht nicht am Folgetag", () => {
    const late = block("spät", "2026-10-06", "22:00", "00:00", true);
    expect(getDaySegments([late], "2026-10-06")).toMatchObject([{ to: 24 * 60 }]);
    expect(getDaySegments([late], "2026-10-07")).toEqual([]);
  });

  it("Winterzeit (25.10.2026): Position nach Wanduhr, obwohl 3 Stunden vergehen", () => {
    const b = block("umstellung", "2026-10-25", "01:30", "03:30");
    expect(Date.parse(b.end_at) - Date.parse(b.start_at)).toBe(3 * 3_600_000);
    expect(getDaySegments([b], "2026-10-25")).toMatchObject([{ from: 90, to: 210 }]);
  });

  it("Sommerzeit (28.03.2027): Position nach Wanduhr, obwohl nur 1 Stunde vergeht", () => {
    const b = block("umstellung", "2027-03-28", "01:30", "03:30");
    expect(Date.parse(b.end_at) - Date.parse(b.start_at)).toBe(3_600_000);
    expect(getDaySegments([b], "2027-03-28")).toMatchObject([{ from: 90, to: 210 }]);
  });

  it("gibt Segmenten mindestens eine Minute Höhe", () => {
    const b = block("kurz", "2026-10-06", "10:00", "10:00");
    expect(getDaySegments([b], "2026-10-06")).toMatchObject([{ from: 600, to: 601 }]);
  });
});

describe("placeDaySegments", () => {
  it("legt überschneidende Blöcke nebeneinander, getrennte Gruppen bleiben einspurig", () => {
    const segments = getDaySegments(
      [
        block("a", "2026-10-06", "09:00", "11:00"),
        block("b", "2026-10-06", "10:00", "12:00"),
        block("c", "2026-10-06", "11:00", "13:00"),
        block("d", "2026-10-06", "14:00", "15:00"),
      ],
      "2026-10-06",
    );
    const placed = placeDaySegments(segments);
    expect(placed.map(({ entry, lane, lanes }) => [entry.id, lane, lanes])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
    ]);
  });
});

describe("getVisibleHourRange", () => {
  it("zeigt standardmäßig 06–22 Uhr", () => {
    expect(getVisibleHourRange([])).toEqual(WEEK_GRID_DEFAULT_HOURS);
  });

  it("erweitert um frühe und späte Blöcke (angefangene Stunden zählen ganz)", () => {
    const segments = getDaySegments(
      [
        block("früh", "2026-10-06", "05:30", "06:30"),
        block("spät", "2026-10-06", "22:00", "23:15"),
      ],
      "2026-10-06",
    );
    expect(getVisibleHourRange(segments)).toEqual({ first: 5, last: 24 });
  });
});

describe("getWeekGridLayout", () => {
  it("liefert sieben Tage ab Montag und ignoriert Blöcke anderer Wochen", () => {
    const layout = getWeekGridLayout(
      [
        block("mo", "2026-10-05", "08:00", "09:00"),
        block("so", "2026-10-11", "20:00", "21:00"),
        block("nächste", "2026-10-12", "08:00", "09:00"),
      ],
      "2026-10-05",
    );
    expect(layout.days.map((d) => d.date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(ids(layout.days[0]?.segments ?? [])).toEqual(["mo"]);
    expect(ids(layout.days[6]?.segments ?? [])).toEqual(["so"]);
    expect(layout.days.flatMap((d) => ids(d.segments))).not.toContain("nächste");
    expect([layout.firstHour, layout.lastHour]).toEqual([6, 22]);
  });

  it("rechnet die Jetzt-Linie in Wanduhr-Minuten", () => {
    expect(localMinutesOfDay(new Date("2026-10-06T15:00:00Z"))).toBe(17 * 60);
    expect(localMinutesOfDay(new Date("2026-12-01T15:00:00Z"))).toBe(16 * 60);
  });
});

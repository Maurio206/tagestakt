import { describe, expect, it } from "vitest";

import {
  addDays,
  getDayBounds,
  getIsoWeek,
  getTimeZoneOffsetMinutes,
  getWeekBounds,
  getWeekDays,
  getWeekStart,
  isMonday,
  isValidLocalDate,
  isoWeekdayOfLocalDate,
  minutesBetween,
  normalizeTimeOfDay,
  parseLocalDate,
  toLocalDate,
  toLocalTime,
  zonedDateTimeToInstant,
} from "./time";

const iso = (date: Date) => date.toISOString();

describe("zonedDateTimeToInstant (Europe/Berlin)", () => {
  it("rechnet Winterzeit (UTC+1) um", () => {
    expect(iso(zonedDateTimeToInstant("2026-01-15", "08:00"))).toBe("2026-01-15T07:00:00.000Z");
  });

  it("rechnet Sommerzeit (UTC+2) um", () => {
    expect(iso(zonedDateTimeToInstant("2026-07-15", "08:00"))).toBe("2026-07-15T06:00:00.000Z");
  });

  it("verschiebt eine nicht existierende Uhrzeit (Umstellung auf Sommerzeit) nach vorne", () => {
    // 29.03.2026: 02:00 → 03:00. 02:30 gibt es nicht und wird zu 03:30 MESZ.
    expect(iso(zonedDateTimeToInstant("2026-03-29", "02:30"))).toBe("2026-03-29T01:30:00.000Z");
    expect(toLocalTime(zonedDateTimeToInstant("2026-03-29", "02:30"))).toBe("03:30");
  });

  it("bildet Uhrzeiten direkt um die Frühjahrsumstellung korrekt ab", () => {
    expect(iso(zonedDateTimeToInstant("2026-03-29", "01:59"))).toBe("2026-03-29T00:59:00.000Z");
    expect(iso(zonedDateTimeToInstant("2026-03-29", "03:00"))).toBe("2026-03-29T01:00:00.000Z");
  });

  it("wählt bei doppelter Uhrzeit (Umstellung auf Winterzeit) das frühere Vorkommen", () => {
    // 25.10.2026: 03:00 → 02:00. 02:30 existiert zweimal.
    expect(iso(zonedDateTimeToInstant("2026-10-25", "02:30"))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(zonedDateTimeToInstant("2026-10-25", "03:00"))).toBe("2026-10-25T02:00:00.000Z");
  });

  it("ist für alle Viertelstunden eines Jahres umkehrbar (außer in der Frühjahrslücke)", () => {
    for (let day = 0; day < 366; day += 1) {
      const date = addDays("2026-01-01", day);
      for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
        const instant = zonedDateTimeToInstant(date, time);
        if (date === "2026-03-29" && time >= "02:00" && time < "03:00") continue;
        expect(toLocalDate(instant)).toBe(date);
        expect(toLocalTime(instant)).toBe(time);
      }
    }
    // ~35 000 Umrechnungen über Intl: unter Last (parallele Testdateien) dauert das länger als 5 s.
  }, 30_000);
});

describe("Zeitzonenversatz", () => {
  it("liefert +60 im Winter und +120 im Sommer", () => {
    expect(getTimeZoneOffsetMinutes(new Date("2026-01-01T12:00:00Z"))).toBe(60);
    expect(getTimeZoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"))).toBe(120);
  });

  it("wechselt exakt zum Umstellungszeitpunkt", () => {
    expect(getTimeZoneOffsetMinutes(new Date("2026-03-29T00:59:59Z"))).toBe(60);
    expect(getTimeZoneOffsetMinutes(new Date("2026-03-29T01:00:00Z"))).toBe(120);
    expect(getTimeZoneOffsetMinutes(new Date("2026-10-25T00:59:59Z"))).toBe(120);
    expect(getTimeZoneOffsetMinutes(new Date("2026-10-25T01:00:00Z"))).toBe(60);
  });
});

describe("Mitternachtswechsel", () => {
  it("ordnet 00:30 Berliner Zeit dem neuen Tag zu, obwohl UTC noch den Vortag hat", () => {
    expect(toLocalDate(new Date("2026-10-05T22:30:00Z"))).toBe("2026-10-06");
    expect(toLocalDate(new Date("2026-01-04T23:30:00Z"))).toBe("2026-01-05");
  });

  it("ordnet 23:59 Berliner Zeit noch dem alten Tag zu", () => {
    expect(toLocalDate(new Date("2026-10-05T21:59:00Z"))).toBe("2026-10-05");
    expect(toLocalTime(new Date("2026-10-05T21:59:00Z"))).toBe("23:59");
  });

  it("liefert 00:00 statt 24:00", () => {
    expect(toLocalTime(new Date("2026-10-05T22:00:00Z"))).toBe("00:00");
  });
});

describe("Wochenbeginn und Wochenwechsel", () => {
  it("findet den Montag einer Woche", () => {
    expect(getWeekStart("2026-10-05")).toBe("2026-10-05");
    expect(getWeekStart("2026-10-06")).toBe("2026-10-05");
    expect(getWeekStart("2026-10-11")).toBe("2026-10-05");
    expect(getWeekStart("2026-10-12")).toBe("2026-10-12");
  });

  it("wechselt die Woche um Mitternacht Berliner Zeit, nicht UTC", () => {
    // Sonntag 23:59 Berlin
    expect(getWeekStart(new Date("2026-10-11T21:59:00Z"))).toBe("2026-10-05");
    // Montag 00:00 Berlin = Sonntag 22:00 UTC
    expect(getWeekStart(new Date("2026-10-11T22:00:00Z"))).toBe("2026-10-12");
    // Winterzeit: Montag 00:30 Berlin = Sonntag 23:30 UTC
    expect(getWeekStart(new Date("2026-01-04T23:30:00Z"))).toBe("2026-01-05");
  });

  it("funktioniert über den Jahreswechsel", () => {
    expect(getWeekStart("2027-01-01")).toBe("2026-12-28");
    expect(getWeekStart("2027-01-03")).toBe("2026-12-28");
    expect(getWeekStart("2027-01-04")).toBe("2027-01-04");
  });

  it("berechnet Wochengrenzen inklusive Zeitumstellung (167 h / 168 h / 169 h)", () => {
    const hours = (weekStart: string) => {
      const { start, end } = getWeekBounds(weekStart);
      return minutesBetween(start, end) / 60;
    };
    expect(hours("2026-03-23")).toBe(167);
    expect(hours("2026-10-05")).toBe(168);
    expect(hours("2026-10-19")).toBe(169);
  });

  it("beginnt die Woche Montag 00:00 Berliner Zeit", () => {
    expect(iso(getWeekBounds("2026-10-05").start)).toBe("2026-10-04T22:00:00.000Z");
    expect(iso(getWeekBounds("2026-10-26").start)).toBe("2026-10-25T23:00:00.000Z");
  });

  it("liefert sieben Tage Mo–So", () => {
    expect(getWeekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
});

describe("Tagesgrenzen", () => {
  it("kennt 23-, 24- und 25-Stunden-Tage", () => {
    const hours = (date: string) => {
      const { start, end } = getDayBounds(date);
      return minutesBetween(start, end) / 60;
    };
    expect(hours("2026-03-29")).toBe(23);
    expect(hours("2026-06-01")).toBe(24);
    expect(hours("2026-10-25")).toBe(25);
  });
});

describe("Kalenderhilfen", () => {
  it("berechnet ISO-Kalenderwochen", () => {
    expect(getIsoWeek("2026-10-05")).toEqual({ year: 2026, week: 41 });
    expect(getIsoWeek("2026-12-28")).toEqual({ year: 2026, week: 53 });
    expect(getIsoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(getIsoWeek("2027-01-04")).toEqual({ year: 2027, week: 1 });
  });

  it("erkennt Wochentage und Montage", () => {
    expect(isoWeekdayOfLocalDate("2026-10-05")).toBe(1);
    expect(isoWeekdayOfLocalDate("2026-10-11")).toBe(7);
    expect(isMonday("2026-10-05")).toBe(true);
    expect(isMonday("2026-10-06")).toBe(false);
    expect(isMonday("kein-datum")).toBe(false);
  });

  it("validiert Kalenderdaten streng", () => {
    expect(isValidLocalDate("2026-02-28")).toBe(true);
    expect(isValidLocalDate("2026-02-29")).toBe(false);
    expect(isValidLocalDate("2028-02-29")).toBe(true);
    expect(isValidLocalDate("2026-13-01")).toBe(false);
    expect(isValidLocalDate("05.10.2026")).toBe(false);
    expect(() => parseLocalDate("2026-02-30")).toThrow(RangeError);
  });

  it("addiert Tage über Monats- und Jahresgrenzen", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("normalisiert Postgres-Uhrzeiten", () => {
    expect(normalizeTimeOfDay("07:30:00")).toBe("07:30");
    expect(normalizeTimeOfDay("23:05")).toBe("23:05");
    expect(() => normalizeTimeOfDay("24:00")).toThrow(RangeError);
  });

  it("lehnt ungültige Zeitpunkte ab", () => {
    expect(() => toLocalDate(new Date("invalid"))).toThrow(RangeError);
  });
});

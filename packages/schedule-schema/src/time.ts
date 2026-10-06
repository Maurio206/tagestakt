/**
 * Zeitzonen-Hilfsfunktionen auf Basis von `Intl.DateTimeFormat`.
 *
 * Begriffe:
 * - Instant: absoluter Zeitpunkt (`Date`, in der DB `timestamptz`).
 * - LocalDate: Kalenderdatum in der Planungszeitzone, Format `YYYY-MM-DD`.
 * - TimeOfDay: Uhrzeit in der Planungszeitzone, Format `HH:MM`.
 *
 * Mehrdeutige Uhrzeiten (Zeitumstellung im Herbst) werden auf das frühere
 * Vorkommen abgebildet, nicht existierende Uhrzeiten (Frühjahr) nach vorne
 * verschoben – entspricht der Strategie `compatible` aus TC39 Temporal.
 */
import { type IsoWeekday, SCHEDULE_TIMEZONE } from "./constants";

export type LocalDate = string;
export type TimeOfDay = string;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function assertValidInstant(instant: Date): void {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Ungültiger Zeitpunkt");
  }
}

/** Zerlegt einen Zeitpunkt in Kalender- und Uhrzeitbestandteile der Zeitzone. */
export function getZonedParts(instant: Date, timeZone: string = SCHEDULE_TIMEZONE): ZonedParts {
  assertValidInstant(instant);
  const parts: Record<string, number> = {};
  for (const part of getFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts.year ?? NaN,
    month: parts.month ?? NaN,
    day: parts.day ?? NaN,
    // Manche Engines liefern trotz h23 „24“ für Mitternacht.
    hour: (parts.hour ?? NaN) % 24,
    minute: parts.minute ?? NaN,
    second: parts.second ?? NaN,
  };
}

/** UTC-Versatz der Zeitzone zu diesem Zeitpunkt in Millisekunden (Berlin: +1 h / +2 h). */
function getOffsetMs(instantMs: number, timeZone: string): number {
  const p = getZonedParts(new Date(instantMs), timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const flooredInstant = instantMs - (((instantMs % 1000) + 1000) % 1000);
  return wallClockAsUtc - flooredInstant;
}

export function getTimeZoneOffsetMinutes(
  instant: Date,
  timeZone: string = SCHEDULE_TIMEZONE,
): number {
  assertValidInstant(instant);
  return Math.round(getOffsetMs(instant.getTime(), timeZone) / MINUTE_MS);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function parseLocalDate(value: LocalDate): { year: number; month: number; day: number } {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`Ungültiges Datum: ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Ungültiges Datum: ${value}`);
  }
  return { year, month, day };
}

export function isValidLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

export function parseTimeOfDay(value: TimeOfDay): { hour: number; minute: number } {
  const match = TIME_OF_DAY_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`Ungültige Uhrzeit: ${value}`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function isValidTimeOfDay(value: unknown): value is TimeOfDay {
  return typeof value === "string" && TIME_OF_DAY_PATTERN.test(value);
}

/** Normalisiert `HH:MM:SS` (Postgres `time`) zu `HH:MM`. */
export function normalizeTimeOfDay(value: string): TimeOfDay {
  const { hour, minute } = parseTimeOfDay(value);
  return `${pad(hour)}:${pad(minute)}`;
}

function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Kalenderdatum eines Zeitpunkts in der Planungszeitzone. */
export function toLocalDate(instant: Date, timeZone: string = SCHEDULE_TIMEZONE): LocalDate {
  const p = getZonedParts(instant, timeZone);
  return formatLocalDate(p.year, p.month, p.day);
}

/** Uhrzeit (`HH:MM`) eines Zeitpunkts in der Planungszeitzone. */
export function toLocalTime(instant: Date, timeZone: string = SCHEDULE_TIMEZONE): TimeOfDay {
  const p = getZonedParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Wandelt Datum + Uhrzeit in der Planungszeitzone in einen absoluten Zeitpunkt um.
 * Behandelt Sommer-/Winterzeit-Umstellungen wie oben beschrieben.
 */
export function zonedDateTimeToInstant(
  date: LocalDate,
  time: TimeOfDay,
  timeZone: string = SCHEDULE_TIMEZONE,
): Date {
  const { year, month, day } = parseLocalDate(date);
  const { hour, minute } = parseTimeOfDay(time);
  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute);

  // Versätze kurz vor und nach dem gesuchten Zeitpunkt. Zwischen zwei
  // Zeitumstellungen liegen in der Praxis immer deutlich mehr als 48 Stunden.
  const offsetBefore = getOffsetMs(wallClockMs - DAY_MS, timeZone);
  const offsetAfter = getOffsetMs(wallClockMs + DAY_MS, timeZone);

  const candidates = [wallClockMs - offsetBefore, wallClockMs - offsetAfter]
    .filter((candidate) => candidate + getOffsetMs(candidate, timeZone) === wallClockMs)
    .sort((a, b) => a - b);

  const first = candidates[0];
  if (first !== undefined) {
    return new Date(first);
  }
  // Uhrzeit existiert nicht (Lücke bei Umstellung auf Sommerzeit): nach vorne verschieben.
  return new Date(wallClockMs - offsetBefore);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** ISO-Wochentag eines Kalenderdatums: 1 = Montag … 7 = Sonntag. */
export function isoWeekdayOfLocalDate(date: LocalDate): IsoWeekday {
  const { year, month, day } = parseLocalDate(date);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as IsoWeekday;
}

/** Montag der Woche, in der das Datum bzw. der Zeitpunkt (in der Planungszeitzone) liegt. */
export function getWeekStart(
  input: Date | LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): LocalDate {
  const localDate = typeof input === "string" ? input : toLocalDate(input, timeZone);
  return addDays(localDate, 1 - isoWeekdayOfLocalDate(localDate));
}

export function isMonday(date: LocalDate): boolean {
  return isValidLocalDate(date) && isoWeekdayOfLocalDate(date) === 1;
}

/** Die sieben Kalendertage (Mo–So) einer Woche. */
export function getWeekDays(weekStart: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/**
 * Halboffenes Intervall [Montag 00:00, nächster Montag 00:00) in der Planungszeitzone.
 * Durch Zeitumstellung kann eine Woche 167 oder 169 Stunden lang sein.
 */
export function getWeekBounds(
  weekStart: LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): { start: Date; end: Date } {
  return {
    start: zonedDateTimeToInstant(weekStart, "00:00", timeZone),
    end: zonedDateTimeToInstant(addDays(weekStart, 7), "00:00", timeZone),
  };
}

/** Halboffenes Intervall eines Kalendertags; kann 23, 24 oder 25 Stunden lang sein. */
export function getDayBounds(
  date: LocalDate,
  timeZone: string = SCHEDULE_TIMEZONE,
): { start: Date; end: Date } {
  return {
    start: zonedDateTimeToInstant(date, "00:00", timeZone),
    end: zonedDateTimeToInstant(addDays(date, 1), "00:00", timeZone),
  };
}

/** ISO-8601-Kalenderwoche (KW) eines Datums. */
export function getIsoWeek(date: LocalDate): { year: number; week: number } {
  const { year, month, day } = parseLocalDate(date);
  const thursday = new Date(Date.UTC(year, month - 1, day));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - isoWeekdayOfLocalDate(date));
  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / 7);
  return { year: isoYear, week };
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
}

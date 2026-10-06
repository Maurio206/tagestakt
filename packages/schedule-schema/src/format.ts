/**
 * Deutsche Anzeigeformate. Bewusst ohne `Intl`-Locale-Daten, damit Web (Node)
 * und Mobile (Hermes) garantiert identische Texte anzeigen.
 */
import { SCHEDULE_TIMEZONE, WEEKDAY_LABELS, WEEKDAY_SHORT_LABELS } from "./constants";
import {
  type LocalDate,
  addDays,
  getIsoWeek,
  isoWeekdayOfLocalDate,
  parseLocalDate,
  toLocalTime,
} from "./time";

const MONTH_LABELS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

/** „14:05“ */
export function formatTime(instant: Date | string, timeZone: string = SCHEDULE_TIMEZONE): string {
  return toLocalTime(typeof instant === "string" ? new Date(instant) : instant, timeZone);
}

/** „14:05–15:30“ */
export function formatTimeRange(
  start: Date | string,
  end: Date | string,
  timeZone: string = SCHEDULE_TIMEZONE,
): string {
  return `${formatTime(start, timeZone)}–${formatTime(end, timeZone)}`;
}

/** „Montag, 5. Oktober 2026“ */
export function formatLocalDateLong(date: LocalDate, withYear = false): string {
  const { year, month, day } = parseLocalDate(date);
  const weekday = WEEKDAY_LABELS[isoWeekdayOfLocalDate(date)];
  const base = `${weekday}, ${day}. ${MONTH_LABELS[month - 1] ?? ""}`;
  return withYear ? `${base} ${year}` : base;
}

/** „Mo 05.10.“ */
export function formatLocalDateShort(date: LocalDate): string {
  const { month, day } = parseLocalDate(date);
  const weekday = WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(date)];
  return `${weekday} ${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.`;
}

/** „KW 41 · 05.10.–11.10.2026“ */
export function formatWeekLabel(weekStart: LocalDate): string {
  const { week } = getIsoWeek(weekStart);
  const start = parseLocalDate(weekStart);
  const end = parseLocalDate(addDays(weekStart, 6));
  const two = (n: number) => String(n).padStart(2, "0");
  return `KW ${week} · ${two(start.day)}.${two(start.month)}.–${two(end.day)}.${two(end.month)}.${end.year}`;
}

/** „1 Std. 20 Min.“, „45 Min.“, „3 Std.“ */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} Min.`;
  if (rest === 0) return `${hours} Std.`;
  return `${hours} Std. ${rest} Min.`;
}

/** „20,5 h“ – für Wochenziele. */
export function formatHours(totalMinutes: number): string {
  const hours = Math.round((totalMinutes / 60) * 10) / 10;
  return `${String(hours).replace(".", ",")} h`;
}

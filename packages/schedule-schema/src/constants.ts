/** Zentrale fachliche Konstanten. Datenbank-Constraints spiegeln diese Werte. */

/** TagesTakt plant konsequent in dieser Zeitzone (MVP: nur diese eine). */
export const SCHEDULE_TIMEZONE = "Europe/Berlin";
export const DEFAULT_LOCALE = "de-DE";

/** 20 Stunden Gewerbe pro Woche. */
export const DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES = 1200;
/** Obergrenze für das Wochenziel: 7 × 24 h. */
export const MAX_WEEKLY_BUSINESS_TARGET_MINUTES = 7 * 24 * 60;

/** Ein einzelner Block darf höchstens 24 Stunden lang sein. */
export const MAX_ENTRY_DURATION_MINUTES = 24 * 60;

export const TITLE_MAX_LENGTH = 120;
export const LOCATION_MAX_LENGTH = 120;
export const NOTE_MAX_LENGTH = 1000;
export const PLANNING_NOTE_MAX_LENGTH = 2000;

export const ENTRY_CATEGORIES = [
  "duty",
  "business",
  "relationship",
  "sport",
  "shopping",
  "meal",
  "hygiene",
  "commute",
  "leisure",
  "sleep",
  "appointment",
  "other",
] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<EntryCategory, string>> = {
  duty: "Dienst",
  business: "Gewerbe",
  relationship: "Laila",
  sport: "Sport",
  shopping: "Einkaufen",
  meal: "Essen",
  hygiene: "Körperpflege & Routine",
  commute: "Fahrt",
  leisure: "Freizeit",
  sleep: "Schlaf",
  appointment: "Termin",
  other: "Sonstiges",
};

/**
 * Zurückhaltende Kategorienfarben. Jede Farbe erreicht auf dunklem (#11151b)
 * und hellem (#ffffff) Hintergrund mindestens 3:1 Kontrast (Grafikelement, WCAG 1.4.11).
 * Kategorien werden zusätzlich immer als Text angezeigt – Farbe ist nie alleiniger Träger.
 */
export const CATEGORY_COLORS: Readonly<Record<EntryCategory, string>> = {
  duty: "#5b8def",
  business: "#d4a017",
  relationship: "#d9668f",
  sport: "#3fa66b",
  shopping: "#b07ad6",
  meal: "#d9822b",
  hygiene: "#3aa6b9",
  commute: "#8a94a6",
  leisure: "#6fae3c",
  sleep: "#7b83c9",
  appointment: "#e0604f",
  other: "#9a8f7e",
};

export const WEEK_STATUSES = ["draft", "published", "archived"] as const;
export type WeekStatus = (typeof WEEK_STATUSES)[number];

export const WEEK_STATUS_LABELS: Readonly<Record<WeekStatus, string>> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

export const ENTRY_SOURCES = ["manual", "recurring", "agent"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const ENTRY_SOURCE_LABELS: Readonly<Record<EntrySource, string>> = {
  manual: "Manuell",
  recurring: "Wiederholung",
  agent: "Agent",
};

export const COMPLETION_STATUSES = ["planned", "completed", "skipped"] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

export const COMPLETION_STATUS_LABELS: Readonly<Record<CompletionStatus, string>> = {
  planned: "Geplant",
  completed: "Erledigt",
  skipped: "Ausgelassen",
};

/** ISO-Wochentage: 1 = Montag … 7 = Sonntag (wie `extract(isodow …)` in Postgres). */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

export const WEEKDAY_LABELS: Readonly<Record<IsoWeekday, string>> = {
  1: "Montag",
  2: "Dienstag",
  3: "Mittwoch",
  4: "Donnerstag",
  5: "Freitag",
  6: "Samstag",
  7: "Sonntag",
};

export const WEEKDAY_SHORT_LABELS: Readonly<Record<IsoWeekday, string>> = {
  1: "Mo",
  2: "Di",
  3: "Mi",
  4: "Do",
  5: "Fr",
  6: "Sa",
  7: "So",
};

// ---------------------------------------------------------------------------
// Wochenziele und Zeiterfassung
// ---------------------------------------------------------------------------

/** Ziele mit Plan-vs-Ist-Erfassung. Schlüssel entsprechen den Kategorien. */
export const GOAL_KEYS = ["business", "sport", "relationship"] as const;
export type GoalKey = (typeof GOAL_KEYS)[number];

export const GOAL_LABELS: Readonly<Record<GoalKey, string>> = {
  business: "Gewerbe",
  sport: "Sport",
  relationship: "Laila",
};

/** Obergrenze für jedes Wochenziel: 7 × 24 h (wie in der Datenbank). */
export const MAX_WEEKLY_GOAL_MINUTES = MAX_WEEKLY_BUSINESS_TARGET_MINUTES;

export const GOAL_STATUSES = ["unset", "on_track", "at_risk", "reached", "over", "below"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Statuswörter – sachlich, ohne Wertung. „Unter Ziel“ nur für abgeschlossene Wochen. */
export const GOAL_STATUS_LABELS: Readonly<Record<GoalStatus, string>> = {
  unset: "Ziel noch festlegen",
  on_track: "Im Plan",
  at_risk: "Gefährdet",
  reached: "Erreicht",
  over: "Über Ziel",
  below: "Unter Ziel",
};

/** Eine Aktivität darf höchstens 24 Stunden dauern (wie in der Datenbank). */
export const MAX_ACTIVITY_DURATION_MINUTES = 24 * 60;
/** Ab dieser Laufzeit weist die Oberfläche auf eine vermutlich vergessene Aktivität hin. */
export const FORGOTTEN_ACTIVITY_MINUTES = 12 * 60;

// ---------------------------------------------------------------------------
// Lokale Erinnerungen
// ---------------------------------------------------------------------------

export const REMINDER_SCOPES = ["goals", "important", "all"] as const;
export type ReminderScope = (typeof REMINDER_SCOPES)[number];

export const REMINDER_SCOPE_LABELS: Readonly<Record<ReminderScope, string>> = {
  goals: "Nur Ziele (Gewerbe, Sport, Laila)",
  important: "Ziele, Dienst und Termine",
  all: "Alle Planblöcke",
};

export const DEFAULT_REMINDER_MINUTES_BEFORE = 10;
export const MAX_REMINDER_MINUTES_BEFORE = 240;
/** Auswahl in den Einstellungen; die Datenbank erlaubt 1–240 Minuten. */
export const REMINDER_LEAD_OPTIONS = [5, 10, 15, 30, 60] as const;
/** „Noch nicht gestartet“ erinnert so viele Minuten nach dem geplanten Beginn. */
export const NOT_STARTED_GRACE_MINUTES = 10;

/**
 * Fehlercodes (SQLSTATE) der Aktivitäts-RPCs → Texte für die Oberfläche.
 * Siehe supabase/migrations/20261007120000_focus_tracking_and_goals.sql.
 */
export const ACTIVITY_ERROR_MESSAGES = {
  TT001: "Es läuft bereits eine Aktivität. Bitte zuerst beenden.",
  TT002: "Es läuft keine Aktivität mehr. Die Ansicht wurde aktualisiert.",
  TT003:
    "Die Aktivität läuft seit über 24 Stunden. Bitte das Ende über „Zeit korrigieren“ eintragen.",
  TT004: "Die Zeit überschneidet sich mit einer anderen erfassten Aktivität.",
  TT005: "Der Planblock passt nicht (nicht veröffentlicht oder anderes Ziel).",
  TT006: "Die Zeitangabe ist ungültig (Zukunft, Reihenfolge oder über 24 Stunden).",
} as const;
export type ActivityErrorCode = keyof typeof ACTIVITY_ERROR_MESSAGES;

export function isActivityErrorCode(code: unknown): code is ActivityErrorCode {
  return typeof code === "string" && Object.hasOwn(ACTIVITY_ERROR_MESSAGES, code);
}

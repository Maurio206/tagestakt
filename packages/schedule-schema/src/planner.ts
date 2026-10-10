/**
 * Wochenplanung – deterministischer Teil (ohne Netzwerk, ohne Sprachmodell).
 *
 * Ablauf: Aus den eigenen Einstellungen, Planungsregeln, aktiven Wiederholungen und den manuellen
 * Einzelterminen der Woche entsteht ein Planungskontext. Fehlen Angaben oder ist die Woche mit den
 * Regeln nicht planbar, wird nicht geplant. Ein Planungsassistent (der Claude-Connector) erhält nur
 * bereinigte Zeiten (keine Titel, Notizen, Orte, Namen oder IDs) und schlägt flexible Blöcke vor
 * (Gewerbe, Training, Beziehungszeit, zusätzliche Termine). Jeder Vorschlag wird hier vollständig
 * und unabhängig geprüft; feste Verpflichtungen übernimmt der Server selbst unverändert.
 * `evaluatePlanDraft` bewertet einen gespeicherten Entwurf (auch nach manuellen Änderungen) und
 * entscheidet, ob er veröffentlicht werden darf.
 *
 * Zeiten: Planungszeitzone Europe/Berlin inklusive Sommer-/Winterzeit; Prüfungen auf echten
 * Zeitpunkten (Millisekunden), Beschriftungen in Ortszeit.
 */
import { z } from "zod";

import {
  CATEGORY_LABELS,
  type EntryCategory,
  GOAL_LABELS,
  type GoalKey,
  type IsoWeekday,
  SCHEDULE_TIMEZONE,
  TITLE_MAX_LENGTH,
  WEEKDAY_LABELS,
} from "./constants";
import { formatDuration, formatLocalDateShort } from "./format";
import { getPlannedMinutes } from "./goals";
import { type RecurringTemplate, detectOverlaps, expandRecurringCommitments } from "./schedule";
import {
  idSchema,
  isoWeekdaySchema,
  localDateSchema,
  timeOfDaySchema,
  timestampSchema,
  weekStartSchema,
} from "./schemas";
import {
  type LocalDate,
  type TimeOfDay,
  addDays,
  getDayBounds,
  getWeekBounds,
  getWeekDays,
  getWeekStart,
  isValidTimeOfDay,
  isoWeekdayOfLocalDate,
  parseTimeOfDay,
  toLocalDate,
  toLocalTime,
  zonedDateTimeToInstant,
} from "./time";

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

/** Ziele mit festen Zeitfenstern je Wochentag (Gewerbe plant der Planer frei im Rahmen). */
export const PLANNER_SLOT_GOALS = ["sport", "relationship"] as const;
export type PlannerSlotGoal = (typeof PLANNER_SLOT_GOALS)[number];

export const SLOT_REQUIREMENTS = ["required", "optional"] as const;
export type SlotRequirement = (typeof SLOT_REQUIREMENTS)[number];

export const SLOT_REQUIREMENT_LABELS: Readonly<Record<SlotRequirement, string>> = {
  required: "verbindlich",
  optional: "optional (nur bei Platz)",
};

/**
 * Was ein Vorschlag enthalten darf. Feste Verpflichtungen (Wiederholungen, Einzeltermine) setzt
 * ausschließlich der Server. `appointment`: zusätzlicher Termin, den der Benutzer für diese
 * Woche genannt hat.
 */
export const PLANNER_BLOCK_KINDS = ["business", "sport", "relationship", "appointment"] as const;
export type PlannerBlockKind = (typeof PLANNER_BLOCK_KINDS)[number];

export const PLANNER_MAX_BLOCKS = 60;
export const PLANNER_TITLE_MAX_LENGTH = 60;
export const PLANNER_REASON_MAX_LENGTH = 240;
export const PLANNER_TEXT_MAX_LENGTH = 300;
export const PLANNER_SUMMARY_MAX_LENGTH = 800;
export const PLANNER_MAX_LIST_ITEMS = 10;
/** Kürzester geplanter Block (Minuten). */
export const PLANNER_MIN_BLOCK_MINUTES = 15;
/** Lesbar: die aktuelle Woche und so viele folgende; speicherbar nur die folgenden. */
export const PLANNER_HORIZON_WEEKS = 4;
/** Neue Blöcke in der laufenden Woche beginnen frühestens zum nächsten Viertelstundenschritt. */
const NOT_BEFORE_STEP_MINUTES = 15;

/**
 * Neutrale Bezeichnungen für den Planungsassistenten. Bewusst ohne Namen: die Kategorie
 * `relationship` heißt in der Oberfläche „Laila“, gegenüber Claude „Beziehungszeit“.
 */
export const PLANNER_NEUTRAL_KIND_LABELS: Readonly<Record<EntryCategory, string>> = {
  duty: "Dienst",
  business: "Gewerbe",
  relationship: "Beziehungszeit",
  sport: "Training",
  shopping: "Einkaufen",
  meal: "Essen",
  hygiene: "Körperpflege",
  commute: "Fahrt",
  leisure: "Freizeit",
  sleep: "Schlaf",
  appointment: "Termin",
  other: "Sonstiges",
};

/**
 * Ersetzt private Bezeichnungen der Beziehungszeit (Anzeige in Web und App) durch die neutrale
 * Art. Alles, was den Connector verlässt, läuft hier durch – Prüf- und Fehlermeldungen
 * enthalten sonst z. B. „Zeit mit …“.
 */
export function neutralizePlannerText(text: string): string {
  const neutral = PLANNER_NEUTRAL_KIND_LABELS.relationship;
  const replacements: [string, string][] = [
    [`Zeit mit ${GOAL_LABELS.relationship}`, neutral],
    [`${GOAL_LABELS.relationship}-Tage`, "Beziehungstage"],
    [GOAL_LABELS.relationship, neutral],
    [CATEGORY_LABELS.relationship, neutral],
  ];
  return replacements.reduce((value, [from, to]) => value.split(from).join(to), text);
}

/** Titel geplanter Gewerbeblöcke bzw. Termine, wenn der Vorschlag keinen brauchbaren enthält. */
export const DEFAULT_BUSINESS_BLOCK_TITLE = "Gewerbe-Fokus";
export const DEFAULT_APPOINTMENT_TITLE = "Termin";

// ---------------------------------------------------------------------------
// Datenbankzeilen und Eingaben
// ---------------------------------------------------------------------------

export const planningPreferencesRowSchema = z.object({
  owner_id: idSchema,
  business_earliest_start: timeOfDaySchema,
  business_latest_end: timeOfDaySchema,
  business_min_block_minutes: z.number().int(),
  business_max_block_minutes: z.number().int(),
  business_max_daily_minutes: z.number().int(),
  business_saturday_max_minutes: z.number().int(),
  business_sunday_max_minutes: z.number().int(),
  buffer_minutes: z.number().int(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type PlanningPreferencesRow = z.infer<typeof planningPreferencesRowSchema>;

export const planningGoalSlotRowSchema = z.object({
  id: idSchema,
  owner_id: idSchema,
  goal_category: z.enum(PLANNER_SLOT_GOALS),
  weekday: isoWeekdaySchema,
  requirement: z.enum(SLOT_REQUIREMENTS),
  title: z.string(),
  duration_minutes: z.number().int(),
  window_start: timeOfDaySchema,
  window_end: timeOfDaySchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type PlanningGoalSlotRow = z.infer<typeof planningGoalSlotRowSchema>;

export interface PlanningPreferences {
  businessEarliestStart: TimeOfDay;
  businessLatestEnd: TimeOfDay;
  businessMinBlockMinutes: number;
  businessMaxBlockMinutes: number;
  /** Höchstens je Werktag (Montag–Freitag). */
  businessMaxDailyMinutes: number;
  businessSaturdayMaxMinutes: number;
  businessSundayMaxMinutes: number;
  bufferMinutes: number;
}

export interface PlanningGoalSlot {
  goal: PlannerSlotGoal;
  weekday: IsoWeekday;
  requirement: SlotRequirement;
  /** Sichtbarer Titel im Plan – wird nie an das Modell übertragen. */
  title: string;
  durationMinutes: number;
  windowStart: TimeOfDay;
  windowEnd: TimeOfDay;
}

export function preferencesFromRow(row: PlanningPreferencesRow): PlanningPreferences {
  return {
    businessEarliestStart: row.business_earliest_start,
    businessLatestEnd: row.business_latest_end,
    businessMinBlockMinutes: row.business_min_block_minutes,
    businessMaxBlockMinutes: row.business_max_block_minutes,
    businessMaxDailyMinutes: row.business_max_daily_minutes,
    businessSaturdayMaxMinutes: row.business_saturday_max_minutes,
    businessSundayMaxMinutes: row.business_sunday_max_minutes,
    bufferMinutes: row.buffer_minutes,
  };
}

export function slotFromRow(row: PlanningGoalSlotRow): PlanningGoalSlot {
  return {
    goal: row.goal_category,
    weekday: row.weekday,
    requirement: row.requirement,
    title: row.title,
    durationMinutes: row.duration_minutes,
    windowStart: row.window_start,
    windowEnd: row.window_end,
  };
}

function minutesOfDay(time: TimeOfDay): number {
  const { hour, minute } = parseTimeOfDay(time);
  return hour * 60 + minute;
}

function minutesField(label: string, min: number, max: number) {
  return z.coerce
    .number({ error: `${label}: bitte eine Zahl angeben` })
    .int({ error: `${label}: bitte ganze Minuten angeben` })
    .min(min, { error: `${label}: mindestens ${min} Minuten` })
    .max(max, { error: `${label}: höchstens ${max} Minuten` });
}

export const planningPreferencesInputSchema = z
  .object({
    businessEarliestStart: timeOfDaySchema,
    businessLatestEnd: timeOfDaySchema,
    businessMinBlockMinutes: minutesField("Mindestdauer eines Gewerbeblocks", 15, 480),
    businessMaxBlockMinutes: minutesField("Höchstdauer eines Gewerbeblocks", 15, 720),
    businessMaxDailyMinutes: minutesField("Gewerbe je Werktag", 15, 960),
    businessSaturdayMaxMinutes: minutesField("Gewerbe am Samstag", 0, 960),
    businessSundayMaxMinutes: minutesField("Gewerbe am Sonntag", 0, 960),
    bufferMinutes: minutesField("Pause zwischen Blöcken", 0, 120),
  })
  .superRefine((v, ctx) => {
    // Ungültige Uhrzeiten meldet bereits das Feldschema; der Zeitrahmen wird dann nicht geprüft.
    if (isValidTimeOfDay(v.businessEarliestStart) && isValidTimeOfDay(v.businessLatestEnd)) {
      const window = minutesOfDay(v.businessLatestEnd) - minutesOfDay(v.businessEarliestStart);
      if (window <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["businessLatestEnd"],
          message: "Das späteste Ende muss nach dem frühesten Beginn liegen (am selben Tag).",
        });
      } else if (window < v.businessMinBlockMinutes) {
        ctx.addIssue({
          code: "custom",
          path: ["businessLatestEnd"],
          message: "Der Zeitrahmen ist kürzer als die Mindestdauer eines Blocks.",
        });
      }
    }
    if (v.businessMaxBlockMinutes < v.businessMinBlockMinutes) {
      ctx.addIssue({
        code: "custom",
        path: ["businessMaxBlockMinutes"],
        message: "Die Höchstdauer darf nicht kleiner als die Mindestdauer sein.",
      });
    }
    if (v.businessMaxDailyMinutes < v.businessMinBlockMinutes) {
      ctx.addIssue({
        code: "custom",
        path: ["businessMaxDailyMinutes"],
        message: "Der Tageshöchstwert muss mindestens einen Block fassen.",
      });
    }
    for (const key of ["businessSaturdayMaxMinutes", "businessSundayMaxMinutes"] as const) {
      if (v[key] > 0 && v[key] < v.businessMinBlockMinutes) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Am Wochenende 0 (kein Gewerbe) oder mindestens eine Blocklänge angeben.",
        });
      }
    }
  });
export type PlanningPreferencesInput = z.input<typeof planningPreferencesInputSchema>;
export type PlanningPreferencesInputParsed = z.output<typeof planningPreferencesInputSchema>;

const slotTitleSchema = z
  .string({ error: "Bitte einen Titel angeben" })
  .trim()
  .min(1, { error: "Bitte einen Titel angeben" })
  .max(TITLE_MAX_LENGTH, { error: `Der Titel darf höchstens ${TITLE_MAX_LENGTH} Zeichen haben` });

export const goalSlotInputSchema = z
  .object({
    weekday: isoWeekdaySchema,
    requirement: z.enum(SLOT_REQUIREMENTS, { error: "Bitte „verbindlich“ oder „optional“ wählen" }),
    title: slotTitleSchema,
    durationMinutes: minutesField("Dauer", 15, 720),
    windowStart: timeOfDaySchema,
    windowEnd: timeOfDaySchema,
  })
  .superRefine((v, ctx) => {
    if (!isValidTimeOfDay(v.windowStart) || !isValidTimeOfDay(v.windowEnd)) return;
    const window = minutesOfDay(v.windowEnd) - minutesOfDay(v.windowStart);
    if (window <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["windowEnd"],
        message: "Das Zeitfenster muss am selben Tag enden.",
      });
    } else if (window < v.durationMinutes) {
      ctx.addIssue({
        code: "custom",
        path: ["durationMinutes"],
        message: "Die Dauer passt nicht in das Zeitfenster.",
      });
    }
  });
export type GoalSlotInputParsed = z.output<typeof goalSlotInputSchema>;

export const goalSlotsInputSchema = z
  .object({
    goal: z.enum(PLANNER_SLOT_GOALS),
    slots: z.array(goalSlotInputSchema).max(7),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<number>();
    v.slots.forEach((slot, index) => {
      if (seen.has(slot.weekday)) {
        ctx.addIssue({
          code: "custom",
          path: ["slots", index, "weekday"],
          message: "Je Wochentag höchstens ein Zeitfenster.",
        });
      }
      seen.add(slot.weekday);
    });
  });
export type GoalSlotsInputParsed = z.output<typeof goalSlotsInputSchema>;

// ---------------------------------------------------------------------------
// Planungskontext
// ---------------------------------------------------------------------------

export interface PlannerSettings {
  timezone: string;
  /** false, solange die Wochenziele nie gespeichert wurden (nur Standardwerte). */
  persisted: boolean;
  businessTargetMinutes: number;
  sportTargetMinutes: number | null;
  relationshipTargetMinutes: number | null;
}

export interface PlannerFixedEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  location: string | null;
  note: string | null;
  /** `recurring`: aus aktiven Wiederholungen; `manual`: Einzeltermin der Woche (bleibt erhalten). */
  source: "recurring" | "manual";
}

/** Manueller Einzeltermin der Basisversion (Entwurf, sonst veröffentlichte Version). */
export interface PlannerOneOffEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  location: string | null;
  note: string | null;
}

/** Manuelle Einträge einer Version als Einzeltermine (bleiben beim Speichern eines Vorschlags). */
export function manualOneOffs(
  entries: readonly (PlannerOneOffEntry & { source: string })[],
): PlannerOneOffEntry[] {
  return entries
    .filter((entry) => entry.source === "manual")
    .map((entry) => ({
      title: entry.title,
      category: entry.category,
      start_at: entry.start_at,
      end_at: entry.end_at,
      location: entry.location,
      note: entry.note,
    }));
}

export interface PlannerSlotInstance extends PlanningGoalSlot {
  /** Neutrale, nicht technische Kennung, z. B. „sport-2026-10-12“. */
  slotId: string;
  date: LocalDate;
  windowStartAt: number;
  windowEndAt: number;
}

export interface PlannerDay {
  date: LocalDate;
  weekday: IsoWeekday;
  start: number;
  end: number;
  /** Höchstens so viel Gewerbe an diesem Tag (0 = keines). */
  businessMaxMinutes: number;
  /** Liegt vollständig vor `notBefore` (laufende Woche). */
  past: boolean;
}

export interface PlanningContext {
  weekStart: LocalDate;
  timeZone: string;
  now: Date;
  /** Frühester Beginn neuer Blöcke (ms). */
  notBefore: number;
  settings: PlannerSettings;
  preferences: PlanningPreferences | null;
  slots: PlannerSlotInstance[];
  fixed: PlannerFixedEntry[];
  days: PlannerDay[];
}

function ceilToStep(ms: number, stepMinutes: number): number {
  const step = stepMinutes * MINUTE_MS;
  return Math.ceil(ms / step) * step;
}

function businessMaxFor(weekday: IsoWeekday, preferences: PlanningPreferences | null): number {
  if (!preferences) return 0;
  if (weekday === 6) return preferences.businessSaturdayMaxMinutes;
  if (weekday === 7) return preferences.businessSundayMaxMinutes;
  return preferences.businessMaxDailyMinutes;
}

export function buildPlanningContext(input: {
  weekStart: LocalDate;
  now: Date;
  settings: PlannerSettings;
  preferences: PlanningPreferences | null;
  slots: readonly PlanningGoalSlot[];
  commitments: readonly RecurringTemplate[];
  /** Manuelle Einzeltermine der Woche; sie bleiben beim Planen unverändert erhalten. */
  oneOffEntries?: readonly PlannerOneOffEntry[];
  timeZone?: string;
}): PlanningContext {
  const timeZone = input.timeZone ?? SCHEDULE_TIMEZONE;
  const week = getWeekBounds(input.weekStart, timeZone);
  const notBefore = Math.max(
    week.start.getTime(),
    ceilToStep(input.now.getTime(), NOT_BEFORE_STEP_MINUTES),
  );
  const days = getWeekDays(input.weekStart).map((date): PlannerDay => {
    const bounds = getDayBounds(date, timeZone);
    const weekday = isoWeekdayOfLocalDate(date);
    return {
      date,
      weekday,
      start: bounds.start.getTime(),
      end: bounds.end.getTime(),
      businessMaxMinutes: businessMaxFor(weekday, input.preferences),
      past: bounds.end.getTime() <= notBefore,
    };
  });
  const slots = [...input.slots]
    .sort((a, b) => a.goal.localeCompare(b.goal) || a.weekday - b.weekday)
    .map((slot): PlannerSlotInstance => {
      const date = addDays(input.weekStart, slot.weekday - 1);
      return {
        ...slot,
        slotId: `${slot.goal}-${date}`,
        date,
        windowStartAt: zonedDateTimeToInstant(date, slot.windowStart, timeZone).getTime(),
        windowEndAt: zonedDateTimeToInstant(date, slot.windowEnd, timeZone).getTime(),
      };
    });
  return {
    weekStart: input.weekStart,
    timeZone,
    now: input.now,
    notBefore,
    settings: input.settings,
    preferences: input.preferences,
    slots,
    fixed: [
      ...expandRecurringCommitments(input.commitments, input.weekStart, timeZone),
      ...(input.oneOffEntries ?? []).map((entry): PlannerFixedEntry => ({
        title: entry.title,
        category: entry.category,
        start_at: entry.start_at,
        end_at: entry.end_at,
        location: entry.location,
        note: entry.note,
        source: "manual",
      })),
    ].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)),
    days,
  };
}

// ---------------------------------------------------------------------------
// Voraussetzungen
// ---------------------------------------------------------------------------

export type PlanningRequirementKey =
  | "week"
  | "timezone"
  | "goals"
  | "business-target"
  | "preferences"
  | "commitments"
  | "sport-slots"
  | "relationship-slots";

export interface PlanningRequirement {
  key: PlanningRequirementKey;
  message: string;
  /** Feste, interne Seite zum Nachtragen. */
  href: string;
}

/** Bezeichnungen der Zeitfenster-Ziele in der Oberfläche (nie an das Modell). */
export const SLOT_GOAL_LABELS: Readonly<Record<PlannerSlotGoal, string>> = {
  sport: "Training",
  relationship: `Zeit mit ${GOAL_LABELS.relationship}`,
};

export const PLANNER_LINKS = {
  goals: "/einstellungen#wochenziele",
  rules: "/einstellungen#planungsregeln",
  commitments: "/wiederholungen",
} as const;

/** Lesbare Wochen: die laufende und die nächsten `PLANNER_HORIZON_WEEKS`. */
export function plannableWeekStarts(now: Date, timeZone: string = SCHEDULE_TIMEZONE): LocalDate[] {
  const current = getWeekStart(now, timeZone);
  return Array.from({ length: PLANNER_HORIZON_WEEKS + 1 }, (_, i) => addDays(current, i * 7));
}

/** Über den Connector speicherbar: nur kommende Wochen (nicht die laufende). */
export function upcomingWeekStarts(now: Date, timeZone: string = SCHEDULE_TIMEZONE): LocalDate[] {
  return plannableWeekStarts(now, timeZone).slice(1);
}

/** Fehlende Angaben – ohne sie wird nicht geplant (nichts wird geraten). */
export function getMissingPlanningRequirements(context: PlanningContext): PlanningRequirement[] {
  const missing: PlanningRequirement[] = [];
  const { settings, preferences } = context;
  if (!plannableWeekStarts(context.now, context.timeZone).includes(context.weekStart)) {
    missing.push({
      key: "week",
      message: `Geplant werden können nur die laufende und die nächsten ${PLANNER_HORIZON_WEEKS} Wochen.`,
      href: "/planen",
    });
  }
  if (settings.timezone !== SCHEDULE_TIMEZONE) {
    missing.push({
      key: "timezone",
      message: `Die Zeitzone des Kontos muss ${SCHEDULE_TIMEZONE} sein.`,
      href: PLANNER_LINKS.goals,
    });
  }
  if (!settings.persisted) {
    missing.push({
      key: "goals",
      message: "Die Wochenziele sind noch nicht gespeichert (bisher nur Standardwerte).",
      href: PLANNER_LINKS.goals,
    });
  }
  if (settings.businessTargetMinutes <= 0) {
    missing.push({
      key: "business-target",
      message: "Für den Planer fehlt ein Gewerbe-Wochenziel (Mindestzeit).",
      href: PLANNER_LINKS.goals,
    });
  }
  if (!preferences) {
    missing.push({
      key: "preferences",
      message:
        "Planungsregeln für Gewerbe fehlen: frühester Beginn, spätestes Ende, Blocklängen, Tageshöchstwerte, Wochenende und Pausen.",
      href: PLANNER_LINKS.rules,
    });
  }
  // Dienst, Training und Beziehungszeit sind feste Bestandteile jedes Wochenplans.
  if (!context.fixed.some((f) => f.category === "duty")) {
    missing.push({
      key: "commitments",
      message:
        "Es sind keine aktiven Dienstzeiten gespeichert (Wiederholungen der Kategorie „Dienst“).",
      href: PLANNER_LINKS.commitments,
    });
  }
  for (const goal of PLANNER_SLOT_GOALS) {
    if (!context.slots.some((s) => s.goal === goal && s.requirement === "required")) {
      missing.push({
        key: `${goal}-slots`,
        message: `Für „${SLOT_GOAL_LABELS[goal]}“ sind keine verbindlichen Tage mit Zeitfenster und Dauer hinterlegt.`,
        href: PLANNER_LINKS.rules,
      });
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Machbarkeit (vor jedem Modellaufruf)
// ---------------------------------------------------------------------------

interface Interval {
  start: number;
  end: number;
}

function formatLocalRange(start: number, end: number, timeZone: string): string {
  return `${toLocalTime(new Date(start), timeZone)}–${toLocalTime(new Date(end), timeZone)}`;
}

function dayLabel(date: LocalDate): string {
  return formatLocalDateShort(date);
}

/** Freie Abschnitte in [from, to) ohne `busy` (jeweils um `buffer` erweitert). */
function freeIntervals(
  from: number,
  to: number,
  busy: readonly Interval[],
  buffer: number,
): Interval[] {
  const blocked = busy
    .map((b) => ({ start: b.start - buffer, end: b.end + buffer }))
    .filter((b) => b.end > from && b.start < to)
    .sort((a, b) => a.start - b.start);
  const free: Interval[] = [];
  let cursor = from;
  for (const b of blocked) {
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, to) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= to) break;
  }
  if (cursor < to) free.push({ start: cursor, end: to });
  return free.filter((f) => f.end > f.start);
}

function fixedIntervals(context: PlanningContext): Interval[] {
  return context.fixed.map((e) => ({ start: Date.parse(e.start_at), end: Date.parse(e.end_at) }));
}

/**
 * Konflikte, die eine Entscheidung des Benutzers brauchen: überschneidende feste
 * Verpflichtungen, nicht planbare verbindliche Blöcke, nicht erreichbares Gewerbe-Minimum.
 */
export function findPlanningConflicts(context: PlanningContext): string[] {
  const conflicts: string[] = [];
  const { timeZone } = context;
  for (const overlap of detectOverlaps(context.fixed)) {
    const start = Math.max(Date.parse(overlap.first.start_at), Date.parse(overlap.second.start_at));
    conflicts.push(
      `Feste Verpflichtungen überschneiden sich am ${dayLabel(toLocalDate(new Date(start), timeZone))} (${CATEGORY_LABELS[overlap.first.category]} und ${CATEGORY_LABELS[overlap.second.category]}).`,
    );
  }
  const preferences = context.preferences;
  if (!preferences) return conflicts;
  const buffer = preferences.bufferMinutes * MINUTE_MS;
  const busy = fixedIntervals(context);

  for (const slot of context.slots) {
    if (slot.requirement !== "required") continue;
    const from = Math.max(slot.windowStartAt, context.notBefore);
    const fits = freeIntervals(from, slot.windowEndAt, busy, buffer).some(
      (f) => f.end - f.start >= slot.durationMinutes * MINUTE_MS,
    );
    if (!fits) {
      const label = slot.goal === "sport" ? "Training" : GOAL_LABELS.relationship;
      conflicts.push(
        slot.windowEndAt <= context.notBefore
          ? `${label} am ${dayLabel(slot.date)} liegt bereits in der Vergangenheit und kann nicht mehr geplant werden.`
          : `${label} am ${dayLabel(slot.date)}: Im Zeitfenster ${slot.windowStart}–${slot.windowEnd} ist kein freier Platz für ${formatDuration(slot.durationMinutes)} (inklusive ${preferences.bufferMinutes} Min. Pause).`,
      );
    }
  }

  const target = context.settings.businessTargetMinutes;
  if (target > 0) {
    let capacity = 0;
    for (const day of context.days) {
      if (day.businessMaxMinutes <= 0 || day.past) continue;
      const windowStart = zonedDateTimeToInstant(
        day.date,
        preferences.businessEarliestStart,
        timeZone,
      ).getTime();
      const windowEnd = zonedDateTimeToInstant(
        day.date,
        preferences.businessLatestEnd,
        timeZone,
      ).getTime();
      const usable = freeIntervals(
        Math.max(windowStart, context.notBefore),
        windowEnd,
        busy,
        buffer,
      )
        .map((f) => (f.end - f.start) / MINUTE_MS)
        .filter((minutes) => minutes >= preferences.businessMinBlockMinutes)
        .reduce((sum, minutes) => sum + minutes, 0);
      capacity += Math.min(day.businessMaxMinutes, Math.floor(usable));
    }
    if (capacity < target) {
      conflicts.push(
        `Gewerbe-Minimum nicht erreichbar: Mit den gespeicherten Regeln sind höchstens ${formatDuration(capacity)} frei (Wochenziel ${formatDuration(target)}).`,
      );
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Vorschlag: strenges Eingabeschema (Werkzeuge des Claude-Connectors)
// ---------------------------------------------------------------------------

const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Uhrzeit im Format HH:MM erwartet" });

export const weekPlanBlockSchema = z
  .object({
    kind: z.enum(PLANNER_BLOCK_KINDS, {
      error: "Erlaubt sind nur business, sport, relationship und appointment",
    }),
    /** Pflicht für sport/relationship (aus dem Planungskontext), sonst leer. */
    slotId: z.string().max(40).nullish(),
    date: localDateSchema,
    start: clockTimeSchema,
    end: clockTimeSchema,
    /** Nur für business und appointment; Training und Beziehungszeit benennt der Server. */
    title: z.string().trim().min(1).max(PLANNER_TITLE_MAX_LENGTH).optional(),
    reason: z.string().trim().min(1).max(PLANNER_REASON_MAX_LENGTH).optional(),
  })
  .strict();
export type WeekPlanBlock = z.infer<typeof weekPlanBlockSchema>;

export const weekPlanProposalSchema = z
  .object({
    weekStart: weekStartSchema,
    blocks: z.array(weekPlanBlockSchema).max(PLANNER_MAX_BLOCKS),
    /** Kurze Zusammenfassung der Wochenbesonderheiten (wird als Planungshinweis gespeichert). */
    summary: z.string().trim().min(1).max(PLANNER_SUMMARY_MAX_LENGTH).optional(),
  })
  .strict();
export type WeekPlanProposal = z.infer<typeof weekPlanProposalSchema>;

/** Prüft einen Vorschlag streng; unbekannte Felder → Fehler (ohne Inhalte zurückzuspiegeln). */
export function parseWeekPlanProposal(
  value: unknown,
): { ok: true; proposal: WeekPlanProposal } | { ok: false; errors: string[] } {
  const parsed = weekPlanProposalSchema.safeParse(value);
  if (parsed.success) return { ok: true, proposal: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues
      .slice(0, PLANNER_MAX_LIST_ITEMS)
      .map((issue) => `Format: ${issue.path.join(".") || "(Wurzel)"} – ${issue.code}`),
  };
}

// ---------------------------------------------------------------------------
// Planungskontext für den Claude-Connector (bereinigt)
// ---------------------------------------------------------------------------

const ORIGIN_LABELS = {
  recurring: "Wiederholung",
  manual: "Einzeltermin",
  agent: "Vorschlag",
} as const;

/** Ein Block ohne Titel, Notiz, Ort oder ID – nur Zeit und neutrale Art. */
export interface NeutralBlock {
  date: LocalDate;
  start: TimeOfDay;
  end: TimeOfDay;
  endsNextDay: boolean;
  kind: string;
  origin: (typeof ORIGIN_LABELS)[keyof typeof ORIGIN_LABELS];
}

interface SourcedEntry {
  category: EntryCategory;
  start_at: string;
  end_at: string;
  source: keyof typeof ORIGIN_LABELS;
}

export function neutralBlocks(
  entries: readonly SourcedEntry[],
  timeZone: string = SCHEDULE_TIMEZONE,
): NeutralBlock[] {
  return [...entries]
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .map((entry) => {
      const start = new Date(entry.start_at);
      const end = new Date(entry.end_at);
      return {
        date: toLocalDate(start, timeZone),
        start: toLocalTime(start, timeZone),
        end: toLocalTime(end, timeZone),
        endsNextDay: toLocalDate(end, timeZone) !== toLocalDate(start, timeZone),
        kind: PLANNER_NEUTRAL_KIND_LABELS[entry.category],
        origin: ORIGIN_LABELS[entry.source],
      };
    });
}

export interface ConnectorSlot {
  slotId: string;
  date: LocalDate;
  weekday: string;
  required: boolean;
  durationMinutes: number;
  windowStart: TimeOfDay;
  windowEnd: TimeOfDay;
}

export interface ConnectorPlanningContext {
  week: { start: LocalDate; end: LocalDate; timezone: string; locale: string };
  /** Nur kommende Wochen dürfen gespeichert werden. */
  saveAllowed: boolean;
  /** Neue Blöcke frühestens ab hier (laufende Woche); sonst null. */
  earliestStart: { date: LocalDate; time: TimeOfDay } | null;
  rules: {
    duty: { date: LocalDate; weekday: string; start: TimeOfDay; end: TimeOfDay }[];
    training: ConnectorSlot[];
    relationship: ConnectorSlot[];
    business: {
      minimumMinutesPerWeek: number;
      earliestStart: TimeOfDay;
      latestEnd: TimeOfDay;
      minBlockMinutes: number;
      maxBlockMinutes: number;
      maxMinutesPerWeekday: number;
      saturdayMaxMinutes: number;
      sundayMaxMinutes: number;
    } | null;
    bufferMinutes: number | null;
    weeklyTargets: { sportMinutes: number | null; relationshipMinutes: number | null };
  };
  /** Feste Belegung je Tag (Ortszeit; 24:00 = Tagesende) und Gewerbe-Höchstwert. */
  days: {
    date: LocalDate;
    weekday: string;
    busy: { start: string; end: string; kind: string; origin: NeutralBlock["origin"] }[];
    businessMaxMinutes: number;
    plannable: boolean;
  }[];
  oneOffAppointments: NeutralBlock[];
  existingDraft: { draftRef: string; version: number; blocks: NeutralBlock[] } | null;
  publishedPlan: { version: number; publishedAt: string | null; blocks: NeutralBlock[] } | null;
  missing: string[];
  conflicts: string[];
}

function connectorSlot(slot: PlannerSlotInstance): ConnectorSlot {
  return {
    slotId: slot.slotId,
    date: slot.date,
    weekday: WEEKDAY_LABELS[slot.weekday],
    required: slot.requirement === "required",
    durationMinutes: slot.durationMinutes,
    windowStart: slot.windowStart,
    windowEnd: slot.windowEnd,
  };
}

/**
 * Nur, was für die Planung nötig ist: Zeiten, neutrale Arten, Regeln und ein opaker
 * Versionsbezug des Entwurfs. Keine Titel, Notizen, Orte, IDs, E-Mail-Adressen oder Namen –
 * Datenbanktexte erreichen Claude nie (auch nicht als mögliche Anweisungen).
 */
export function buildConnectorPlanningContext(
  context: PlanningContext,
  input: {
    locale: string;
    saveAllowed: boolean;
    draft: { ref: string; version: number; entries: readonly SourcedEntry[] } | null;
    published: {
      version: number;
      publishedAt: string | null;
      entries: readonly SourcedEntry[];
    } | null;
  },
): ConnectorPlanningContext {
  const { timeZone, preferences } = context;
  const notBefore = new Date(context.notBefore);
  const weekStartMs = getWeekBounds(context.weekStart, timeZone).start.getTime();
  const missing = getMissingPlanningRequirements(context).map((m) =>
    neutralizePlannerText(m.message),
  );
  return {
    week: {
      start: context.weekStart,
      end: addDays(context.weekStart, 6),
      timezone: timeZone,
      locale: input.locale,
    },
    saveAllowed: input.saveAllowed,
    earliestStart:
      context.notBefore > weekStartMs
        ? { date: toLocalDate(notBefore, timeZone), time: toLocalTime(notBefore, timeZone) }
        : null,
    rules: {
      duty: context.fixed
        .filter((e) => e.category === "duty" && e.source === "recurring")
        .map((e) => {
          const date = toLocalDate(new Date(e.start_at), timeZone);
          return {
            date,
            weekday: WEEKDAY_LABELS[isoWeekdayOfLocalDate(date)],
            start: toLocalTime(new Date(e.start_at), timeZone),
            end: toLocalTime(new Date(e.end_at), timeZone),
          };
        }),
      training: context.slots.filter((s) => s.goal === "sport").map(connectorSlot),
      relationship: context.slots.filter((s) => s.goal === "relationship").map(connectorSlot),
      business: preferences
        ? {
            minimumMinutesPerWeek: context.settings.businessTargetMinutes,
            earliestStart: preferences.businessEarliestStart,
            latestEnd: preferences.businessLatestEnd,
            minBlockMinutes: preferences.businessMinBlockMinutes,
            maxBlockMinutes: preferences.businessMaxBlockMinutes,
            maxMinutesPerWeekday: preferences.businessMaxDailyMinutes,
            saturdayMaxMinutes: preferences.businessSaturdayMaxMinutes,
            sundayMaxMinutes: preferences.businessSundayMaxMinutes,
          }
        : null,
      bufferMinutes: preferences?.bufferMinutes ?? null,
      weeklyTargets: {
        sportMinutes: context.settings.sportTargetMinutes,
        relationshipMinutes: context.settings.relationshipTargetMinutes,
      },
    },
    days: context.days.map((day) => ({
      date: day.date,
      weekday: WEEKDAY_LABELS[day.weekday],
      busy: context.fixed
        .filter((e) => Date.parse(e.start_at) < day.end && Date.parse(e.end_at) > day.start)
        .map((e) => {
          const start = Date.parse(e.start_at);
          const end = Date.parse(e.end_at);
          return {
            start: start <= day.start ? "00:00" : toLocalTime(new Date(start), timeZone),
            end: end >= day.end ? "24:00" : toLocalTime(new Date(end), timeZone),
            kind: PLANNER_NEUTRAL_KIND_LABELS[e.category],
            origin: ORIGIN_LABELS[e.source],
          };
        }),
      businessMaxMinutes: day.businessMaxMinutes,
      plannable: !day.past,
    })),
    oneOffAppointments: neutralBlocks(
      context.fixed.filter((e) => e.source === "manual"),
      timeZone,
    ),
    existingDraft: input.draft
      ? {
          draftRef: input.draft.ref,
          version: input.draft.version,
          blocks: neutralBlocks(input.draft.entries, timeZone),
        }
      : null,
    publishedPlan: input.published
      ? {
          version: input.published.version,
          publishedAt: input.published.publishedAt,
          blocks: neutralBlocks(input.published.entries, timeZone),
        }
      : null,
    missing,
    conflicts:
      missing.length === 0 ? findPlanningConflicts(context).map(neutralizePlannerText) : [],
  };
}

// ---------------------------------------------------------------------------
// Vorschlag prüfen und in Einträge übersetzen
// ---------------------------------------------------------------------------

export interface PlannedEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  location: string | null;
  note: string | null;
  source: "recurring" | "agent";
}

/** Einzeilig, ohne Steuerzeichen, begrenzte Länge – Vorschlagstext ist nie Markup. */
export function cleanPlannerText(value: string, maxLength: number): string {
  const printable = Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : char;
  }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function localInstant(date: LocalDate, time: TimeOfDay, timeZone: string): number | null {
  const instant = zonedDateTimeToInstant(date, time, timeZone);
  // Uhrzeiten in der Lücke der Sommerzeitumstellung existieren nicht.
  if (toLocalDate(instant, timeZone) !== date || toLocalTime(instant, timeZone) !== time)
    return null;
  return instant.getTime();
}

interface CheckedBlock {
  index: number;
  kind: PlannerBlockKind;
  date: LocalDate;
  start: number;
  end: number;
  entry: PlannedEntry;
}

/**
 * Prüft einen Vorschlag deterministisch gegen Woche, Zeitlogik, Zeitfenster, Regeln, Pausen und
 * Überschneidungen (auch mit Einzelterminen). Nur ein fehlerfreier Vorschlag ergibt Einträge:
 * `entries` (Wiederholungen + vorgeschlagene Blöcke, so werden sie gespeichert) und
 * `oneOffs` (manuelle Einzeltermine, die im Entwurf unverändert bleiben). Bei jeder Abweichung
 * `ok: false` – dann wird nichts gespeichert.
 */
export function materializeProposal(
  context: PlanningContext,
  proposal: WeekPlanProposal,
):
  | { ok: true; entries: PlannedEntry[]; oneOffs: PlannerFixedEntry[] }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const preferences = context.preferences;
  if (!preferences) return { ok: false, errors: ["Planungsregeln fehlen."] };
  const { timeZone } = context;
  const weekDays = new Set(getWeekDays(context.weekStart));
  const slotsById = new Map(context.slots.map((slot) => [slot.slotId, slot]));
  const usedSlots = new Set<string>();
  const buffer = preferences.bufferMinutes * MINUTE_MS;

  if (proposal.weekStart !== context.weekStart) {
    errors.push(`Der Vorschlag betrifft die falsche Woche (erwartet ${context.weekStart}).`);
  }

  const checked: CheckedBlock[] = [];
  proposal.blocks.forEach((block, index) => {
    const where = `Block ${index + 1} (${weekDays.has(block.date) ? dayLabel(block.date) : block.date} ${block.start}–${block.end})`;
    if (!weekDays.has(block.date)) {
      errors.push(`${where}: liegt außerhalb der geplanten Woche.`);
      return;
    }
    const start = localInstant(block.date, block.start, timeZone);
    const end = localInstant(block.date, block.end, timeZone);
    if (start === null || end === null) {
      errors.push(`${where}: Uhrzeit existiert an diesem Tag nicht (Zeitumstellung).`);
      return;
    }
    if (end <= start) {
      errors.push(`${where}: Ende muss nach dem Beginn am selben Tag liegen.`);
      return;
    }
    const minutes = (end - start) / MINUTE_MS;
    if (minutes < PLANNER_MIN_BLOCK_MINUTES) {
      errors.push(`${where}: kürzer als ${PLANNER_MIN_BLOCK_MINUTES} Minuten.`);
      return;
    }
    if (start < context.notBefore) {
      errors.push(`${where}: beginnt in der Vergangenheit.`);
      return;
    }

    let title: string;
    let category: EntryCategory;
    if (block.kind === "appointment") {
      category = "appointment";
      if (block.slotId !== null && block.slotId !== undefined)
        errors.push(`${where}: Termine gehören zu keinem Zeitfenster.`);
      title =
        cleanPlannerText(block.title ?? "", PLANNER_TITLE_MAX_LENGTH) || DEFAULT_APPOINTMENT_TITLE;
    } else if (block.kind === "business") {
      category = "business";
      if (block.slotId !== null && block.slotId !== undefined)
        errors.push(`${where}: Gewerbe gehört zu keinem Zeitfenster.`);
      if (
        block.start < preferences.businessEarliestStart ||
        block.end > preferences.businessLatestEnd
      ) {
        errors.push(
          `${where}: Gewerbe nur zwischen ${preferences.businessEarliestStart} und ${preferences.businessLatestEnd}.`,
        );
      }
      if (
        minutes < preferences.businessMinBlockMinutes ||
        minutes > preferences.businessMaxBlockMinutes
      ) {
        errors.push(
          `${where}: Gewerbeblöcke dauern ${preferences.businessMinBlockMinutes}–${preferences.businessMaxBlockMinutes} Minuten.`,
        );
      }
      title =
        cleanPlannerText(block.title ?? "", PLANNER_TITLE_MAX_LENGTH) ||
        DEFAULT_BUSINESS_BLOCK_TITLE;
    } else {
      category = block.kind;
      const slot =
        block.slotId === null || block.slotId === undefined
          ? undefined
          : slotsById.get(block.slotId);
      if (!slot || slot.goal !== block.kind) {
        errors.push(`${where}: gehört zu keinem hinterlegten Zeitfenster für dieses Ziel.`);
        return;
      }
      if (usedSlots.has(slot.slotId)) {
        errors.push(
          `${where}: Zeitfenster ${slot.slotId} ist bereits belegt (höchstens ein Block je Tag).`,
        );
        return;
      }
      usedSlots.add(slot.slotId);
      if (slot.date !== block.date) errors.push(`${where}: falscher Tag für ${slot.slotId}.`);
      if (start < slot.windowStartAt || end > slot.windowEndAt) {
        errors.push(`${where}: außerhalb des Zeitfensters ${slot.windowStart}–${slot.windowEnd}.`);
      }
      if (minutes !== slot.durationMinutes) {
        errors.push(`${where}: Dauer muss genau ${slot.durationMinutes} Minuten betragen.`);
      }
      // Sichtbarer Titel aus den eigenen Einstellungen, nie aus dem Vorschlag.
      title = slot.title;
    }

    checked.push({
      index,
      kind: block.kind,
      date: block.date,
      start,
      end,
      entry: {
        title,
        category,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        location: null,
        note: cleanPlannerText(block.reason ?? "", PLANNER_REASON_MAX_LENGTH) || null,
        source: "agent",
      },
    });
  });

  // Verbindliche Zeitfenster müssen belegt sein.
  for (const slot of context.slots) {
    if (slot.requirement === "required" && !usedSlots.has(slot.slotId)) {
      errors.push(`Verbindlicher Block fehlt: ${slot.slotId} (${dayLabel(slot.date)}).`);
    }
  }

  // Überschneidungen und Pausen: gegen feste Verpflichtungen (inkl. Einzeltermine) und untereinander.
  const fixed = fixedIntervals(context);
  checked.forEach((block, i) => {
    for (const other of fixed) {
      if (block.start < other.end + buffer && other.start < block.end + buffer) {
        errors.push(
          `Block ${block.index + 1}: überschneidet eine feste Verpflichtung (${formatLocalRange(other.start, other.end, timeZone)}) oder hält die Pause von ${preferences.bufferMinutes} Min. nicht ein.`,
        );
      }
    }
    for (const other of checked.slice(i + 1)) {
      if (block.start < other.end + buffer && other.start < block.end + buffer) {
        errors.push(
          `Block ${block.index + 1} und Block ${other.index + 1}: überschneiden sich oder halten die Pause von ${preferences.bufferMinutes} Min. nicht ein.`,
        );
      }
    }
  });

  // Gewerbe je Tag und Woche.
  for (const day of context.days) {
    const minutes = checked
      .filter((b) => b.kind === "business" && b.date === day.date)
      .reduce((sum, b) => sum + (b.end - b.start) / MINUTE_MS, 0);
    if (minutes > day.businessMaxMinutes) {
      errors.push(
        day.businessMaxMinutes === 0
          ? `Am ${dayLabel(day.date)} ist kein Gewerbe vorgesehen.`
          : `Am ${dayLabel(day.date)} höchstens ${formatDuration(day.businessMaxMinutes)} Gewerbe (geplant ${formatDuration(minutes)}).`,
      );
    }
  }
  const businessTotal = checked
    .filter((b) => b.kind === "business")
    .reduce((sum, b) => sum + (b.end - b.start) / MINUTE_MS, 0);
  if (businessTotal < context.settings.businessTargetMinutes) {
    errors.push(
      `Gewerbe-Minimum nicht erreicht: nur ${formatDuration(businessTotal)} geplant (Wochenziel ${formatDuration(context.settings.businessTargetMinutes)}).`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  const entries: PlannedEntry[] = [
    ...context.fixed
      .filter((e) => e.source === "recurring")
      .map((e): PlannedEntry => ({ ...e, source: "recurring" })),
    ...checked.map((b) => b.entry),
  ].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return { ok: true, entries, oneOffs: context.fixed.filter((e) => e.source === "manual") };
}

// ---------------------------------------------------------------------------
// Bewertung eines gespeicherten Entwurfs (Prüfübersicht vor dem Veröffentlichen)
// ---------------------------------------------------------------------------

export interface EvaluatedEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  completion_status: "planned" | "completed" | "skipped";
}

export interface PlanCheck {
  key: string;
  label: string;
  ok: boolean;
  /** Anzeigewert, z. B. „20 Std.“ oder „0“. */
  value?: string;
  /** Muss für das Veröffentlichen erfüllt sein. */
  hard: boolean;
}

export interface PlanEvaluation {
  checks: PlanCheck[];
  minutes: Record<GoalKey, number>;
  overlapCount: number;
  /** Was vor dem Veröffentlichen entschieden bzw. behoben werden muss. */
  openDecisions: string[];
  publishable: boolean;
}

function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

function slotCheck(
  context: PlanningContext,
  entries: readonly EvaluatedEntry[],
  goal: PlannerSlotGoal,
): { ok: boolean; problems: string[] } {
  const slots = context.slots.filter((s) => s.goal === goal);
  const goalEntries = entries.filter((e) => e.category === goal);
  const problems: string[] = [];
  const label = goal === "sport" ? "Training" : GOAL_LABELS.relationship;
  for (const day of context.days) {
    const onDay = goalEntries.filter(
      (e) => toLocalDate(new Date(e.start_at), context.timeZone) === day.date,
    );
    const slot = slots.find((s) => s.date === day.date);
    if (!slot) {
      if (onDay.length > 0)
        problems.push(`${label} am ${dayLabel(day.date)} ohne hinterlegtes Zeitfenster.`);
      continue;
    }
    if (onDay.length > 1) problems.push(`Mehr als ein Block „${label}“ am ${dayLabel(day.date)}.`);
    const fitting = onDay.filter(
      (e) =>
        Date.parse(e.start_at) >= slot.windowStartAt &&
        Date.parse(e.end_at) <= slot.windowEndAt &&
        (Date.parse(e.end_at) - Date.parse(e.start_at)) / MINUTE_MS === slot.durationMinutes,
    );
    if (slot.requirement === "required" && fitting.length === 0) {
      problems.push(
        `${label} am ${dayLabel(day.date)} fehlt (${formatDuration(slot.durationMinutes)} zwischen ${slot.windowStart} und ${slot.windowEnd}).`,
      );
    } else if (onDay.length > 0 && fitting.length === 0) {
      problems.push(`${label} am ${dayLabel(day.date)} passt nicht zu Zeitfenster und Dauer.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function evaluatePlanDraft(
  context: PlanningContext,
  entries: readonly EvaluatedEntry[],
): PlanEvaluation {
  const checks: PlanCheck[] = [];
  const openDecisions: string[] = [];
  const add = (check: PlanCheck, problems: readonly string[] = []) => {
    checks.push(check);
    if (check.hard && !check.ok)
      openDecisions.push(...(problems.length > 0 ? problems : [check.label]));
  };

  const allMissing = getMissingPlanningRequirements(context);
  const missingMessage = (key: PlanningRequirementKey) =>
    allMissing.filter((m) => m.key === key).map((m) => m.message);
  // Dienst und Zeitfenster haben eigene Prüfzeilen (siehe unten).
  const missing = allMissing.filter(
    (m) => !["week", "commitments", "sport-slots", "relationship-slots"].includes(m.key),
  );
  add(
    {
      key: "preferences",
      label: "Persönliche Planungsregeln aus den Einstellungen",
      ok: missing.length === 0,
      hard: true,
    },
    missing.map((m) => m.message),
  );
  add({
    key: "timezone",
    label: `Zeitangaben in ${SCHEDULE_TIMEZONE}`,
    ok: context.settings.timezone === SCHEDULE_TIMEZONE,
    hard: true,
  });

  const missingFixed = (category: "duty" | "other") =>
    context.fixed.filter(
      (f) =>
        (category === "duty" ? f.category === "duty" : f.category !== "duty") &&
        !entries.some(
          (e) =>
            e.category === f.category &&
            e.title === f.title &&
            sameInstant(e.start_at, f.start_at) &&
            sameInstant(e.end_at, f.end_at),
        ),
    );
  {
    const hasDuty = context.fixed.some((f) => f.category === "duty");
    const gaps = missingFixed("duty");
    add(
      { key: "duty", label: "Dienst vollständig", ok: hasDuty && gaps.length === 0, hard: true },
      hasDuty
        ? gaps.map(
            (f) =>
              `Dienst am ${dayLabel(toLocalDate(new Date(f.start_at), context.timeZone))} (${formatLocalRange(Date.parse(f.start_at), Date.parse(f.end_at), context.timeZone)}) fehlt oder wurde verändert.`,
          )
        : missingMessage("commitments"),
    );
  }
  if (context.fixed.some((f) => f.category !== "duty")) {
    const gaps = missingFixed("other");
    add(
      {
        key: "fixed",
        label: "Feste Verpflichtungen vollständig",
        ok: gaps.length === 0,
        hard: true,
      },
      gaps.map(
        (f) =>
          `${CATEGORY_LABELS[f.category]} am ${dayLabel(toLocalDate(new Date(f.start_at), context.timeZone))} (${formatLocalRange(Date.parse(f.start_at), Date.parse(f.end_at), context.timeZone)}) fehlt oder wurde verändert.`,
      ),
    );
  }

  for (const goal of PLANNER_SLOT_GOALS) {
    const key = `${goal}-slots` as const;
    const absent = missingMessage(key);
    const result = slotCheck(context, entries, goal);
    add(
      {
        key,
        label:
          goal === "sport" ? "Trainingstage erfüllt" : `${GOAL_LABELS.relationship}-Tage erfüllt`,
        ok: absent.length === 0 && result.ok,
        hard: true,
      },
      [...absent, ...result.problems],
    );
  }

  const minutes: Record<GoalKey, number> = {
    business: getPlannedMinutes(entries, "business"),
    sport: getPlannedMinutes(entries, "sport"),
    relationship: getPlannedMinutes(entries, "relationship"),
  };
  const target = context.settings.businessTargetMinutes;
  add({
    key: "business-planned",
    label: "Gewerbe geplant",
    ok: true,
    value: formatDuration(minutes.business),
    hard: false,
  });
  add({
    key: "business-minimum",
    label: `Gewerbe-Minimum erreicht (${formatDuration(target)})`,
    ok: target > 0 && minutes.business >= target,
    hard: true,
  });

  const duties = entries.filter((e) => e.category === "duty");
  const businessOnDuty = entries.filter(
    (e) =>
      e.category === "business" &&
      duties.some(
        (d) =>
          Date.parse(e.start_at) < Date.parse(d.end_at) &&
          Date.parse(d.start_at) < Date.parse(e.end_at),
      ),
  );
  add({
    key: "duty-not-business",
    label: "Dienstzeit nicht als Gewerbe gezählt",
    ok: businessOnDuty.length === 0,
    hard: true,
  });

  const overlapCount = detectOverlaps(entries).length;
  add({
    key: "overlaps",
    label: "Überschneidungen",
    ok: overlapCount === 0,
    value: String(overlapCount),
    hard: true,
  });

  // Weiche Regeln (Hinweise): Pausen, Gewerbe-Rahmen und Tageshöchstwerte.
  const preferences = context.preferences;
  if (preferences) {
    const sorted = [...entries].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const tightGaps = sorted.filter((entry, i) => {
      const next = sorted[i + 1];
      if (!next) return false;
      const gap = Date.parse(next.start_at) - Date.parse(entry.end_at);
      return gap >= 0 && gap < preferences.bufferMinutes * MINUTE_MS;
    }).length;
    add({
      key: "buffer",
      label: `Pausen von ${preferences.bufferMinutes} Min. zwischen Blöcken`,
      ok: tightGaps === 0,
      value: tightGaps === 0 ? undefined : `${tightGaps}× knapp`,
      hard: false,
    });
    const businessByDay = new Map<LocalDate, number>();
    let outsideWindow = 0;
    for (const e of entries.filter((x) => x.category === "business")) {
      const date = toLocalDate(new Date(e.start_at), context.timeZone);
      businessByDay.set(
        date,
        (businessByDay.get(date) ?? 0) +
          (Date.parse(e.end_at) - Date.parse(e.start_at)) / MINUTE_MS,
      );
      const start = toLocalTime(new Date(e.start_at), context.timeZone);
      const end = toLocalTime(new Date(e.end_at), context.timeZone);
      if (
        start < preferences.businessEarliestStart ||
        end > preferences.businessLatestEnd ||
        toLocalDate(new Date(e.end_at), context.timeZone) !== date
      ) {
        outsideWindow += 1;
      }
    }
    const overDaily = context.days.filter(
      (d) => (businessByDay.get(d.date) ?? 0) > d.businessMaxMinutes,
    ).length;
    add({
      key: "business-limits",
      label: "Gewerbe im Zeitrahmen und unter den Tageshöchstwerten",
      ok: outsideWindow === 0 && overDaily === 0,
      hard: false,
    });
  }

  if (entries.length === 0) openDecisions.push("Der Entwurf enthält keine Einträge.");
  const publishable = entries.length > 0 && checks.every((c) => !c.hard || c.ok);
  return { checks, minutes, overlapCount, openDecisions, publishable };
}

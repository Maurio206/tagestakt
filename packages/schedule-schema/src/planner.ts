/**
 * Wochenplanung – deterministischer Teil (ohne Netzwerk, ohne Sprachmodell).
 *
 * Ablauf: Aus den eigenen Einstellungen, Planungsregeln, aktiven Wiederholungen und der
 * Basisversion der Woche (Entwurf, sonst veröffentlichte Version) entsteht ein Planungskontext.
 * Fehlen Angaben, wird nicht geplant. Ein Planungsassistent (der Claude-Connector) erhält nur
 * bereinigte Zeiten (keine Titel, Notizen, Orte, Namen oder IDs) und schlägt flexible Blöcke vor
 * (Gewerbe, Training, Beziehungszeit, zusätzliche Termine). Wiederholungen übernimmt der Server
 * selbst; Abweichungen nur für diese Woche (anderes Ende, entfällt, Training ausgelassen,
 * niedrigeres Gewerbe-Minimum) muss der Vorschlag ausdrücklich mit Grund nennen – die
 * Wiederholungen und Regeln selbst bleiben unverändert. Jeder Vorschlag wird hier vollständig und
 * unabhängig geprüft.
 *
 * Laufende Woche: Alles, was vor `notBefore` begonnen hat, bleibt unverändert (inklusive
 * Erledigt-Status); laufende Wiederholungen lassen sich nur im Ende anpassen.
 * `evaluatePlanDraft` bewertet einen gespeicherten Entwurf (auch nach manuellen Änderungen),
 * listet Abweichungen von den Regeln auf und entscheidet, ob er veröffentlicht werden darf.
 *
 * Zeiten: Planungszeitzone Europe/Berlin inklusive Sommer-/Winterzeit; Prüfungen auf echten
 * Zeitpunkten (Millisekunden), Beschriftungen in Ortszeit.
 */
import { z } from "zod";

import {
  CATEGORY_LABELS,
  type CompletionStatus,
  type EntryCategory,
  type EntrySource,
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
 * Was ein Vorschlag enthalten darf: jede Art außer Dienst. Wiederholungen und Einzeltermine setzt
 * der Server (für eine Woche änderbar nur über `changes`). Gewerbe, Training und Beziehungszeit sind Planungsblöcke (Regeln,
 * Zeitfenster, Pausen); alle übrigen Arten sind freie Blöcke mit eigenem Titel (Termine und
 * Übergänge wie Fahrt, Körperpflege, Essen oder Schlaf).
 */
export const PLANNER_BLOCK_KINDS = [
  "business",
  "sport",
  "relationship",
  "appointment",
  "commute",
  "hygiene",
  "meal",
  "shopping",
  "leisure",
  "sleep",
  "other",
] as const;
export type PlannerBlockKind = (typeof PLANNER_BLOCK_KINDS)[number];

/** Planungsblöcke mit Regeln und Pausen; alle anderen Arten sind freie Blöcke. */
export const PLANNER_GOAL_BLOCK_KINDS = ["business", "sport", "relationship"] as const;
const GOAL_BLOCK_KINDS: ReadonlySet<string> = new Set(PLANNER_GOAL_BLOCK_KINDS);

/**
 * Freie Blöcke (Termin, Fahrt, Körperpflege, Essen, Einkaufen, Freizeit, Schlaf, Sonstiges):
 * eigener Titel, kein Zeitfenster, dürfen ohne Pause anschließen und über Mitternacht enden.
 */
export function isFreeBlockKind(category: EntryCategory): boolean {
  return category !== "duty" && !GOAL_BLOCK_KINDS.has(category);
}

export const PLANNER_MAX_BLOCKS = 60;
export const PLANNER_TITLE_MAX_LENGTH = 60;
export const PLANNER_REASON_MAX_LENGTH = 240;
export const PLANNER_TEXT_MAX_LENGTH = 300;
export const PLANNER_SUMMARY_MAX_LENGTH = 800;
export const PLANNER_MAX_LIST_ITEMS = 10;
/** Kürzester geplanter Block (Minuten). */
export const PLANNER_MIN_BLOCK_MINUTES = 15;
/** Planbar: die laufende Woche und so viele folgende. */
export const PLANNER_HORIZON_WEEKS = 4;
/** Höchstzahl der Abweichungen bzw. ausgelassenen Zeitfenster in einem Vorschlag. */
export const PLANNER_MAX_CHANGES = 40;
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

/** Eintrag der Basisversion einer Woche (Entwurf, sonst veröffentlichte Version). */
export interface PlannerBaseEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  location: string | null;
  note: string | null;
  source: EntrySource;
  completion_status: CompletionStatus;
}

export interface PlannerFixedEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  location: string | null;
  note: string | null;
  /** `recurring`: aus aktiven Wiederholungen; `manual`: Einzeltermin der Woche. */
  source: "recurring" | "manual";
  /**
   * Bezug für Abweichungen dieser Woche, z. B. „duty-2026-10-16-0700“ (Kategorie, Datum und
   * Uhrzeit laut Regel – keine ID, kein Titel) bzw. „manual-…“ für nicht begonnene Einzeltermine.
   * Sonst null.
   */
  ref: string | null;
}

/** Ein Vorkommen einer aktiven Wiederholung in der Woche (die Regel). */
export interface PlannerOccurrence extends PlannerFixedEntry {
  source: "recurring";
  ref: string;
}

/**
 * Geplanter Eintrag, der vor `notBefore` begonnen hat (laufende Woche). Er bleibt unverändert;
 * nur bei einem laufenden Eintrag (`ref`: Wiederholung oder geplanter Block) lässt sich das Ende ändern.
 */
export interface PlannerLockedEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  location: string | null;
  note: string | null;
  source: "recurring" | "agent";
  completion_status: CompletionStatus;
  ref: string | null;
}

export type RecurringDeviationKind = "adjusted" | "cancelled" | "extra";

/** Unterschied zwischen einer Version und den Wiederholungen (nur Zeiten, keine Titel). */
export interface RecurringDeviation {
  ref: string;
  kind: RecurringDeviationKind;
  category: EntryCategory;
  date: LocalDate;
  /** Laut Wiederholung; null bei `extra` (ohne passende Wiederholung). */
  rule: { start_at: string; end_at: string } | null;
  /** Stand in der Version; null bei `cancelled`. */
  actual: { start_at: string; end_at: string } | null;
  /** Liegt ab `notBefore`: ein neuer Vorschlag muss die Abweichung übernehmen oder zurücksetzen. */
  changeable: boolean;
}

export type SlotStatus = "open" | "done" | "missed";

export interface PlannerSlotInstance extends PlanningGoalSlot {
  /** Neutrale, nicht technische Kennung, z. B. „sport-2026-10-12“. */
  slotId: string;
  date: LocalDate;
  windowStartAt: number;
  windowEndAt: number;
  /**
   * `done`: an diesem Tag gibt es bereits einen begonnenen Block dieses Ziels; `missed`: das
   * Zeitfenster reicht ab `notBefore` nicht mehr für die Dauer; sonst `open`.
   */
  status: SlotStatus;
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
  /** Frühester Beginn neuer Blöcke (ms); davor bleibt alles unverändert. */
  notBefore: number;
  settings: PlannerSettings;
  preferences: PlanningPreferences | null;
  slots: PlannerSlotInstance[];
  /** Alle Vorkommen der aktiven Wiederholungen in dieser Woche – die Regel. */
  occurrences: PlannerOccurrence[];
  /** Ab `notBefore` geplante Wiederholungen (laut Regel) und alle Einzeltermine der Basisversion. */
  fixed: PlannerFixedEntry[];
  /** Vor `notBefore` begonnene geplante Einträge (aus der Basisversion bzw. den Wiederholungen). */
  locked: PlannerLockedEntry[];
  /** Wiederholungseinträge der Basisversion ab `notBefore` ohne passende Wiederholung. */
  extraRecurring: PlannerOccurrence[];
  /** Abweichungen der Basisversion von den Wiederholungen (leer ohne Basisversion). */
  baseDeviations: RecurringDeviation[];
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

const startOf = (entry: { start_at: string }) => Date.parse(entry.start_at);
const endOf = (entry: { end_at: string }) => Date.parse(entry.end_at);

function byTime<T extends { start_at: string; end_at: string; title: string }>(a: T, b: T): number {
  return startOf(a) - startOf(b) || endOf(a) - endOf(b) || a.title.localeCompare(b.title);
}

/** Lesbarer, stabiler Bezug: Kategorie, Datum und Uhrzeit (bei Gleichstand mit Zähler). */
function assignRefs<T extends { category: EntryCategory; start_at: string }>(
  items: readonly T[],
  prefix: string,
  timeZone: string,
): (T & { ref: string })[] {
  const used = new Set<string>();
  return items.map((item) => {
    const start = new Date(item.start_at);
    const base = `${prefix}${item.category}-${toLocalDate(start, timeZone)}-${toLocalTime(start, timeZone).replace(":", "")}`;
    let ref = base;
    for (let n = 2; used.has(ref); n += 1) ref = `${base}-${n}`;
    used.add(ref);
    return { ...item, ref };
  });
}

interface MatchableEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
}

export interface RecurringMatch<R> {
  pairs: { occurrence: PlannerOccurrence; row: R }[];
  cancelled: PlannerOccurrence[];
  /** Wiederholungseinträge ohne passende Wiederholung, mit eigenem Bezug („extra-…“). */
  extra: { row: R; ref: string }[];
}

/**
 * Ordnet Wiederholungseinträge einer Version den Vorkommen der Wiederholungen zu: je Kategorie
 * und Kalendertag zuerst exakt (Titel und Zeiten), dann gleicher Titel, dann beliebig – jeweils
 * mit dem nächstgelegenen Beginn. Deterministisch, damit Bezüge über Aufrufe hinweg gleich bleiben.
 */
export function matchRecurring<R extends MatchableEntry>(
  occurrences: readonly PlannerOccurrence[],
  rows: readonly R[],
  timeZone: string = SCHEDULE_TIMEZONE,
): RecurringMatch<R> {
  const groupKey = (entry: MatchableEntry) =>
    `${entry.category}|${toLocalDate(new Date(entry.start_at), timeZone)}`;
  const openRows = [...rows].sort(byTime);
  const pairs: RecurringMatch<R>["pairs"] = [];
  const cancelled: PlannerOccurrence[] = [];
  const passes: ((o: PlannerOccurrence, r: R) => boolean)[] = [
    (o, r) => o.title === r.title && startOf(o) === startOf(r) && endOf(o) === endOf(r),
    (o, r) => o.title === r.title,
    () => true,
  ];
  let remaining = [...occurrences].sort(byTime);
  for (const pass of passes) {
    const next: PlannerOccurrence[] = [];
    for (const occurrence of remaining) {
      let best = -1;
      openRows.forEach((row, index) => {
        if (groupKey(row) !== groupKey(occurrence) || !pass(occurrence, row)) return;
        const current = openRows[best];
        const distance = Math.abs(startOf(row) - startOf(occurrence));
        if (!current || distance < Math.abs(startOf(current) - startOf(occurrence))) best = index;
      });
      const [row] = best >= 0 ? openRows.splice(best, 1) : [];
      if (row) pairs.push({ occurrence, row });
      else next.push(occurrence);
    }
    remaining = next;
  }
  cancelled.push(...remaining);
  return {
    pairs: pairs.sort((a, b) => byTime(a.occurrence, b.occurrence)),
    cancelled,
    extra: assignRefs(
      openRows.map((row) => ({ row, category: row.category, start_at: row.start_at })),
      "extra-",
      timeZone,
    ).map(({ row, ref }) => ({ row, ref })),
  };
}

/** Abweichungen aus einer Zuordnung; „changeable“ betrifft alles, was ab `notBefore` liegt. */
export function recurringDeviations(
  match: RecurringMatch<MatchableEntry>,
  notBefore: number,
  timeZone: string = SCHEDULE_TIMEZONE,
): RecurringDeviation[] {
  const span = (entry: MatchableEntry) => ({ start_at: entry.start_at, end_at: entry.end_at });
  const date = (entry: MatchableEntry) => toLocalDate(new Date(entry.start_at), timeZone);
  const deviations: RecurringDeviation[] = [
    ...match.pairs
      .filter(
        ({ occurrence, row }) =>
          startOf(occurrence) !== startOf(row) || endOf(occurrence) !== endOf(row),
      )
      .map(({ occurrence, row }): RecurringDeviation => ({
        ref: occurrence.ref,
        kind: "adjusted",
        category: occurrence.category,
        date: date(occurrence),
        rule: span(occurrence),
        actual: span(row),
        changeable: startOf(row) >= notBefore,
      })),
    ...match.cancelled.map((occurrence): RecurringDeviation => ({
      ref: occurrence.ref,
      kind: "cancelled",
      category: occurrence.category,
      date: date(occurrence),
      rule: span(occurrence),
      actual: null,
      changeable: startOf(occurrence) >= notBefore,
    })),
    ...match.extra.map(({ row, ref }): RecurringDeviation => ({
      ref,
      kind: "extra",
      category: row.category,
      date: date(row),
      rule: null,
      actual: span(row),
      changeable: startOf(row) >= notBefore,
    })),
  ];
  return deviations.sort(
    (a, b) =>
      Date.parse((a.rule ?? a.actual)?.start_at ?? "") -
        Date.parse((b.rule ?? b.actual)?.start_at ?? "") || a.ref.localeCompare(b.ref),
  );
}

export function buildPlanningContext(input: {
  weekStart: LocalDate;
  now: Date;
  settings: PlannerSettings;
  preferences: PlanningPreferences | null;
  slots: readonly PlanningGoalSlot[];
  commitments: readonly RecurringTemplate[];
  /**
   * Einträge der Basisversion (Entwurf, sonst veröffentlichte Version); null, wenn es für die
   * Woche noch keine Version gibt. Begonnenes bleibt unverändert.
   */
  baseEntries?: readonly PlannerBaseEntry[] | null;
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

  const occurrences: PlannerOccurrence[] = assignRefs(
    expandRecurringCommitments(input.commitments, input.weekStart, timeZone)
      .map((entry) => ({ ...entry, ref: null }))
      .sort(byTime),
    "",
    timeZone,
  );
  const began = (entry: { start_at: string }) => startOf(entry) < notBefore;
  const running = (entry: { start_at: string; end_at: string }) =>
    began(entry) && endOf(entry) > notBefore;
  const base = input.baseEntries ?? null;

  let fixedRecurring: PlannerOccurrence[];
  let locked: PlannerLockedEntry[];
  let extraRecurring: PlannerOccurrence[] = [];
  let baseDeviations: RecurringDeviation[] = [];
  if (!base) {
    // Noch keine Version: Vergangenes stammt aus den Wiederholungen und wird so übernommen.
    fixedRecurring = occurrences.filter((o) => !began(o));
    locked = occurrences.filter(began).map((o) => ({
      title: o.title,
      category: o.category,
      start_at: o.start_at,
      end_at: o.end_at,
      location: o.location,
      note: o.note,
      source: "recurring",
      completion_status: "planned",
      ref: running(o) ? o.ref : null,
    }));
  } else {
    const match = matchRecurring(
      occurrences,
      base.filter((e) => e.source === "recurring"),
      timeZone,
    );
    // Laufende Einträge bekommen einen Bezug: Wiederholungen den ihres Vorkommens, geplante
    // Blöcke einen eigenen („block-…“) – bei beiden lässt sich nur noch das Ende ändern.
    const runningBlocks = base.filter((e) => e.source === "agent" && running(e)).sort(byTime);
    const refOfRow = new Map<PlannerBaseEntry, string>([
      ...match.pairs.map(({ occurrence, row }) => [row, occurrence.ref] as const),
      ...match.extra.map(({ row, ref }) => [row, ref] as const),
      ...assignRefs(
        runningBlocks.map((row) => ({ row, category: row.category, start_at: row.start_at })),
        "block-",
        timeZone,
      ).map(({ row, ref }) => [row, ref] as const),
    ]);
    const pairedRow = new Map(match.pairs.map(({ occurrence, row }) => [occurrence, row]));
    locked = base
      .filter((e) => e.source !== "manual" && began(e))
      .sort(byTime)
      .map((e) => ({
        title: e.title,
        category: e.category,
        start_at: e.start_at,
        end_at: e.end_at,
        location: e.location,
        note: e.note,
        source: e.source === "recurring" ? "recurring" : "agent",
        completion_status: e.completion_status,
        ref: running(e) ? (refOfRow.get(e) ?? null) : null,
      }));
    // Ein Vorkommen ist ab `notBefore` planbar, wenn sein Eintrag noch nicht begonnen hat bzw.
    // es (ohne Eintrag) erst ab `notBefore` beginnt.
    fixedRecurring = occurrences.filter((o) => {
      const row = pairedRow.get(o);
      return row ? !began(row) : !began(o);
    });
    extraRecurring = match.extra
      .filter(({ row }) => !began(row))
      .map(({ row, ref }) => ({
        title: row.title,
        category: row.category,
        start_at: row.start_at,
        end_at: row.end_at,
        location: row.location,
        note: row.note,
        source: "recurring",
        ref,
      }));
    baseDeviations = recurringDeviations(match, notBefore, timeZone);
  }

  // Einzeltermine ab `notBefore` bekommen einen Bezug („manual-…“) und lassen sich für diese
  // Woche verschieben oder streichen; begonnene bleiben unverändert.
  const manualRows = (base ?? []).filter((e) => e.source === "manual").sort(byTime);
  const manualRefs = new Map(
    assignRefs(
      manualRows
        .filter((row) => !began(row))
        .map((row) => ({ row, category: row.category, start_at: row.start_at })),
      "manual-",
      timeZone,
    ).map(({ row, ref }) => [row, ref] as const),
  );
  const manual = manualRows.map((entry): PlannerFixedEntry => ({
    title: entry.title,
    category: entry.category,
    start_at: entry.start_at,
    end_at: entry.end_at,
    location: entry.location,
    note: entry.note,
    source: "manual",
    ref: manualRefs.get(entry) ?? null,
  }));

  const slots = [...input.slots]
    .sort((a, b) => a.goal.localeCompare(b.goal) || a.weekday - b.weekday)
    .map((slot): PlannerSlotInstance => {
      const date = addDays(input.weekStart, slot.weekday - 1);
      const windowStartAt = zonedDateTimeToInstant(date, slot.windowStart, timeZone).getTime();
      const windowEndAt = zonedDateTimeToInstant(date, slot.windowEnd, timeZone).getTime();
      const done = locked.some(
        (e) => e.category === slot.goal && toLocalDate(new Date(e.start_at), timeZone) === date,
      );
      const missed =
        windowEndAt - Math.max(windowStartAt, notBefore) < slot.durationMinutes * MINUTE_MS;
      return {
        ...slot,
        slotId: `${slot.goal}-${date}`,
        date,
        windowStartAt,
        windowEndAt,
        status: done ? "done" : missed ? "missed" : "open",
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
    occurrences,
    fixed: [...fixedRecurring, ...manual].sort(byTime),
    locked,
    extraRecurring,
    baseDeviations,
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

/** Die kommenden Wochen (ohne die laufende). */
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
  if (!context.occurrences.some((o) => o.category === "duty")) {
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

/** Belegt: feste Termine ab `notBefore` und alles bereits Begonnene. */
function busyIntervals(context: PlanningContext): Interval[] {
  return [...context.fixed, ...context.locked].map((e) => ({ start: startOf(e), end: endOf(e) }));
}

/** Gewerbeminuten begonnener Einträge (ohne „ausgelassen“) je Tag. */
function lockedBusinessByDay(context: PlanningContext): Map<LocalDate, number> {
  return businessByDay(
    context.locked.filter((e) => e.completion_status !== "skipped"),
    context.timeZone,
  );
}

function sumValues(map: ReadonlyMap<unknown, number>): number {
  return [...map.values()].reduce((sum, value) => sum + value, 0);
}

/**
 * Konflikte, die eine Entscheidung des Benutzers brauchen: überschneidende feste
 * Verpflichtungen, nicht planbare verbindliche Blöcke, nicht erreichbares Gewerbe-Minimum.
 * Bereits Begonnenes zählt mit; vergangene oder schon erledigte Zeitfenster sind kein Konflikt.
 */
export function findPlanningConflicts(context: PlanningContext): string[] {
  const conflicts: string[] = [];
  const { timeZone } = context;
  for (const overlap of detectOverlaps(context.fixed)) {
    if (Math.min(endOf(overlap.first), endOf(overlap.second)) <= context.notBefore) continue;
    const start = Math.max(Date.parse(overlap.first.start_at), Date.parse(overlap.second.start_at));
    conflicts.push(
      `Feste Verpflichtungen überschneiden sich am ${dayLabel(toLocalDate(new Date(start), timeZone))} (${CATEGORY_LABELS[overlap.first.category]} und ${CATEGORY_LABELS[overlap.second.category]}).`,
    );
  }
  const preferences = context.preferences;
  if (!preferences) return conflicts;
  const buffer = preferences.bufferMinutes * MINUTE_MS;
  const busy = busyIntervals(context);

  for (const slot of context.slots) {
    if (slot.requirement !== "required" || slot.status !== "open") continue;
    const from = Math.max(slot.windowStartAt, context.notBefore);
    const fits = freeIntervals(from, slot.windowEndAt, busy, buffer).some(
      (f) => f.end - f.start >= slot.durationMinutes * MINUTE_MS,
    );
    if (!fits) {
      const label = slot.goal === "sport" ? "Training" : GOAL_LABELS.relationship;
      conflicts.push(
        `${label} am ${dayLabel(slot.date)}: Im Zeitfenster ${slot.windowStart}–${slot.windowEnd} ist kein freier Platz für ${formatDuration(slot.durationMinutes)} (inklusive ${preferences.bufferMinutes} Min. Pause).`,
      );
    }
  }

  const target = context.settings.businessTargetMinutes;
  if (target > 0) {
    const lockedByDay = lockedBusinessByDay(context);
    const alreadyPlanned = sumValues(lockedByDay);
    let capacity = 0;
    for (const day of context.days) {
      const dayMax = day.businessMaxMinutes - (lockedByDay.get(day.date) ?? 0);
      if (dayMax <= 0 || day.past) continue;
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
      capacity += Math.min(dayMax, Math.floor(usable));
    }
    if (alreadyPlanned + capacity < target) {
      conflicts.push(
        alreadyPlanned > 0
          ? `Gewerbe-Minimum nicht erreichbar: Bereits begonnen bzw. vergangen sind ${formatDuration(alreadyPlanned)}, frei sind mit den gespeicherten Regeln höchstens noch ${formatDuration(capacity)} (Wochenziel ${formatDuration(target)}).`
          : `Gewerbe-Minimum nicht erreichbar: Mit den gespeicherten Regeln sind höchstens ${formatDuration(capacity)} frei (Wochenziel ${formatDuration(target)}).`,
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
      error: "Erlaubt sind alle Arten außer duty (Dienst)",
    }),
    /**
     * sport/relationship: slotId aus dem Planungskontext für das Zeitfenster des Tages; ohne
     * slotId zusätzliche Zeit außerhalb des Zeitfensters. Sonst leer.
     */
    slotId: z.string().max(40).nullish(),
    date: localDateSchema,
    start: clockTimeSchema,
    /** Freie Blöcke: Ende vor oder auf dem Beginn = Ende am Folgetag (z. B. Schlaf). */
    end: clockTimeSchema,
    /** Für Gewerbe und freie Blöcke; Training und Beziehungszeit benennt der Server. */
    title: z.string().trim().min(1).max(PLANNER_TITLE_MAX_LENGTH).optional(),
    reason: z.string().trim().min(1).max(PLANNER_REASON_MAX_LENGTH).optional(),
  })
  .strict();
export type WeekPlanBlock = z.infer<typeof weekPlanBlockSchema>;

const refSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,60}$/, { error: "Bezug (ref) aus dem Planungskontext erwartet" });
const reasonSchema = z.string().trim().min(1).max(PLANNER_REASON_MAX_LENGTH);

/**
 * Änderung nur für diese Woche – an einer Wiederholung (die Wiederholung selbst bleibt
 * unverändert), einem Einzeltermin oder einem bereits laufenden Block: `adjust` – andere Zeiten am selben Tag
 * (Ende ≤ Beginn: Ende am Folgetag); bei einem laufenden Eintrag nur das Ende. `cancel` – entfällt
 * diese Woche. `regular` – ausdrücklich wie in der Wiederholung (setzt eine Abweichung zurück).
 */
export const entryChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("adjust"),
      ref: refSchema,
      start: clockTimeSchema,
      end: clockTimeSchema,
      reason: reasonSchema,
    })
    .strict(),
  z.object({ action: z.literal("cancel"), ref: refSchema, reason: reasonSchema }).strict(),
  z.object({ action: z.literal("regular"), ref: refSchema }).strict(),
]);
export type EntryChange = z.infer<typeof entryChangeSchema>;

export const weekPlanProposalSchema = z
  .object({
    weekStart: weekStartSchema,
    blocks: z.array(weekPlanBlockSchema).max(PLANNER_MAX_BLOCKS),
    /** Kurze Zusammenfassung der Wochenbesonderheiten (wird als Planungshinweis gespeichert). */
    summary: z.string().trim().min(1).max(PLANNER_SUMMARY_MAX_LENGTH).optional(),
    changes: z
      .array(entryChangeSchema)
      .max(PLANNER_MAX_CHANGES)
      .optional()
      .describe(
        "Änderungen nur für diese Woche an Wiederholungen, Einzelterminen bzw. laufenden Blöcken (ref aus dem Kontext), immer mit kurzem Grund",
      ),
    skippedSlots: z
      .array(z.object({ slotId: z.string().max(40), reason: reasonSchema }).strict())
      .max(PLANNER_MAX_CHANGES)
      .optional()
      .describe(
        "Verbindliche Zeitfenster, die diese Woche ausfallen bzw. anders liegen, immer mit Grund",
      ),
    businessMinimum: z
      .object({ minutes: z.number().int().min(0).max(10_080), reason: reasonSchema })
      .strict()
      .nullish()
      .describe("Niedrigeres Gewerbe-Minimum nur für diese Woche, immer mit Grund"),
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

export const CONNECTOR_SLOT_STATUS = {
  open: "offen",
  done: "bereits begonnen",
  missed: "vorbei",
} as const satisfies Record<SlotStatus, string>;

export interface ConnectorSlot {
  slotId: string;
  date: LocalDate;
  weekday: string;
  required: boolean;
  durationMinutes: number;
  windowStart: TimeOfDay;
  windowEnd: TimeOfDay;
  /** „bereits begonnen“ und „vorbei“: kein Block mehr möglich bzw. nötig. */
  status: (typeof CONNECTOR_SLOT_STATUS)[SlotStatus];
}

/** Lässt sich eine Wiederholung diese Woche ändern? „nur Ende“: läuft bereits. */
export type ConnectorChangeable = "ja" | "nur Ende" | "nein";

export interface ConnectorRecurring {
  /** Bezug für `changes`. */
  ref: string;
  kind: string;
  date: LocalDate;
  weekday: string;
  start: TimeOfDay;
  end: TimeOfDay;
  endsNextDay: boolean;
  changeable: ConnectorChangeable;
}

const DEVIATION_LABELS = {
  adjusted: "andere Zeit",
  cancelled: "entfällt",
  extra: "ohne passende Wiederholung",
} as const satisfies Record<RecurringDeviationKind, string>;

export interface ConnectorDeviation {
  ref: string;
  kind: string;
  deviation: (typeof DEVIATION_LABELS)[RecurringDeviationKind];
  date: LocalDate;
  weekday: string;
  rule: { start: TimeOfDay; end: TimeOfDay } | null;
  current: { start: TimeOfDay; end: TimeOfDay } | null;
  /**
   * true: ein neuer Vorschlag muss diese Abweichung übernehmen (adjust/cancel mit Grund) oder
   * mit `regular` zurücksetzen; sonst wird er abgelehnt.
   */
  mustAddress: boolean;
}

export interface ConnectorPlanningContext {
  week: { start: LocalDate; end: LocalDate; timezone: string; locale: string };
  /** Alle Angaben vorhanden – die Woche kann geplant und gespeichert werden. */
  saveAllowed: boolean;
  /** Neue Blöcke frühestens ab hier (laufende Woche); davor bleibt alles unverändert. Sonst null. */
  earliestStart: { date: LocalDate; time: TimeOfDay } | null;
  rules: {
    duty: ConnectorRecurring[];
    /** Weitere Wiederholungen (z. B. Fahrt) – ebenfalls mit Bezug für Abweichungen. */
    otherRecurring: ConnectorRecurring[];
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
  /** Bereits begonnene bzw. vergangene Gewerbeminuten dieser Woche (zählen zum Minimum). */
  alreadyBegun: { businessMinutes: number };
  /**
   * Belegung je Tag (Ortszeit; 24:00 = Tagesende) und Gewerbe-Höchstwert. `begun`: hat bereits
   * begonnen und bleibt unverändert; `ref`: Wiederholung, die sich diese Woche ändern lässt.
   */
  days: {
    date: LocalDate;
    weekday: string;
    busy: {
      start: string;
      end: string;
      kind: string;
      origin: NeutralBlock["origin"];
      ref: string | null;
      begun: boolean;
    }[];
    businessMaxMinutes: number;
    plannable: boolean;
  }[];
  /** Einzeltermine; mit `ref` lassen sie sich für diese Woche verschieben oder streichen. */
  oneOffAppointments: (NeutralBlock & { ref: string | null })[];
  /** Abweichungen des aktuellen Stands (Entwurf, sonst veröffentlichter Plan) von den Wiederholungen. */
  currentDeviations: ConnectorDeviation[];
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
    status: CONNECTOR_SLOT_STATUS[slot.status],
  };
}

function localSpan(span: { start_at: string; end_at: string }, timeZone: string) {
  return {
    start: toLocalTime(new Date(span.start_at), timeZone),
    end: toLocalTime(new Date(span.end_at), timeZone),
  };
}

/**
 * Nur, was für die Planung nötig ist: Zeiten, neutrale Arten, Regeln, neutrale Bezüge und ein
 * opaker Versionsbezug des Entwurfs. Keine Titel, Notizen, Orte, IDs, E-Mail-Adressen oder
 * Namen – Datenbanktexte erreichen Claude nie (auch nicht als mögliche Anweisungen).
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
  const plannedRefs = new Set(context.fixed.map((e) => e.ref));
  const runningRefs = new Set(context.locked.map((e) => e.ref));
  const recurring = (occurrence: PlannerOccurrence): ConnectorRecurring => {
    const date = toLocalDate(new Date(occurrence.start_at), timeZone);
    return {
      ref: occurrence.ref,
      kind: PLANNER_NEUTRAL_KIND_LABELS[occurrence.category],
      date,
      weekday: WEEKDAY_LABELS[isoWeekdayOfLocalDate(date)],
      ...localSpan(occurrence, timeZone),
      endsNextDay: toLocalDate(new Date(occurrence.end_at), timeZone) !== date,
      changeable: plannedRefs.has(occurrence.ref)
        ? "ja"
        : runningRefs.has(occurrence.ref)
          ? "nur Ende"
          : "nein",
    };
  };
  const busyEntries = [
    ...context.fixed.map((e) => ({ ...e, begun: false })),
    ...context.locked.map((e) => ({ ...e, begun: true })),
  ].sort(byTime);
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
      duty: context.occurrences.filter((o) => o.category === "duty").map(recurring),
      otherRecurring: context.occurrences.filter((o) => o.category !== "duty").map(recurring),
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
    alreadyBegun: { businessMinutes: sumValues(lockedBusinessByDay(context)) },
    days: context.days.map((day) => ({
      date: day.date,
      weekday: WEEKDAY_LABELS[day.weekday],
      busy: busyEntries
        .filter((e) => startOf(e) < day.end && endOf(e) > day.start)
        .map((e) => {
          const start = startOf(e);
          const end = endOf(e);
          return {
            start: start <= day.start ? "00:00" : toLocalTime(new Date(start), timeZone),
            end: end >= day.end ? "24:00" : toLocalTime(new Date(end), timeZone),
            kind: PLANNER_NEUTRAL_KIND_LABELS[e.category],
            origin: ORIGIN_LABELS[e.source],
            ref: e.ref,
            begun: e.begun,
          };
        }),
      businessMaxMinutes: day.businessMaxMinutes,
      plannable: !day.past,
    })),
    oneOffAppointments: context.fixed
      .filter((e) => e.source === "manual")
      .flatMap((e) => neutralBlocks([e], timeZone).map((block) => ({ ...block, ref: e.ref }))),
    currentDeviations: context.baseDeviations.map((d) => ({
      ref: d.ref,
      kind: PLANNER_NEUTRAL_KIND_LABELS[d.category],
      deviation: DEVIATION_LABELS[d.kind],
      date: d.date,
      weekday: WEEKDAY_LABELS[isoWeekdayOfLocalDate(d.date)],
      rule: d.rule ? localSpan(d.rule, timeZone) : null,
      current: d.actual ? localSpan(d.actual, timeZone) : null,
      mustAddress: d.changeable,
    })),
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

/** Ausdrücklich genannte Abweichungen eines Vorschlags – Gründe für die Prüfübersicht. */
export interface DeclaredExceptions {
  /** Bezug (ref) → Grund (adjust und cancel). */
  changes: Record<string, string>;
  /** slotId → Grund. */
  slots: Record<string, string>;
  businessMinimum: { minutes: number; reason: string } | null;
}

export interface MaterializedProposal {
  ok: true;
  /** Ab `notBefore`: Wiederholungen (mit Abweichungen dieser Woche) und vorgeschlagene Blöcke. */
  entries: PlannedEntry[];
  /** Einzeltermine – unverändert bzw. mit den Änderungen dieser Woche. */
  oneOffs: PlannerFixedEntry[];
  /** Geänderte bzw. gestrichene Einzeltermine als lesbare Zeilen (mit Grund). */
  oneOffChanges: string[];
  /** Bereits Begonnenes – unverändert; laufende Wiederholungen ggf. mit neuem Ende. */
  locked: PlannerLockedEntry[];
  exceptions: DeclaredExceptions;
}

function describeDeviation(deviation: RecurringDeviation, timeZone: string): string {
  const what = `${CATEGORY_LABELS[deviation.category]} am ${dayLabel(deviation.date)}`;
  const range = (span: { start_at: string; end_at: string }) =>
    formatLocalRange(startOf(span), endOf(span), timeZone);
  if (deviation.rule && deviation.actual) {
    return `${what}: ${range(deviation.actual)} statt ${range(deviation.rule)}`;
  }
  if (deviation.rule) return `${what} (${range(deviation.rule)}) entfällt`;
  return `${what} (${deviation.actual ? range(deviation.actual) : "?"}) ohne passende Wiederholung`;
}

function withReason(message: string, reason: string | null | undefined): string {
  return reason ? `${message} – Grund: ${reason}` : message;
}

function businessByDay(
  entries: readonly { category: EntryCategory; start_at: string; end_at: string }[],
  timeZone: string,
): Map<LocalDate, number> {
  const byDay = new Map<LocalDate, number>();
  for (const e of entries) {
    if (e.category !== "business") continue;
    const date = toLocalDate(new Date(e.start_at), timeZone);
    byDay.set(date, (byDay.get(date) ?? 0) + (endOf(e) - startOf(e)) / MINUTE_MS);
  }
  return byDay;
}

/**
 * Prüft einen Vorschlag deterministisch gegen Woche, Zeitlogik, Zeitfenster, Regeln, Pausen und
 * Überschneidungen (auch mit Einzelterminen und bereits Begonnenem). Abweichungen von den Regeln
 * sind nur ausdrücklich erlaubt: `changes`, `skippedSlots` und `businessMinimum`, jeweils
 * mit Grund. Weicht der aktuelle Stand bereits ab, muss der Vorschlag das übernehmen oder
 * ausdrücklich zurücksetzen – nichts geht still verloren. Nur ein fehlerfreier Vorschlag ergibt
 * Einträge; bei jedem Fehler `ok: false` – dann wird nichts gespeichert.
 */
export function materializeProposal(
  context: PlanningContext,
  proposal: WeekPlanProposal,
): MaterializedProposal | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const preferences = context.preferences;
  if (!preferences) return { ok: false, errors: ["Planungsregeln fehlen."] };
  const { timeZone, notBefore } = context;
  const weekDays = new Set(getWeekDays(context.weekStart));
  const buffer = preferences.bufferMinutes * MINUTE_MS;
  const exceptions: DeclaredExceptions = { changes: {}, slots: {}, businessMinimum: null };

  if (proposal.weekStart !== context.weekStart) {
    errors.push(`Der Vorschlag betrifft die falsche Woche (erwartet ${context.weekStart}).`);
  }

  // 1. Abweichungen von Wiederholungen – nur für diese Woche.
  const planned = new Map<string, PlannerFixedEntry>();
  for (const entry of [...context.fixed, ...context.extraRecurring]) {
    if (entry.ref !== null) planned.set(entry.ref, entry);
  }
  const extraRefs = new Set(context.extraRecurring.map((e) => e.ref));
  const running = new Map<string, PlannerLockedEntry>();
  for (const entry of context.locked) if (entry.ref !== null) running.set(entry.ref, entry);
  const occurrenceByRef = new Map(context.occurrences.map((o) => [o.ref, o]));
  const changed = new Set<string>();
  /** Neue Zeiten ab `notBefore` (null = entfällt). */
  const effective = new Map<string, { start: number; end: number } | null>();
  /** Neues Ende laufender Wiederholungen. */
  const runningEnd = new Map<string, number>();

  (proposal.changes ?? []).forEach((change, index) => {
    const where = `Änderung ${index + 1} (${change.ref})`;
    if (changed.has(change.ref)) {
      errors.push(`${where}: Bezug mehrfach genannt.`);
      return;
    }
    changed.add(change.ref);
    const target = planned.get(change.ref);
    const run = running.get(change.ref);
    const anchor = target ?? run;
    if (!anchor) {
      errors.push(
        occurrenceByRef.has(change.ref)
          ? `${where}: hat bereits begonnen bzw. liegt in der Vergangenheit und bleibt unverändert.`
          : `${where}: unbekannter Bezug – bitte den Planungskontext neu laden.`,
      );
      return;
    }
    if (change.action !== "regular") {
      exceptions.changes[change.ref] = cleanPlannerText(change.reason, PLANNER_REASON_MAX_LENGTH);
    }
    const date = toLocalDate(new Date(anchor.start_at), timeZone);
    if (change.action === "adjust") {
      const start = localInstant(date, change.start, timeZone);
      // Wie bei Wiederholungen: Ende vor oder auf dem Beginn endet am Folgetag.
      const endDate = change.end <= change.start ? addDays(date, 1) : date;
      const end = localInstant(endDate, change.end, timeZone);
      if (start === null || end === null) {
        errors.push(`${where}: Uhrzeit existiert an diesem Tag nicht (Zeitumstellung).`);
        return;
      }
      if ((end - start) / MINUTE_MS < PLANNER_MIN_BLOCK_MINUTES) {
        errors.push(`${where}: kürzer als ${PLANNER_MIN_BLOCK_MINUTES} Minuten.`);
        return;
      }
      if (end - start > 24 * 60 * MINUTE_MS) {
        errors.push(`${where}: länger als 24 Stunden.`);
        return;
      }
      if (run) {
        if (start !== startOf(run)) {
          errors.push(
            `${where}: läuft bereits seit ${toLocalTime(new Date(run.start_at), timeZone)} – nur das Ende lässt sich ändern.`,
          );
          return;
        }
        runningEnd.set(change.ref, end);
      } else {
        if (start < notBefore) {
          errors.push(`${where}: beginnt in der Vergangenheit.`);
          return;
        }
        effective.set(change.ref, { start, end });
      }
    } else if (change.action === "cancel") {
      if (run) {
        errors.push(
          `${where}: läuft bereits und kann nicht mehr entfallen – nur das Ende lässt sich ändern (adjust).`,
        );
        return;
      }
      effective.set(change.ref, null);
    } else {
      const occurrence = occurrenceByRef.get(change.ref);
      if (!occurrence || extraRefs.has(change.ref)) {
        errors.push(
          `${where}: gehört zu keiner Wiederholung – behalten mit adjust oder entfernen mit cancel.`,
        );
        return;
      }
      if (run) {
        if (startOf(run) !== startOf(occurrence)) {
          errors.push(
            `${where}: läuft bereits mit anderem Beginn – nur das Ende lässt sich ändern (adjust).`,
          );
          return;
        }
        runningEnd.set(change.ref, endOf(occurrence));
      } else {
        if (startOf(occurrence) < notBefore) {
          errors.push(
            `${where}: die Zeit laut Wiederholung liegt in der Vergangenheit – adjust oder cancel.`,
          );
          return;
        }
        effective.set(change.ref, { start: startOf(occurrence), end: endOf(occurrence) });
      }
    }
  });

  // Bestehende Abweichungen ab `notBefore` gehen nie still verloren.
  for (const deviation of context.baseDeviations) {
    if (!deviation.changeable || changed.has(deviation.ref)) continue;
    errors.push(
      `Abweichung im aktuellen Stand nicht berücksichtigt: ${describeDeviation(deviation, timeZone)} (${deviation.ref}). Übernehmen mit adjust bzw. cancel und Grund oder mit regular auf die Wiederholung zurücksetzen.`,
    );
  }

  const recurringEntries: PlannedEntry[] = [];
  // Begonnene Einzeltermine bleiben, die übrigen ggf. mit Änderung dieser Woche.
  const oneOffs = context.fixed.filter((e) => e.source === "manual" && e.ref === null);
  const oneOffChanges: string[] = [];
  for (const [ref, entry] of planned) {
    const times = effective.has(ref)
      ? effective.get(ref)
      : extraRefs.has(ref)
        ? null
        : { start: startOf(entry), end: endOf(entry) };
    if (entry.source === "manual") {
      const what = `${CATEGORY_LABELS[entry.category]} am ${dayLabel(toLocalDate(new Date(entry.start_at), timeZone))}`;
      const before = formatLocalRange(startOf(entry), endOf(entry), timeZone);
      const reason = exceptions.changes[ref];
      if (!times) {
        oneOffChanges.push(withReason(`${what} (${before}) entfällt`, reason));
        continue;
      }
      if (effective.has(ref)) {
        oneOffChanges.push(
          withReason(
            `${what}: ${formatLocalRange(times.start, times.end, timeZone)} statt ${before}`,
            reason,
          ),
        );
      }
      oneOffs.push({
        ...entry,
        start_at: new Date(times.start).toISOString(),
        end_at: new Date(times.end).toISOString(),
      });
      continue;
    }
    // Ohne Angabe gilt die Wiederholung; liegt sie vor `notBefore`, meldet das die Prüfung oben.
    if (!times || times.start < notBefore) continue;
    recurringEntries.push({
      title: entry.title,
      category: entry.category,
      start_at: new Date(times.start).toISOString(),
      end_at: new Date(times.end).toISOString(),
      location: entry.location,
      note: entry.note,
      source: "recurring",
    });
  }
  const locked = context.locked.map((entry) => {
    const end = entry.ref === null ? undefined : runningEnd.get(entry.ref);
    return end === undefined ? entry : { ...entry, end_at: new Date(end).toISOString() };
  });

  // 2. Ausgelassene Zeitfenster – nur ausdrücklich und mit Grund.
  const slotsById = new Map(context.slots.map((slot) => [slot.slotId, slot]));
  (proposal.skippedSlots ?? []).forEach((item, index) => {
    const where = `Ausgelassenes Zeitfenster ${index + 1} (${item.slotId})`;
    const slot = slotsById.get(item.slotId);
    if (!slot) errors.push(`${where}: unbekanntes Zeitfenster.`);
    else if (item.slotId in exceptions.slots) errors.push(`${where}: mehrfach genannt.`);
    else if (slot.status === "done") errors.push(`${where}: hat bereits begonnen.`);
    else exceptions.slots[item.slotId] = cleanPlannerText(item.reason, PLANNER_REASON_MAX_LENGTH);
  });

  // 3. Vorgeschlagene Blöcke.
  const usedSlots = new Set<string>();
  const checked: CheckedBlock[] = [];
  proposal.blocks.forEach((block, index) => {
    const where = `Block ${index + 1} (${weekDays.has(block.date) ? dayLabel(block.date) : block.date} ${block.start}–${block.end})`;
    if (!weekDays.has(block.date)) {
      errors.push(`${where}: liegt außerhalb der geplanten Woche.`);
      return;
    }
    const free = isFreeBlockKind(block.kind);
    // Freie Blöcke dürfen wie Wiederholungen über Mitternacht gehen (z. B. Schlaf).
    const overnight = free && block.end <= block.start;
    const start = localInstant(block.date, block.start, timeZone);
    const end = localInstant(overnight ? addDays(block.date, 1) : block.date, block.end, timeZone);
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
    if (minutes > 24 * 60) {
      errors.push(`${where}: länger als 24 Stunden.`);
      return;
    }
    if (start < notBefore) {
      errors.push(`${where}: beginnt in der Vergangenheit.`);
      return;
    }

    let title: string;
    let category: EntryCategory;
    if (block.kind !== "business" && block.kind !== "sport" && block.kind !== "relationship") {
      category = block.kind;
      if (block.slotId !== null && block.slotId !== undefined)
        errors.push(
          `${where}: ${PLANNER_NEUTRAL_KIND_LABELS[category]} gehört zu keinem Zeitfenster.`,
        );
      title =
        cleanPlannerText(block.title ?? "", PLANNER_TITLE_MAX_LENGTH) ||
        (category === "appointment" ? DEFAULT_APPOINTMENT_TITLE : CATEGORY_LABELS[category]);
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
    } else if (block.slotId === null || block.slotId === undefined) {
      // Zusätzliche Zeit für Training bzw. Beziehungszeit außerhalb eines Zeitfensters (z. B.
      // aufgeteilt oder an einem anderen Tag). Ersetzt kein verbindliches Zeitfenster.
      category = block.kind;
      const goal = block.kind;
      const sameGoal = context.slots.filter((s) => s.goal === goal);
      title =
        (sameGoal.find((s) => s.date === block.date) ?? sameGoal[0])?.title ??
        SLOT_GOAL_LABELS[goal];
    } else {
      category = block.kind;
      const slot = slotsById.get(block.slotId);
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
      if (slot.status === "done") {
        errors.push(`${where}: an diesem Tag hat bereits ein Block für ${slot.slotId} begonnen.`);
      }
      if (slot.slotId in exceptions.slots) {
        errors.push(`${where}: ${slot.slotId} ist zugleich als ausgelassen angegeben.`);
      }
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

  // Verbindliche Zeitfenster müssen belegt sein – außer bereits begonnen, vorbei oder
  // ausdrücklich ausgelassen.
  for (const slot of context.slots) {
    if (
      slot.requirement === "required" &&
      slot.status === "open" &&
      !usedSlots.has(slot.slotId) &&
      !(slot.slotId in exceptions.slots)
    ) {
      errors.push(`Verbindlicher Block fehlt: ${slot.slotId} (${dayLabel(slot.date)}).`);
    }
  }

  // Überschneidungen und Pausen: gegen Wiederholungen, Einzeltermine, Begonnenes und untereinander.
  // Pausen gelten nur für Gewerbe, Training und Beziehungszeit; freie Blöcke (Fahrt, Körperpflege,
  // Essen …) sind selbst Übergänge und dürfen direkt anschließen – überschneiden darf sich nichts.
  const busy = [...recurringEntries, ...oneOffs, ...locked].map((e) => ({
    start: startOf(e),
    end: endOf(e),
  }));
  const pauseOf = (block: CheckedBlock) => (isFreeBlockKind(block.kind) ? 0 : buffer);
  checked.forEach((block, i) => {
    for (const other of busy) {
      const gap = pauseOf(block);
      if (block.start < other.end + gap && other.start < block.end + gap) {
        errors.push(
          `Block ${block.index + 1}: überschneidet eine feste Verpflichtung (${formatLocalRange(other.start, other.end, timeZone)}) oder hält die Pause von ${preferences.bufferMinutes} Min. nicht ein.`,
        );
      }
    }
    for (const other of checked.slice(i + 1)) {
      const gap = Math.min(pauseOf(block), pauseOf(other));
      if (block.start < other.end + gap && other.start < block.end + gap) {
        errors.push(
          `Block ${block.index + 1} und Block ${other.index + 1}: überschneiden sich oder halten die Pause von ${preferences.bufferMinutes} Min. nicht ein.`,
        );
      }
    }
  });

  // Gewerbe je Tag und Woche – bereits Begonnenes (ohne „ausgelassen“) zählt mit.
  const begun = businessByDay(
    locked.filter((e) => e.completion_status !== "skipped"),
    timeZone,
  );
  const proposed = businessByDay(
    checked.map((b) => b.entry),
    timeZone,
  );
  for (const day of context.days) {
    const proposedOnDay = proposed.get(day.date) ?? 0;
    const minutes = proposedOnDay + (begun.get(day.date) ?? 0);
    if (proposedOnDay > 0 && minutes > day.businessMaxMinutes) {
      errors.push(
        day.businessMaxMinutes === 0
          ? `Am ${dayLabel(day.date)} ist kein Gewerbe vorgesehen.`
          : `Am ${dayLabel(day.date)} höchstens ${formatDuration(day.businessMaxMinutes)} Gewerbe (geplant ${formatDuration(minutes)}).`,
      );
    }
  }
  const begunTotal = sumValues(begun);
  const businessTotal = begunTotal + sumValues(proposed);
  const target = context.settings.businessTargetMinutes;
  let minimum = target;
  if (proposal.businessMinimum) {
    if (proposal.businessMinimum.minutes >= target) {
      errors.push(
        `businessMinimum senkt das Gewerbe-Minimum nur unter das Wochenziel (${formatDuration(target)}).`,
      );
    } else {
      minimum = proposal.businessMinimum.minutes;
      exceptions.businessMinimum = {
        minutes: minimum,
        reason: cleanPlannerText(proposal.businessMinimum.reason, PLANNER_REASON_MAX_LENGTH),
      };
    }
  }
  if (businessTotal < minimum) {
    errors.push(
      `Gewerbe-Minimum nicht erreicht: nur ${formatDuration(businessTotal)} geplant${begunTotal > 0 ? ` (davon bereits begonnen ${formatDuration(begunTotal)})` : ""} (${minimum === target ? "Wochenziel" : "für diese Woche angegeben"} ${formatDuration(minimum)}).`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  const entries = [...recurringEntries, ...checked.map((b) => b.entry)].sort(
    (a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b),
  );
  return {
    ok: true,
    entries,
    oneOffs: oneOffs.sort(byTime),
    oneOffChanges,
    locked,
    exceptions,
  };
}

// ---------------------------------------------------------------------------
// Bewertung eines gespeicherten Entwurfs (Prüfübersicht vor dem Veröffentlichen)
// ---------------------------------------------------------------------------

export interface EvaluatedEntry {
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  completion_status: CompletionStatus;
  /** Herkunft; nur Wiederholungseinträge werden mit den Wiederholungen verglichen. */
  source?: EntrySource;
}

export interface PlanCheck {
  key: string;
  label: string;
  ok: boolean;
  /** Anzeigewert, z. B. „20 Std.“ oder „0“. */
  value?: string;
  /** Muss für das Veröffentlichen erfüllt sein. */
  hard: boolean;
  /** Regel dieser Woche: nicht erfüllt = Abweichung (sichtbar, aber kein Hindernis). */
  deviation?: boolean;
}

export interface PlanEvaluation {
  checks: PlanCheck[];
  minutes: Record<GoalKey, number>;
  /** Überschneidungen, die ab `notBefore` noch bestehen. */
  overlapCount: number;
  /** Was vor dem Veröffentlichen entschieden bzw. behoben werden muss. */
  openDecisions: string[];
  /** Abweichungen von Wiederholungen und Regeln in dieser Woche (mit Grund, wenn bekannt). */
  deviations: string[];
  publishable: boolean;
}

function slotDeviations(
  context: PlanningContext,
  entries: readonly EvaluatedEntry[],
  goal: PlannerSlotGoal,
  skippedReasons: Readonly<Record<string, string>>,
): string[] {
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
    const reason = skippedReasons[slot.slotId];
    if (reason) {
      // Diese Woche ausdrücklich anders: eine Zeile mit Grund statt Einzelmeldungen.
      const minutes = onDay.reduce((sum, e) => sum + (endOf(e) - startOf(e)) / MINUTE_MS, 0);
      problems.push(
        withReason(
          onDay.length === 0
            ? `${label} am ${dayLabel(day.date)} ausgelassen`
            : `${label} am ${dayLabel(day.date)}: ${formatDuration(minutes)} in ${onDay.length} ${onDay.length === 1 ? "Block" : "Blöcken"} statt ${formatDuration(slot.durationMinutes)} zwischen ${slot.windowStart} und ${slot.windowEnd}`,
          reason,
        ),
      );
      continue;
    }
    if (onDay.length > 1) problems.push(`Mehr als ein Block „${label}“ am ${dayLabel(day.date)}.`);
    const fitting = onDay.filter(
      (e) =>
        startOf(e) >= slot.windowStartAt &&
        endOf(e) <= slot.windowEndAt &&
        (endOf(e) - startOf(e)) / MINUTE_MS === slot.durationMinutes,
    );
    if (slot.requirement === "required" && fitting.length === 0) {
      problems.push(
        `${label} am ${dayLabel(day.date)} fehlt (${formatDuration(slot.durationMinutes)} zwischen ${slot.windowStart} und ${slot.windowEnd}${slot.status === "missed" ? "; Zeitfenster vorbei" : ""}).`,
      );
    } else if (onDay.length > 0 && fitting.length === 0) {
      problems.push(`${label} am ${dayLabel(day.date)} passt nicht zu Zeitfenster und Dauer.`);
    }
  }
  return problems;
}

/**
 * Bewertet einen Entwurf. Pflicht (hart) sind vollständige Einstellungen, die Zeitzone, keine
 * Überschneidungen und kein Gewerbe im Dienst – soweit ab `notBefore` noch änderbar. Abweichungen
 * von Wiederholungen, Zeitfenstern und Gewerbe-Minimum werden gemeldet (mit Grund, wenn der
 * Vorschlag ihn nennt), verhindern das Veröffentlichen aber nicht: Neue Vorschläge dürfen nur
 * ausdrücklich abweichen, und veröffentlicht wird erst nach Bestätigung durch den Benutzer.
 */
export function evaluatePlanDraft(
  context: PlanningContext,
  entries: readonly EvaluatedEntry[],
  exceptions: DeclaredExceptions | null = null,
): PlanEvaluation {
  const { timeZone } = context;
  const checks: PlanCheck[] = [];
  const openDecisions: string[] = [];
  const deviations: string[] = [];
  const add = (check: PlanCheck, problems: readonly string[] = []) => {
    checks.push(check);
    if (check.ok) return;
    if (check.hard) openDecisions.push(...(problems.length > 0 ? problems : [check.label]));
    else if (check.deviation) deviations.push(...problems);
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

  // Wiederholungen: Abweichungen dieser Woche.
  const recurring = recurringDeviations(
    matchRecurring(
      context.occurrences,
      entries.filter((e) => e.source === "recurring"),
      timeZone,
    ),
    context.notBefore,
    timeZone,
  );
  const describe = (deviation: RecurringDeviation) =>
    withReason(describeDeviation(deviation, timeZone), exceptions?.changes[deviation.ref]);
  const dutyDeviations = recurring.filter((d) => d.category === "duty").map(describe);
  const otherDeviations = recurring.filter((d) => d.category !== "duty").map(describe);
  if (context.occurrences.some((o) => o.category === "duty")) {
    add(
      {
        key: "duty",
        label: "Dienst vollständig",
        ok: dutyDeviations.length === 0,
        hard: false,
        deviation: true,
      },
      dutyDeviations,
    );
  } else {
    add({ key: "duty", label: "Dienst vollständig", ok: false, hard: true }, [
      ...missingMessage("commitments"),
      ...dutyDeviations,
    ]);
  }
  if (context.occurrences.some((o) => o.category !== "duty") || otherDeviations.length > 0) {
    add(
      {
        key: "fixed",
        label: "Feste Verpflichtungen vollständig",
        ok: otherDeviations.length === 0,
        hard: false,
        deviation: true,
      },
      otherDeviations,
    );
  }

  for (const goal of PLANNER_SLOT_GOALS) {
    const key = `${goal}-slots` as const;
    const absent = missingMessage(key);
    const problems = slotDeviations(context, entries, goal, exceptions?.slots ?? {});
    add(
      {
        key,
        label:
          goal === "sport" ? "Trainingstage erfüllt" : `${GOAL_LABELS.relationship}-Tage erfüllt`,
        ok: absent.length === 0 && problems.length === 0,
        hard: absent.length > 0,
        deviation: absent.length === 0,
      },
      [...absent, ...problems],
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
  const lowered = exceptions?.businessMinimum;
  add(
    {
      key: "business-minimum",
      label: `Gewerbe-Minimum erreicht (${formatDuration(target)})`,
      ok: target > 0 && minutes.business >= target,
      hard: false,
      deviation: true,
    },
    [
      withReason(
        `Gewerbe ${formatDuration(minutes.business)} statt mindestens ${formatDuration(target)}`,
        lowered
          ? `${lowered.reason} (diese Woche mindestens ${formatDuration(lowered.minutes)})`
          : null,
      ),
    ],
  );

  // Pflicht nur, soweit ab `notBefore` noch etwas zu ändern ist (Vergangenes bleibt, wie es war).
  const stillOpen = (a: EvaluatedEntry, b: EvaluatedEntry) =>
    Math.min(endOf(a), endOf(b)) > context.notBefore;
  const duties = entries.filter((e) => e.category === "duty");
  const businessOnDuty = entries.filter(
    (e) =>
      e.category === "business" &&
      duties.some((d) => startOf(e) < endOf(d) && startOf(d) < endOf(e) && stillOpen(e, d)),
  );
  add({
    key: "duty-not-business",
    label: "Dienstzeit nicht als Gewerbe gezählt",
    ok: businessOnDuty.length === 0,
    hard: true,
  });

  const overlapCount = detectOverlaps(entries).filter((o) => stillOpen(o.first, o.second)).length;
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
    const sorted = [...entries].sort((a, b) => startOf(a) - startOf(b));
    // Wie beim Planen: freie Blöcke (Fahrt, Körperpflege, Essen …) brauchen keine Pause.
    const freeBlock = (e: EvaluatedEntry) => e.source === "agent" && isFreeBlockKind(e.category);
    const tightGaps = sorted.filter((entry, i) => {
      const next = sorted[i + 1];
      if (!next || freeBlock(entry) || freeBlock(next)) return false;
      const gap = startOf(next) - endOf(entry);
      return gap >= 0 && gap < preferences.bufferMinutes * MINUTE_MS;
    }).length;
    add({
      key: "buffer",
      label: `Pausen von ${preferences.bufferMinutes} Min. zwischen Blöcken`,
      ok: tightGaps === 0,
      value: tightGaps === 0 ? undefined : `${tightGaps}× knapp`,
      hard: false,
    });
    const business = entries.filter((x) => x.category === "business");
    const perDay = businessByDay(business, timeZone);
    const outsideWindow = business.filter((e) => {
      const date = toLocalDate(new Date(e.start_at), timeZone);
      const start = toLocalTime(new Date(e.start_at), timeZone);
      const end = toLocalTime(new Date(e.end_at), timeZone);
      return (
        start < preferences.businessEarliestStart ||
        end > preferences.businessLatestEnd ||
        toLocalDate(new Date(e.end_at), timeZone) !== date
      );
    }).length;
    const overDaily = context.days.filter(
      (d) => (perDay.get(d.date) ?? 0) > d.businessMaxMinutes,
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
  return { checks, minutes, overlapCount, openDecisions, deviations, publishable };
}

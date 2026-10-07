/**
 * Zod-Schemas für Datenbankzeilen (Lesen) und Formulareingaben (Schreiben).
 * Web, Mobile und der spätere Agent-Endpunkt validieren mit denselben Schemas.
 */
import { z } from "zod";

import {
  COMPLETION_STATUSES,
  ENTRY_CATEGORIES,
  ENTRY_SOURCES,
  GOAL_KEYS,
  type IsoWeekday,
  LOCATION_MAX_LENGTH,
  MAX_ACTIVITY_DURATION_MINUTES,
  MAX_ENTRY_DURATION_MINUTES,
  MAX_REMINDER_MINUTES_BEFORE,
  MAX_WEEKLY_GOAL_MINUTES,
  NOTE_MAX_LENGTH,
  PLANNING_NOTE_MAX_LENGTH,
  REMINDER_SCOPES,
  SCHEDULE_TIMEZONE,
  TITLE_MAX_LENGTH,
} from "./constants";
import { resolveTimeRange } from "./schedule";
import { isMonday, isValidLocalDate, normalizeTimeOfDay, zonedDateTimeToInstant } from "./time";

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

export const idSchema = z.guid({ error: "Ungültige ID" });

export const localDateSchema = z
  .string({ error: "Bitte ein Datum angeben" })
  .refine(isValidLocalDate, { error: "Ungültiges Datum (erwartet JJJJ-MM-TT)" });

export const weekStartSchema = localDateSchema.refine(isMonday, {
  error: "Der Wochenbeginn muss ein Montag sein",
});

export const timeOfDaySchema = z
  .string({ error: "Bitte eine Uhrzeit angeben" })
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, { error: "Ungültige Uhrzeit (erwartet HH:MM)" })
  .transform(normalizeTimeOfDay);

export const timestampSchema = z.iso.datetime({ offset: true, error: "Ungültiger Zeitstempel" });

export const entryCategorySchema = z.enum(ENTRY_CATEGORIES, {
  error: "Bitte eine gültige Kategorie wählen",
});
export const weekStatusSchema = z.enum(["draft", "published", "archived"]);
export const entrySourceSchema = z.enum(ENTRY_SOURCES);
export const completionStatusSchema = z.enum(COMPLETION_STATUSES, {
  error: "Ungültiger Status",
});
export const goalKeySchema = z.enum(GOAL_KEYS, { error: "Bitte ein Ziel wählen" });
export const reminderScopeSchema = z.enum(REMINDER_SCOPES, {
  error: "Bitte einen Umfang wählen",
});
export const isoWeekdaySchema = z.coerce
  .number({ error: "Bitte einen Wochentag wählen" })
  .int({ error: "Bitte einen Wochentag wählen" })
  .min(1, { error: "Bitte einen Wochentag wählen" })
  .max(7, { error: "Bitte einen Wochentag wählen" })
  .transform((v) => v as IsoWeekday);

const requiredTitle = z
  .string({ error: "Bitte einen Titel angeben" })
  .trim()
  .min(1, { error: "Bitte einen Titel angeben" })
  .max(TITLE_MAX_LENGTH, { error: `Der Titel darf höchstens ${TITLE_MAX_LENGTH} Zeichen haben` });

/** Optionaler Freitext: leere Eingaben werden zu `null`. */
function optionalText(maxLength: number, label: string) {
  return z
    .string()
    .trim()
    .max(maxLength, { error: `${label} darf höchstens ${maxLength} Zeichen haben` })
    .nullish()
    .transform((value) => (value ? value : null));
}

// ---------------------------------------------------------------------------
// Datenbankzeilen
// ---------------------------------------------------------------------------

export const userSettingsRowSchema = z.object({
  owner_id: idSchema,
  timezone: z.string().min(1),
  locale: z.string().min(2),
  weekly_business_target_minutes: z.number().int().min(0),
  weekly_sport_target_minutes: z.number().int().positive().nullable(),
  weekly_relationship_target_minutes: z.number().int().positive().nullable(),
  reminder_minutes_before: z.number().int().positive().nullable(),
  remind_at_start: z.boolean(),
  remind_if_not_started: z.boolean(),
  reminder_scope: reminderScopeSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type UserSettings = z.infer<typeof userSettingsRowSchema>;

export const recurringCommitmentRowSchema = z.object({
  id: idSchema,
  owner_id: idSchema,
  title: z.string(),
  category: entryCategorySchema,
  weekday: isoWeekdaySchema,
  start_time: timeOfDaySchema,
  end_time: timeOfDaySchema,
  location: z.string().nullable(),
  note: z.string().nullable(),
  active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type RecurringCommitment = z.infer<typeof recurringCommitmentRowSchema>;

export const scheduleWeekRowSchema = z.object({
  id: idSchema,
  owner_id: idSchema,
  week_start: weekStartSchema,
  version: z.number().int().positive(),
  status: weekStatusSchema,
  planning_note: z.string().nullable(),
  published_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type ScheduleWeek = z.infer<typeof scheduleWeekRowSchema>;

export const scheduleEntryRowSchema = z.object({
  id: idSchema,
  owner_id: idSchema,
  schedule_week_id: idSchema,
  title: z.string(),
  category: entryCategorySchema,
  start_at: timestampSchema,
  end_at: timestampSchema,
  location: z.string().nullable(),
  note: z.string().nullable(),
  source: entrySourceSchema,
  completion_status: completionStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type ScheduleEntry = z.infer<typeof scheduleEntryRowSchema>;

/** Woche inklusive Einträgen – gemeinsamer Wochenplan-Typ für Web und Mobile. */
export const scheduleWeekWithEntriesSchema = scheduleWeekRowSchema.extend({
  schedule_entries: z.array(scheduleEntryRowSchema),
});
export type ScheduleWeekWithEntries = z.infer<typeof scheduleWeekWithEntriesSchema>;

export const publishedWeekSchema = scheduleWeekWithEntriesSchema.extend({
  status: z.literal("published"),
});
export type PublishedWeek = z.infer<typeof publishedWeekSchema>;

export const activitySessionRowSchema = z.object({
  id: idSchema,
  owner_id: idSchema,
  schedule_entry_id: idSchema.nullable(),
  goal_category: goalKeySchema,
  title: z.string(),
  started_at: timestampSchema,
  ended_at: timestampSchema.nullable(),
  corrected_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type ActivitySession = z.infer<typeof activitySessionRowSchema>;

const goalTargetSchema = z.number().int().positive().nullable();

export const goalTargetsSchema = z.object({
  business: goalTargetSchema,
  sport: goalTargetSchema,
  relationship: goalTargetSchema,
});

export const reminderSettingsSchema = z.object({
  minutesBefore: z.number().int().positive().nullable(),
  atStart: z.boolean(),
  ifNotStarted: z.boolean(),
  scope: reminderScopeSchema,
});
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;

/**
 * Lokal zwischengespeicherter Stand der App. Enthält ausschließlich veröffentlichte
 * Planversionen, Ziele, Erinnerungseinstellungen und die erfassten Aktivitäten der
 * geladenen Wochen – niemals Tokens. Version 2 ersetzt Version 1 (alter Cache wird verworfen).
 */
export const planSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  fetchedAt: timestampSchema,
  weeks: z.array(publishedWeekSchema),
  goalTargets: goalTargetsSchema,
  reminderSettings: reminderSettingsSchema,
  sessions: z.array(activitySessionRowSchema),
  timezone: z.string().min(1),
});
export type PlanSnapshot = z.infer<typeof planSnapshotSchema>;

// ---------------------------------------------------------------------------
// Eingaben
// ---------------------------------------------------------------------------

const entryFieldsSchema = z.object({
  title: requiredTitle,
  category: entryCategorySchema,
  date: localDateSchema,
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  /** Endet am Folgetag (z. B. Schlaf 22:30–06:30). */
  endsNextDay: z.boolean().default(false),
  location: optionalText(LOCATION_MAX_LENGTH, "Der Ort"),
  note: optionalText(NOTE_MAX_LENGTH, "Die Notiz"),
});

type EntryTimeFields = Pick<
  z.output<typeof entryFieldsSchema>,
  "date" | "startTime" | "endTime" | "endsNextDay"
>;

function refineEntryTimes(value: EntryTimeFields, ctx: z.RefinementCtx): void {
  let start: Date;
  let end: Date;
  try {
    ({ start, end } = resolveTimeRange(
      value.date,
      value.startTime,
      value.endTime,
      value.endsNextDay,
      SCHEDULE_TIMEZONE,
    ));
  } catch {
    // Fehler in Einzelfeldern wurden bereits gemeldet.
    return;
  }
  if (end.getTime() <= start.getTime()) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: value.endsNextDay
        ? "Die Endzeit muss nach der Startzeit liegen"
        : "Die Endzeit muss nach der Startzeit liegen – oder „endet am Folgetag“ wählen",
    });
  } else if (end.getTime() - start.getTime() > MAX_ENTRY_DURATION_MINUTES * 60_000) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "Ein Eintrag darf höchstens 24 Stunden dauern",
    });
  }
}

export const scheduleEntryInputSchema = entryFieldsSchema.superRefine(refineEntryTimes);
export type ScheduleEntryInput = z.input<typeof scheduleEntryInputSchema>;
export type ScheduleEntryInputParsed = z.output<typeof scheduleEntryInputSchema>;

/** Wandelt eine geprüfte Eingabe in die Spalten von `schedule_entries` um. */
export function toEntryColumns(input: ScheduleEntryInputParsed) {
  const { start, end } = resolveTimeRange(
    input.date,
    input.startTime,
    input.endTime,
    input.endsNextDay,
    SCHEDULE_TIMEZONE,
  );
  return {
    title: input.title,
    category: input.category,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    location: input.location,
    note: input.note,
  };
}

export const completionUpdateSchema = z.object({
  entryId: idSchema,
  completionStatus: completionStatusSchema,
});

export const recurringCommitmentInputSchema = z
  .object({
    title: requiredTitle,
    category: entryCategorySchema,
    weekday: isoWeekdaySchema,
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    location: optionalText(LOCATION_MAX_LENGTH, "Der Ort"),
    note: optionalText(NOTE_MAX_LENGTH, "Die Notiz"),
    active: z.boolean().default(true),
  })
  .refine((v) => v.startTime !== v.endTime, {
    path: ["endTime"],
    error: "Start- und Endzeit dürfen nicht gleich sein",
  });
export type RecurringCommitmentInput = z.input<typeof recurringCommitmentInputSchema>;
export type RecurringCommitmentInputParsed = z.output<typeof recurringCommitmentInputSchema>;

/** Neue Wiederholung für mehrere Wochentage auf einmal (z. B. „Werktage“ Mo–Fr). */
export const recurringCommitmentBatchInputSchema = z
  .object({
    title: requiredTitle,
    category: entryCategorySchema,
    weekdays: z
      .array(isoWeekdaySchema, { error: "Bitte mindestens einen Wochentag wählen" })
      .min(1, { error: "Bitte mindestens einen Wochentag wählen" })
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    location: optionalText(LOCATION_MAX_LENGTH, "Der Ort"),
    note: optionalText(NOTE_MAX_LENGTH, "Die Notiz"),
    active: z.boolean().default(true),
  })
  .refine((v) => v.startTime !== v.endTime, {
    path: ["endTime"],
    error: "Start- und Endzeit dürfen nicht gleich sein",
  });
export type RecurringCommitmentBatchInput = z.input<typeof recurringCommitmentBatchInputSchema>;

/** Zerlegt eine Mehrfach-Eingabe in einzelne Wiederholungen (eine je Wochentag). */
export function splitRecurringBatch(
  input: z.output<typeof recurringCommitmentBatchInputSchema>,
): RecurringCommitmentInputParsed[] {
  const { weekdays, ...rest } = input;
  return weekdays.map((weekday) => ({ ...rest, weekday }));
}

// ---------------------------------------------------------------------------
// Wochenziele und Erinnerungen
// ---------------------------------------------------------------------------

/**
 * Stundenangabe aus einem Formularfeld: „20“, „2,5“, „2.5“ oder „1:30“.
 * Leer → `null` (kein Ziel). Ungültig → `Number.NaN`.
 */
export function parseHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(trimmed);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed.replace(",", ".")) * 60);
}

const weeklyMinutesSchema = z
  .number({ error: "Bitte eine Zahl angeben" })
  .int({ error: "Bitte ganze Minuten angeben" })
  .min(0, { error: "Das Wochenziel darf nicht negativ sein" })
  .max(MAX_WEEKLY_GOAL_MINUTES, { error: "Ein Wochenziel darf höchstens 168 Stunden betragen" });

/** Optionales Ziel: `null` oder 0 = kein Ziel (wird als `null` gespeichert). */
const optionalWeeklyMinutesSchema = weeklyMinutesSchema
  .nullable()
  .transform((value) => (value === null || value === 0 ? null : value));

export const goalSettingsInputSchema = z.object({
  /** Gewerbe: 0 = kein Ziel (Spalte ist NOT NULL, Standard 20 h). */
  weeklyBusinessTargetMinutes: weeklyMinutesSchema,
  weeklySportTargetMinutes: optionalWeeklyMinutesSchema,
  weeklyRelationshipTargetMinutes: optionalWeeklyMinutesSchema,
});
export type GoalSettingsInput = z.input<typeof goalSettingsInputSchema>;
export type GoalSettingsInputParsed = z.output<typeof goalSettingsInputSchema>;

export const reminderSettingsInputSchema = z.object({
  reminderMinutesBefore: z
    .number({ error: "Bitte einen Vorlauf wählen" })
    .int({ error: "Bitte ganze Minuten angeben" })
    .min(1, { error: "Der Vorlauf muss mindestens 1 Minute betragen" })
    .max(MAX_REMINDER_MINUTES_BEFORE, {
      error: `Der Vorlauf darf höchstens ${MAX_REMINDER_MINUTES_BEFORE} Minuten betragen`,
    })
    .nullable(),
  remindAtStart: z.boolean(),
  remindIfNotStarted: z.boolean(),
  reminderScope: reminderScopeSchema,
});
export type ReminderSettingsInput = z.infer<typeof reminderSettingsInputSchema>;

// ---------------------------------------------------------------------------
// Aktivitäten (Fokus-Erfassung)
// ---------------------------------------------------------------------------

/** Toleranz für abweichende Geräteuhren (wie in der Datenbank). */
const CLOCK_TOLERANCE_MS = 60_000;

export const activityStartInputSchema = z.object({
  goal: goalKeySchema,
  title: optionalText(TITLE_MAX_LENGTH, "Der Titel"),
  scheduleEntryId: idSchema.nullish().transform((value) => value ?? null),
});
export type ActivityStartInput = z.input<typeof activityStartInputSchema>;

/**
 * Prüft Beginn/Ende einer Aktivität wie die Datenbank: Ende nach Beginn, höchstens
 * 24 Stunden, nichts in der Zukunft. Gibt eine Fehlermeldung oder `null` zurück.
 */
export function validateActivityTimes(
  start: Date,
  end: Date | null,
  now: Date = new Date(),
): { path: "start" | "end"; message: string } | null {
  const limit = now.getTime() + CLOCK_TOLERANCE_MS;
  if (start.getTime() > limit) {
    return { path: "start", message: "Der Beginn darf nicht in der Zukunft liegen" };
  }
  if (end === null) {
    if (now.getTime() - start.getTime() > MAX_ACTIVITY_DURATION_MINUTES * 60_000) {
      return {
        path: "start",
        message: "Eine laufende Aktivität darf höchstens 24 Stunden zurückliegen",
      };
    }
    return null;
  }
  if (end.getTime() <= start.getTime()) {
    return { path: "end", message: "Das Ende muss nach dem Beginn liegen" };
  }
  if (end.getTime() - start.getTime() > MAX_ACTIVITY_DURATION_MINUTES * 60_000) {
    return { path: "end", message: "Eine Aktivität darf höchstens 24 Stunden dauern" };
  }
  if (end.getTime() > limit) {
    return { path: "end", message: "Das Ende darf nicht in der Zukunft liegen" };
  }
  return null;
}

const activityLocalTimesSchema = z.object({
  date: localDateSchema,
  startTime: timeOfDaySchema,
  /** Leer bzw. `null` = Aktivität läuft weiter (nur beim Korrigieren erlaubt). */
  endTime: timeOfDaySchema.nullish().transform((value) => value ?? null),
  endsNextDay: z.boolean().default(false),
});

/** Wandelt Datum + Uhrzeiten (Planungszeitzone) in Zeitpunkte um. */
export function resolveActivityTimes(input: {
  date: string;
  startTime: string;
  endTime: string | null;
  endsNextDay: boolean;
}): { start: Date; end: Date | null } {
  if (input.endTime === null) {
    return {
      start: zonedDateTimeToInstant(input.date, input.startTime, SCHEDULE_TIMEZONE),
      end: null,
    };
  }
  return resolveTimeRange(
    input.date,
    input.startTime,
    input.endTime,
    input.endsNextDay,
    SCHEDULE_TIMEZONE,
  );
}

function refineActivityTimes(
  value: z.output<typeof activityLocalTimesSchema>,
  ctx: z.RefinementCtx,
): void {
  let times: { start: Date; end: Date | null };
  try {
    times = resolveActivityTimes(value);
  } catch {
    return;
  }
  const issue = validateActivityTimes(times.start, times.end);
  if (issue) {
    ctx.addIssue({
      code: "custom",
      path: [issue.path === "start" ? "startTime" : "endTime"],
      message: issue.message,
    });
  }
}

/** „Zeit korrigieren“ (Formular in Ortszeit). */
export const activityCorrectionInputSchema = activityLocalTimesSchema
  .extend({ sessionId: idSchema })
  .superRefine(refineActivityTimes);
export type ActivityCorrectionInput = z.input<typeof activityCorrectionInputSchema>;

/** „Zeit nachtragen“: abgeschlossene Aktivität ohne Timer. */
export const activityManualInputSchema = activityLocalTimesSchema
  .extend({
    goal: goalKeySchema,
    title: requiredTitle,
    endTime: timeOfDaySchema,
  })
  .superRefine(refineActivityTimes);
export type ActivityManualInput = z.input<typeof activityManualInputSchema>;

/** „Zeit korrigieren“ mit Zeitstempeln (App: Schrittknöpfe statt Uhrzeitfelder). */
export const activityCorrectionTimestampsSchema = z
  .object({
    sessionId: idSchema,
    startedAt: timestampSchema,
    endedAt: timestampSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    const issue = validateActivityTimes(
      new Date(value.startedAt),
      value.endedAt === null ? null : new Date(value.endedAt),
    );
    if (issue) {
      ctx.addIssue({
        code: "custom",
        path: [issue.path === "start" ? "startedAt" : "endedAt"],
        message: issue.message,
      });
    }
  });
export type ActivityCorrectionTimestamps = z.infer<typeof activityCorrectionTimestampsSchema>;

export const planningNoteSchema = optionalText(PLANNING_NOTE_MAX_LENGTH, "Der Planungshinweis");

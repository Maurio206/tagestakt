/**
 * Zod-Schemas für Datenbankzeilen (Lesen) und Formulareingaben (Schreiben).
 * Web, Mobile und der spätere Agent-Endpunkt validieren mit denselben Schemas.
 */
import { z } from "zod";

import {
  COMPLETION_STATUSES,
  ENTRY_CATEGORIES,
  ENTRY_SOURCES,
  type IsoWeekday,
  LOCATION_MAX_LENGTH,
  MAX_ENTRY_DURATION_MINUTES,
  MAX_WEEKLY_BUSINESS_TARGET_MINUTES,
  NOTE_MAX_LENGTH,
  PLANNING_NOTE_MAX_LENGTH,
  SCHEDULE_TIMEZONE,
  TITLE_MAX_LENGTH,
} from "./constants";
import { resolveTimeRange } from "./schedule";
import { isMonday, isValidLocalDate, normalizeTimeOfDay } from "./time";

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

/**
 * Lokal zwischengespeicherter Stand der App. Enthält ausschließlich veröffentlichte
 * Planversionen und das Wochenziel – niemals Tokens.
 */
export const planSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  fetchedAt: timestampSchema,
  weeks: z.array(publishedWeekSchema),
  weeklyBusinessTargetMinutes: z.number().int().min(0),
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

export const userSettingsInputSchema = z.object({
  weeklyBusinessTargetMinutes: z
    .number({ error: "Bitte eine Zahl angeben" })
    .int({ error: "Bitte ganze Minuten angeben" })
    .min(0, { error: "Das Wochenziel darf nicht negativ sein" })
    .max(MAX_WEEKLY_BUSINESS_TARGET_MINUTES, {
      error: "Das Wochenziel darf höchstens 168 Stunden betragen",
    }),
});
export type UserSettingsInput = z.infer<typeof userSettingsInputSchema>;

export const planningNoteSchema = optionalText(PLANNING_NOTE_MAX_LENGTH, "Der Planungshinweis");

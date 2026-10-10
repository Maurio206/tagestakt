import "server-only";

import {
  DEFAULT_LOCALE,
  DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
  type LocalDate,
  type PlannedEntry,
  type PlanningContext,
  SCHEDULE_TIMEZONE,
  type ScheduleEntry,
  type ScheduleWeek,
  buildPlanningContext,
  manualOneOffs,
  planningGoalSlotRowSchema,
  planningPreferencesRowSchema,
  preferencesFromRow,
  recurringCommitmentRowSchema,
  scheduleEntryRowSchema,
  scheduleWeekRowSchema,
  slotFromRow,
  userSettingsRowSchema,
} from "@tagestakt/schedule-schema";
import { z } from "zod";

import { type Tx } from "./db";

/**
 * Planungsdaten für den Connector – immer innerhalb von `asOwner` (Rolle authenticated, RLS).
 * JSON-Ausgabe der Datenbank in derselben Form wie über PostgREST; geprüft mit denselben
 * Zeilenschemas wie in der Website.
 */

export interface WeekVersion {
  week: ScheduleWeek;
  entries: ScheduleEntry[];
}

export interface WeekState {
  context: PlanningContext;
  locale: string;
  draft: (WeekVersion & { fingerprint: string }) | null;
  published: WeekVersion | null;
}

const weeksSchema = z.array(scheduleWeekRowSchema);
const entriesSchema = z.array(scheduleEntryRowSchema);

async function loadEntries(tx: Tx, weekId: string): Promise<ScheduleEntry[]> {
  const [row] = await tx<{ data: unknown }[]>`
    select coalesce(json_agg(e order by e.start_at, e.end_at, e.id), '[]'::json) as data
      from public.schedule_entries e
     where e.schedule_week_id = ${weekId}::uuid`;
  return entriesSchema.parse(row?.data ?? []);
}

export async function weekFingerprint(tx: Tx, weekId: string): Promise<string> {
  const [row] = await tx<{ fingerprint: string }[]>`
    select public.schedule_week_fingerprint(${weekId}::uuid) as fingerprint`;
  if (!row) throw new Error("fingerprint_missing");
  return row.fingerprint;
}

/** Regeln, Wiederholungen, Entwurf und veröffentlichte Version einer Woche. */
export async function loadWeekState(tx: Tx, weekStart: LocalDate, now: Date): Promise<WeekState> {
  const [row] = await tx<
    {
      settings: unknown;
      preferences: unknown;
      slots: unknown;
      recurring: unknown;
      weeks: unknown;
    }[]
  >`select
      (select row_to_json(s) from public.user_settings s limit 1) as settings,
      (select row_to_json(p) from public.planning_preferences p limit 1) as preferences,
      (select coalesce(json_agg(g order by g.goal_category, g.weekday), '[]'::json)
         from public.planning_goal_slots g) as slots,
      (select coalesce(json_agg(r order by r.weekday, r.start_time), '[]'::json)
         from public.recurring_commitments r) as recurring,
      (select coalesce(json_agg(w order by w.version), '[]'::json)
         from public.schedule_weeks w where w.week_start = ${weekStart}::date) as weeks`;
  if (!row) throw new Error("state_missing");

  const settings = row.settings === null ? null : userSettingsRowSchema.parse(row.settings);
  const preferences =
    row.preferences === null
      ? null
      : preferencesFromRow(planningPreferencesRowSchema.parse(row.preferences));
  const slots = z.array(planningGoalSlotRowSchema).parse(row.slots).map(slotFromRow);
  const recurring = z.array(recurringCommitmentRowSchema).parse(row.recurring);
  const weeks = weeksSchema.parse(row.weeks);

  const draftWeek = weeks.find((w) => w.status === "draft") ?? null;
  const publishedWeek = weeks.find((w) => w.status === "published") ?? null;
  const draft = draftWeek
    ? {
        week: draftWeek,
        entries: await loadEntries(tx, draftWeek.id),
        fingerprint: await weekFingerprint(tx, draftWeek.id),
      }
    : null;
  const published = publishedWeek
    ? { week: publishedWeek, entries: await loadEntries(tx, publishedWeek.id) }
    : null;

  // Einzeltermine der Basisversion: Sie bleiben beim Speichern eines Vorschlags erhalten.
  const base = draft ?? published;
  const context = buildPlanningContext({
    weekStart,
    now,
    settings: {
      timezone: settings?.timezone ?? SCHEDULE_TIMEZONE,
      persisted: settings !== null,
      businessTargetMinutes:
        settings?.weekly_business_target_minutes ?? DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
      sportTargetMinutes: settings?.weekly_sport_target_minutes ?? null,
      relationshipTargetMinutes: settings?.weekly_relationship_target_minutes ?? null,
    },
    preferences,
    slots,
    commitments: recurring,
    oneOffEntries: base ? manualOneOffs(base.entries) : [],
  });
  return { context, locale: settings?.locale ?? DEFAULT_LOCALE, draft, published };
}

/** Speichert einen geprüften Vorschlag (RPC: atomar, idempotent, Prüfstand). */
export async function saveDraft(
  tx: Tx,
  input: {
    weekStart: LocalDate;
    expected: { draftId: string; fingerprint: string } | null;
    entries: readonly PlannedEntry[];
    planningNote: string | null;
  },
): Promise<ScheduleWeek> {
  const [row] = await tx<{ data: unknown }[]>`
    select row_to_json(w) as data
      from public.save_generated_schedule_draft(
             ${input.weekStart}::date,
             ${input.expected?.draftId ?? null}::uuid,
             ${input.expected?.fingerprint ?? null}::text,
             ${tx.json(input.entries.map((entry) => ({ ...entry })))}::jsonb,
             ${input.planningNote}::text) w`;
  return scheduleWeekRowSchema.parse(row?.data);
}

export async function publishDraft(
  tx: Tx,
  weekId: string,
  fingerprint: string,
): Promise<ScheduleWeek> {
  const [row] = await tx<{ data: unknown }[]>`
    select row_to_json(w) as data
      from public.publish_reviewed_schedule_week(${weekId}::uuid, ${fingerprint}::text) w`;
  return scheduleWeekRowSchema.parse(row?.data);
}

export async function discardDraft(tx: Tx, weekId: string, fingerprint: string): Promise<void> {
  await tx`select public.discard_reviewed_schedule_draft(${weekId}::uuid, ${fingerprint}::text)`;
}

import "server-only";

import {
  DEFAULT_LOCALE,
  DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
  type HistoryWeekInput,
  type LocalDate,
  type PlannedEntry,
  type PlanningContext,
  SCHEDULE_TIMEZONE,
  type ScheduleEntry,
  type ScheduleWeek,
  type TrackedSession,
  activitySessionRowSchema,
  buildPlanningContext,
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

  // Basisversion: Einzeltermine bleiben erhalten, Begonnenes bleibt unverändert.
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
    baseEntries: base ? base.entries : null,
  });
  return { context, locale: settings?.locale ?? DEFAULT_LOCALE, draft, published };
}

export type WritableEntry = Pick<
  PlannedEntry,
  "title" | "category" | "start_at" | "end_at" | "location" | "note"
> & { source: ScheduleEntry["source"] };

/** Vergleich ohne ID, Zeitstempel und Erledigt-Status. */
function entryKey(entry: WritableEntry | ScheduleEntry, withEnd = true): string {
  return JSON.stringify([
    entry.title,
    entry.category,
    Date.parse(entry.start_at),
    withEnd ? Date.parse(entry.end_at) : null,
    entry.location,
    entry.note,
    entry.source,
  ]);
}

export interface DraftWrite {
  remove: string[];
  /** Laufende Einträge: nur das Ende ändert sich (ID und Erledigt-Status bleiben). */
  endChanges: { id: string; end_at: string }[];
  insert: WritableEntry[];
}

export class LockedEntryChangeError extends Error {
  readonly code = "locked_entry_changed";
  constructor() {
    super("locked_entry_changed");
    this.name = "LockedEntryChangeError";
  }
}

/**
 * Was sich im Entwurf ändern muss, damit seine Einträge (inklusive Einzelterminen) genau
 * `desired` entsprechen – `desired` enthält deshalb immer die ganze Woche. Unveränderte Einträge
 * bleiben mit ID und Erledigt-Status erhalten. Vor `cutoff` Begonnenes wird nie entfernt oder neu
 * angelegt – nur das Ende eines laufenden Eintrags darf sich ändern. `historyFromRules`: Woche
 * ohne Version – Vergangenes aus den Wiederholungen wird erstmals angelegt.
 */
export function planDraftWrite(
  current: readonly ScheduleEntry[],
  desired: readonly WritableEntry[],
  cutoff: number,
  historyFromRules: boolean,
): DraftWrite {
  const pending = new Map<string, WritableEntry[]>();
  for (const entry of desired) {
    const key = entryKey(entry);
    pending.set(key, [...(pending.get(key) ?? []), entry]);
  }
  const unmatched: ScheduleEntry[] = [];
  for (const row of current) {
    const same = pending.get(entryKey(row));
    if (same && same.length > 0) same.pop();
    else unmatched.push(row);
  }
  const insert = [...pending.values()].flat();
  const write: DraftWrite = { remove: [], endChanges: [], insert };
  for (const row of unmatched) {
    if (Date.parse(row.start_at) >= cutoff) {
      write.remove.push(row.id);
      continue;
    }
    const index = insert.findIndex((entry) => entryKey(entry, false) === entryKey(row, false));
    const [entry] = index >= 0 ? insert.splice(index, 1) : [];
    if (!entry) throw new LockedEntryChangeError();
    write.endChanges.push({ id: row.id, end_at: entry.end_at });
  }
  if (!historyFromRules && insert.some((entry) => Date.parse(entry.start_at) < cutoff)) {
    throw new LockedEntryChangeError();
  }
  return write;
}

/** Wie SQLSTATE TT008 der Datenbankfunktionen: Der Entwurf wurde inzwischen geändert. */
function draftChanged(): Error {
  return Object.assign(new Error("draft_changed"), { code: "TT008" });
}

async function draftForUpdate(tx: Tx, weekStart: LocalDate): Promise<ScheduleWeek | null> {
  const [row] = await tx<{ data: unknown }[]>`
    select row_to_json(w) as data
      from public.schedule_weeks w
     where w.owner_id = (select auth.uid())
       and w.week_start = ${weekStart}::date
       and w.status = 'draft'
       for update`;
  return row ? scheduleWeekRowSchema.parse(row.data) : null;
}

/**
 * Speichert einen geprüften Vorschlag im Entwurf der Woche (legt ihn bei Bedarf an – als Kopie
 * der veröffentlichten Version). Ersetzt nur geplante Einträge ab `cutoff`; Einzeltermine und
 * Begonnenes bleiben. Optimistische Nebenläufigkeit wie bisher: Bestand ein Entwurf, muss
 * `expectedDraftRef` sein aktueller Fingerabdruck sein; bestand keiner, darf keiner entstanden
 * sein (sonst Konflikt). Dieselbe Anfrage erneut (z. B. nach einer Zeitüberschreitung) ändert
 * nichts. Läuft innerhalb der Wochensperre des Aufrufers (`lockWeek`).
 */
export async function saveDraft(
  tx: Tx,
  input: {
    weekStart: LocalDate;
    expectedDraftRef: string | null;
    desired: readonly WritableEntry[];
    cutoff: number;
    historyFromRules: boolean;
    planningNote: string | null;
  },
): Promise<ScheduleWeek> {
  let draft = await draftForUpdate(tx, input.weekStart);
  if (draft) {
    const write = planDraftWrite(
      await loadEntries(tx, draft.id),
      input.desired,
      input.cutoff,
      input.historyFromRules,
    );
    const unchanged =
      write.remove.length === 0 && write.endChanges.length === 0 && write.insert.length === 0;
    if (unchanged && draft.planning_note === input.planningNote) return draft;
    if (input.expectedDraftRef !== (await weekFingerprint(tx, draft.id))) throw draftChanged();
    return applyDraftWrite(tx, draft.id, write, input.planningNote);
  }
  if (input.expectedDraftRef !== null) throw draftChanged();
  const [created] = await tx<{ data: unknown }[]>`
    select row_to_json(w) as data from public.create_schedule_draft(${input.weekStart}::date) w`;
  draft = scheduleWeekRowSchema.parse(created?.data);
  const write = planDraftWrite(
    await loadEntries(tx, draft.id),
    input.desired,
    input.cutoff,
    input.historyFromRules,
  );
  return applyDraftWrite(tx, draft.id, write, input.planningNote);
}

async function applyDraftWrite(
  tx: Tx,
  weekId: string,
  write: DraftWrite,
  planningNote: string | null,
): Promise<ScheduleWeek> {
  if (write.remove.length > 0) {
    await tx`delete from public.schedule_entries
              where schedule_week_id = ${weekId}::uuid and id in ${tx(write.remove)}`;
  }
  for (const change of write.endChanges) {
    await tx`update public.schedule_entries set end_at = ${change.end_at}::timestamptz
              where schedule_week_id = ${weekId}::uuid and id = ${change.id}::uuid`;
  }
  if (write.insert.length > 0) {
    await tx`select public.add_schedule_entries(
               ${weekId}::uuid,
               ${tx.json(write.insert.map((entry) => ({ ...entry })))}::jsonb,
               false)`;
  }
  const [row] = await tx<{ data: unknown }[]>`
    update public.schedule_weeks w set planning_note = ${planningNote}::text
     where w.id = ${weekId}::uuid
    returning row_to_json(w) as data`;
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

const historySchema = z.object({
  weeks: z.array(
    z.object({
      week_start: z.string(),
      entries: z.array(
        scheduleEntryRowSchema.pick({
          category: true,
          completion_status: true,
          start_at: true,
          end_at: true,
        }),
      ),
    }),
  ),
  sessions: z.array(
    activitySessionRowSchema.pick({ goal_category: true, started_at: true, ended_at: true }),
  ),
});

/**
 * Daten für den Aktivitätsverlauf: Zielblöcke der veröffentlichten Versionen und erfasste
 * Aktivitäten im Zeitraum – nur Art, Status und Zeiten (keine Titel, Notizen, Orte oder IDs).
 */
export async function loadActivityHistoryInput(
  tx: Tx,
  range: { firstWeek: LocalDate; lastWeek: LocalDate; start: Date; end: Date },
): Promise<{ weeks: HistoryWeekInput[]; sessions: TrackedSession[] }> {
  const [row] = await tx<{ weeks: unknown; sessions: unknown }[]>`select
      (select coalesce(json_agg(json_build_object(
                'week_start', w.week_start,
                'entries', (select coalesce(json_agg(json_build_object(
                                     'category', e.category,
                                     'completion_status', e.completion_status,
                                     'start_at', e.start_at,
                                     'end_at', e.end_at) order by e.start_at), '[]'::json)
                              from public.schedule_entries e
                             where e.schedule_week_id = w.id
                               and e.category in ('business', 'sport', 'relationship')))), '[]'::json)
         from public.schedule_weeks w
        where w.status = 'published'
          and w.week_start between ${range.firstWeek}::date and ${range.lastWeek}::date) as weeks,
      (select coalesce(json_agg(json_build_object(
                'goal_category', s.goal_category,
                'started_at', s.started_at,
                'ended_at', s.ended_at) order by s.started_at), '[]'::json)
         from public.activity_sessions s
        where s.started_at < ${range.end.toISOString()}::timestamptz
          and (s.ended_at is null or s.ended_at > ${range.start.toISOString()}::timestamptz)) as sessions`;
  const data = historySchema.parse(row ?? { weeks: [], sessions: [] });
  return {
    weeks: data.weeks.map((week) => ({ weekStart: week.week_start, published: week.entries })),
    sessions: data.sessions,
  };
}

import "server-only";

import {
  type GoalSlotsInputParsed,
  type LocalDate,
  type PlannerSlotGoal,
  type PlanningContext,
  type PlanningGoalSlot,
  type PlanningPreferences,
  type PlanningPreferencesInputParsed,
  type ScheduleEntry,
  type ScheduleWeek,
  buildPlanningContext,
  manualOneOffs,
  planningGoalSlotRowSchema,
  planningPreferencesRowSchema,
  preferencesFromRow,
  scheduleWeekRowSchema,
  slotFromRow,
} from "@tagestakt/schedule-schema";
import { z } from "zod";

import { authorizedClient } from "../auth";
import { UserFacingError, toUserFacingError } from "../errors";
import { listRecurring } from "./recurring";
import { getSettings } from "./settings";

/**
 * Datenzugriff der Wochenplanung (Website). Alles läuft mit der Sitzung des angemeldeten
 * Benutzers (RLS); `owner_id` setzt die Datenbank selbst (`default auth.uid()`), nie der Client.
 */

export interface PlanningRules {
  preferences: PlanningPreferences | null;
  slots: PlanningGoalSlot[];
}

export async function getPlanningRules(): Promise<PlanningRules> {
  const { supabase } = await authorizedClient();
  const [preferences, slots] = await Promise.all([
    supabase.from("planning_preferences").select("*").maybeSingle(),
    supabase.from("planning_goal_slots").select("*").order("goal_category").order("weekday"),
  ]);
  if (preferences.error) throw toUserFacingError("Planungsregeln laden", preferences.error);
  if (slots.error) throw toUserFacingError("Zeitfenster laden", slots.error);
  return {
    preferences: preferences.data
      ? preferencesFromRow(planningPreferencesRowSchema.parse(preferences.data))
      : null,
    slots: z.array(planningGoalSlotRowSchema).parse(slots.data).map(slotFromRow),
  };
}

/**
 * Planungskontext einer Woche aus eigenen Einstellungen, Regeln und aktiven Wiederholungen.
 * `baseEntries`: Einträge der Basisversion (Entwurf, sonst veröffentlichte Version) – deren
 * manuelle Einzeltermine gehören fest zur Woche (wie beim Connector).
 */
export async function loadPlanningContext(
  weekStart: LocalDate,
  now: Date,
  baseEntries: readonly ScheduleEntry[] = [],
): Promise<PlanningContext> {
  const [settings, rules, commitments] = await Promise.all([
    getSettings(),
    getPlanningRules(),
    listRecurring(),
  ]);
  return buildPlanningContext({
    weekStart,
    now,
    settings: {
      timezone: settings.timezone,
      persisted: settings.persisted,
      businessTargetMinutes: settings.weeklyBusinessTargetMinutes,
      sportTargetMinutes: settings.weeklySportTargetMinutes,
      relationshipTargetMinutes: settings.weeklyRelationshipTargetMinutes,
    },
    preferences: rules.preferences,
    slots: rules.slots,
    commitments,
    oneOffEntries: manualOneOffs(baseEntries),
  });
}

export async function savePlanningPreferences(
  input: PlanningPreferencesInputParsed,
): Promise<void> {
  // owner_id stammt aus der serverseitig geprüften Sitzung; RLS erzwingt zusätzlich die Gleichheit.
  const { supabase, user } = await authorizedClient();
  const { error } = await supabase.from("planning_preferences").upsert(
    {
      owner_id: user.id,
      business_earliest_start: input.businessEarliestStart,
      business_latest_end: input.businessLatestEnd,
      business_min_block_minutes: input.businessMinBlockMinutes,
      business_max_block_minutes: input.businessMaxBlockMinutes,
      business_max_daily_minutes: input.businessMaxDailyMinutes,
      business_saturday_max_minutes: input.businessSaturdayMaxMinutes,
      business_sunday_max_minutes: input.businessSundayMaxMinutes,
      buffer_minutes: input.bufferMinutes,
    },
    { onConflict: "owner_id" },
  );
  if (error) throw toUserFacingError("Planungsregeln speichern", error);
}

/** Speichert die Zeitfenster eines Ziels: vorhandene Wochentage ändern, neue anlegen, übrige löschen. */
export async function saveGoalSlots(input: GoalSlotsInputParsed): Promise<void> {
  const { supabase } = await authorizedClient();
  const goal: PlannerSlotGoal = input.goal;
  const existing = await supabase
    .from("planning_goal_slots")
    .select("id, weekday")
    .eq("goal_category", goal);
  if (existing.error) throw toUserFacingError("Zeitfenster laden", existing.error);
  const byWeekday = new Map(existing.data.map((row) => [row.weekday, row.id]));

  for (const slot of input.slots) {
    const columns = {
      requirement: slot.requirement,
      title: slot.title,
      duration_minutes: slot.durationMinutes,
      window_start: slot.windowStart,
      window_end: slot.windowEnd,
    };
    const id = byWeekday.get(slot.weekday);
    const { error } = id
      ? await supabase.from("planning_goal_slots").update(columns).eq("id", id)
      : await supabase
          .from("planning_goal_slots")
          .insert({ ...columns, goal_category: goal, weekday: slot.weekday });
    if (error) throw toUserFacingError("Zeitfenster speichern", error);
  }

  const keep = new Set<number>(input.slots.map((slot) => slot.weekday));
  const remove = existing.data.filter((row) => !keep.has(row.weekday)).map((row) => row.id);
  if (remove.length > 0) {
    const { error } = await supabase.from("planning_goal_slots").delete().in("id", remove);
    if (error) throw toUserFacingError("Zeitfenster entfernen", error);
  }
}

/** Prüfstand einer Version: ändert sich bei jeder inhaltlichen Änderung des Entwurfs. */
export async function getWeekFingerprint(weekId: string): Promise<string> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("schedule_week_fingerprint", { p_week_id: weekId });
  if (error) throw toUserFacingError("Prüfstand ermitteln", error);
  return data;
}

/** Veröffentlicht genau den geprüften Stand eines Entwurfs (idempotent bei Doppelklick). */
export async function publishReviewedWeek(
  weekId: string,
  expectedFingerprint: string,
): Promise<ScheduleWeek> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("publish_reviewed_schedule_week", {
    p_week_id: weekId,
    p_expected_fingerprint: expectedFingerprint,
  });
  if (error) throw toUserFacingError("Wochenplan veröffentlichen", error);
  const week = scheduleWeekRowSchema.parse(data);
  if (week.status !== "published") {
    throw new UserFacingError("Der Wochenplan wurde nicht veröffentlicht.");
  }
  return week;
}

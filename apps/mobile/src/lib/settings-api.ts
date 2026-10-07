import {
  type GoalSettingsInput,
  type ReminderSettingsInput,
  goalSettingsInputSchema,
  reminderSettingsInputSchema,
} from "@tagestakt/schedule-schema";

import { type TypedSupabaseClient } from "./supabase";
import { WriteError, toWriteError } from "./write-errors";

/** Wochenziele speichern (Sport/Laila: `null` = kein Ziel; Gewerbe: 0 = kein Ziel). */
export async function saveGoalTargets(
  supabase: TypedSupabaseClient,
  ownerId: string,
  input: GoalSettingsInput,
): Promise<void> {
  const parsed = goalSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WriteError(parsed.error.issues[0]?.message ?? "Ungültiges Wochenziel.");
  }
  const { error } = await supabase.from("user_settings").upsert(
    {
      owner_id: ownerId,
      weekly_business_target_minutes: parsed.data.weeklyBusinessTargetMinutes,
      weekly_sport_target_minutes: parsed.data.weeklySportTargetMinutes,
      weekly_relationship_target_minutes: parsed.data.weeklyRelationshipTargetMinutes,
    },
    { onConflict: "owner_id" },
  );
  if (error) throw toWriteError(error);
}

/** Erinnerungs-Vorgaben (für Web und App gemeinsam) speichern. */
export async function saveReminderSettings(
  supabase: TypedSupabaseClient,
  ownerId: string,
  input: ReminderSettingsInput,
): Promise<void> {
  const parsed = reminderSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WriteError(parsed.error.issues[0]?.message ?? "Ungültige Einstellung.");
  }
  const { error } = await supabase.from("user_settings").upsert(
    {
      owner_id: ownerId,
      reminder_minutes_before: parsed.data.reminderMinutesBefore,
      remind_at_start: parsed.data.remindAtStart,
      remind_if_not_started: parsed.data.remindIfNotStarted,
      reminder_scope: parsed.data.reminderScope,
    },
    { onConflict: "owner_id" },
  );
  if (error) throw toWriteError(error);
}

import {
  type ActivitySession,
  GOAL_LABELS,
  type GoalKey,
  activityCorrectionTimestampsSchema,
  activitySessionRowSchema,
  activityStartInputSchema,
  idSchema,
} from "@tagestakt/schedule-schema";

import { type TypedSupabaseClient } from "./supabase";
import { WriteError, toWriteError } from "./write-errors";

function parseId(value: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new WriteError("Ungültige Anfrage.");
  return parsed.data;
}

/** Start mit Serverzeit. Ohne Planblock trägt die Aktivität den Zielnamen. */
export async function startActivity(
  supabase: TypedSupabaseClient,
  input: { goal: GoalKey; scheduleEntryId: string | null },
): Promise<ActivitySession> {
  const parsed = activityStartInputSchema.safeParse(input);
  if (!parsed.success) throw new WriteError("Bitte ein Ziel wählen.");
  const { goal, scheduleEntryId } = parsed.data;
  const { data, error } = await supabase.rpc("start_activity_session", {
    p_goal_category: goal,
    ...(scheduleEntryId
      ? { p_schedule_entry_id: scheduleEntryId }
      : { p_title: GOAL_LABELS[goal] }),
  });
  if (error) throw toWriteError(error);
  return activitySessionRowSchema.parse(data);
}

/** Beenden mit Serverzeit. */
export async function stopActivity(
  supabase: TypedSupabaseClient,
  sessionId: string,
): Promise<ActivitySession> {
  const { data, error } = await supabase.rpc("stop_activity_session", {
    p_session_id: parseId(sessionId),
  });
  if (error) throw toWriteError(error);
  return activitySessionRowSchema.parse(data);
}

/** „Zeit korrigieren“; Ende `null` = läuft weiter. */
export async function correctActivity(
  supabase: TypedSupabaseClient,
  input: { sessionId: string; startedAt: string; endedAt: string | null },
): Promise<ActivitySession> {
  const parsed = activityCorrectionTimestampsSchema.safeParse(input);
  if (!parsed.success) {
    throw new WriteError(parsed.error.issues[0]?.message ?? "Ungültige Zeitangabe.");
  }
  const { data, error } = await supabase.rpc("correct_activity_session", {
    p_session_id: parsed.data.sessionId,
    p_started_at: parsed.data.startedAt,
    ...(parsed.data.endedAt ? { p_ended_at: parsed.data.endedAt } : {}),
  });
  if (error) throw toWriteError(error);
  return activitySessionRowSchema.parse(data);
}

/** „Abbrechen“: versehentlich gestartete Aktivität verwerfen. */
export async function discardActivity(
  supabase: TypedSupabaseClient,
  sessionId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("activity_sessions")
    .delete()
    .eq("id", parseId(sessionId))
    .select("id");
  if (error) throw toWriteError(error);
  if (!data || data.length === 0) throw new WriteError("Aktivität nicht gefunden.");
}

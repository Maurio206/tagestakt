import "server-only";

import {
  ACTIVITY_ERROR_MESSAGES,
  type ActivitySession,
  type GoalKey,
  activitySessionRowSchema,
} from "@tagestakt/schedule-schema";
import { z } from "zod";

import { authorizedClient } from "../auth";
import { UserFacingError, toUserFacingError } from "../errors";

const sessionsSchema = z.array(activitySessionRowSchema);

interface DatabaseError {
  code?: string;
  message?: string;
}

/** Eindeutiger Teilindex (zwei laufende Aktivitäten) → verständliche Meldung statt „Entwurf“. */
function activityError(operation: string, error: DatabaseError): UserFacingError {
  if (error.code === "23505") {
    console.error(`[tagestakt] ${operation} fehlgeschlagen`, { code: error.code });
    return new UserFacingError(ACTIVITY_ERROR_MESSAGES.TT001);
  }
  return toUserFacingError(operation, error);
}

/** Aktivitäten, die das Intervall [from, to) berühren, plus eine eventuell laufende. */
export async function listSessions(from: Date, to: Date): Promise<ActivitySession[]> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("activity_sessions")
    .select("*")
    .lt("started_at", to.toISOString())
    .or(`ended_at.is.null,ended_at.gt.${from.toISOString()}`)
    .order("started_at", { ascending: true });
  if (error) throw activityError("Aktivitäten laden", error);
  return sessionsSchema.parse(data);
}

export async function getRunningSession(): Promise<ActivitySession | null> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("activity_sessions")
    .select("*")
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw activityError("Laufende Aktivität laden", error);
  return data ? activitySessionRowSchema.parse(data) : null;
}

export async function getSession(id: string): Promise<ActivitySession | null> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("activity_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw activityError("Aktivität laden", error);
  return data ? activitySessionRowSchema.parse(data) : null;
}

/** Start mit Serverzeit (RPC); höchstens eine laufende Aktivität. */
export async function startSession(input: {
  goal: GoalKey;
  title: string | null;
  scheduleEntryId: string | null;
}): Promise<ActivitySession> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("start_activity_session", {
    p_goal_category: input.goal,
    ...(input.title ? { p_title: input.title } : {}),
    ...(input.scheduleEntryId ? { p_schedule_entry_id: input.scheduleEntryId } : {}),
  });
  if (error) throw activityError("Aktivität starten", error);
  return activitySessionRowSchema.parse(data);
}

/**
 * Atomarer Wechsel (RPC): beendet die laufende Aktivität und startet die neue in einer
 * Transaktion mit Serverzeit. Scheitert der Start, läuft die bisherige Aktivität unverändert.
 */
export async function switchSession(
  runningSessionId: string,
  input: { goal: GoalKey; title: string | null; scheduleEntryId: string | null },
): Promise<ActivitySession> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("switch_activity_session", {
    p_session_id: runningSessionId,
    p_goal_category: input.goal,
    ...(input.title ? { p_title: input.title } : {}),
    ...(input.scheduleEntryId ? { p_schedule_entry_id: input.scheduleEntryId } : {}),
  });
  if (error) throw activityError("Aktivität wechseln", error);
  return activitySessionRowSchema.parse(data);
}

/** Beenden mit Serverzeit (RPC). */
export async function stopSession(id: string): Promise<ActivitySession> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("stop_activity_session", { p_session_id: id });
  if (error) throw activityError("Aktivität beenden", error);
  return activitySessionRowSchema.parse(data);
}

export async function correctSession(
  id: string,
  startedAt: Date,
  endedAt: Date | null,
): Promise<ActivitySession> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("correct_activity_session", {
    p_session_id: id,
    p_started_at: startedAt.toISOString(),
    ...(endedAt ? { p_ended_at: endedAt.toISOString() } : {}),
  });
  if (error) throw activityError("Zeit korrigieren", error);
  return activitySessionRowSchema.parse(data);
}

/** „Zeit nachtragen“: abgeschlossene Aktivität ohne Timer (wird als korrigiert markiert). */
export async function createManualSession(input: {
  goal: GoalKey;
  title: string;
  startedAt: Date;
  endedAt: Date;
}): Promise<void> {
  const { supabase } = await authorizedClient();
  const { error } = await supabase.from("activity_sessions").insert({
    goal_category: input.goal,
    title: input.title,
    started_at: input.startedAt.toISOString(),
    ended_at: input.endedAt.toISOString(),
  });
  if (error) throw activityError("Zeit nachtragen", error);
}

/** Löschen (auch „Abbrechen“ einer versehentlich gestarteten Aktivität). */
export async function deleteSession(id: string): Promise<void> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("activity_sessions")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw activityError("Aktivität löschen", error);
  if (!data || data.length === 0) throw new UserFacingError("Aktivität nicht gefunden.");
}

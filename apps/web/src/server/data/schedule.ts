import "server-only";

import {
  type CompletionStatus,
  type LocalDate,
  type ScheduleEntryInputParsed,
  type ScheduleWeek,
  type ScheduleWeekWithEntries,
  formatWeekLabel,
  isEntryWithinWeek,
  scheduleWeekRowSchema,
  scheduleWeekWithEntriesSchema,
  sortEntries,
  toEntryColumns,
} from "@tagestakt/schedule-schema";
import { z } from "zod";

import { authorizedClient } from "../auth";
import { UserFacingError, toUserFacingError } from "../errors";

const WEEK_WITH_ENTRIES = "*, schedule_entries(*)";

function parseWeekWithEntries(data: unknown): ScheduleWeekWithEntries {
  const week = scheduleWeekWithEntriesSchema.parse(data);
  return { ...week, schedule_entries: sortEntries(week.schedule_entries) };
}

/** Alle Versionen einer Woche, neueste zuerst. */
export async function listWeekVersions(weekStart: LocalDate): Promise<ScheduleWeek[]> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_weeks")
    .select("*")
    .eq("week_start", weekStart)
    .order("version", { ascending: false });
  if (error) throw toUserFacingError("Wochenversionen laden", error);
  return z.array(scheduleWeekRowSchema).parse(data);
}

export async function getWeekWithEntries(weekId: string): Promise<ScheduleWeekWithEntries | null> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_weeks")
    .select(WEEK_WITH_ENTRIES)
    .eq("id", weekId)
    .maybeSingle();
  if (error) throw toUserFacingError("Wochenplan laden", error);
  return data ? parseWeekWithEntries(data) : null;
}

/** Veröffentlichte Versionen der angegebenen Wochen (z. B. aktuelle + nächste). */
export async function getPublishedWeeks(
  weekStarts: readonly LocalDate[],
): Promise<ScheduleWeekWithEntries[]> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_weeks")
    .select(WEEK_WITH_ENTRIES)
    .eq("status", "published")
    .in("week_start", [...weekStarts])
    .order("week_start", { ascending: true });
  if (error) throw toUserFacingError("Veröffentlichte Pläne laden", error);
  return (data ?? []).map(parseWeekWithEntries);
}

/** Liefert den Entwurf der Woche oder legt ihn (als Kopie der veröffentlichten Version) an. */
export async function getOrCreateDraft(weekStart: LocalDate): Promise<ScheduleWeek> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("create_schedule_draft", { p_week_start: weekStart });
  if (error) throw toUserFacingError("Entwurf anlegen", error);
  return scheduleWeekRowSchema.parse(data);
}

export async function publishDraft(weekId: string): Promise<ScheduleWeek> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("publish_schedule_week", { p_week_id: weekId });
  if (error) throw toUserFacingError("Entwurf veröffentlichen", error);
  return scheduleWeekRowSchema.parse(data);
}

export async function deleteDraft(weekId: string): Promise<void> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_weeks")
    .delete()
    .eq("id", weekId)
    .eq("status", "draft")
    .select("id");
  if (error) throw toUserFacingError("Entwurf verwerfen", error);
  if (!data || data.length === 0) throw new UserFacingError("Entwurf nicht gefunden.");
}

export async function updatePlanningNote(weekId: string, note: string | null): Promise<void> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_weeks")
    .update({ planning_note: note })
    .eq("id", weekId)
    .eq("status", "draft")
    .select("id");
  if (error) throw toUserFacingError("Planungshinweis speichern", error);
  if (!data || data.length === 0)
    throw new UserFacingError("Nur Entwürfe können bearbeitet werden.");
}

async function requireDraft(weekId: string): Promise<ScheduleWeek> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_weeks")
    .select("*")
    .eq("id", weekId)
    .maybeSingle();
  if (error) throw toUserFacingError("Wochenplan laden", error);
  if (!data) throw new UserFacingError("Wochenplan nicht gefunden.");
  const week = scheduleWeekRowSchema.parse(data);
  if (week.status !== "draft") {
    throw new UserFacingError(
      "Nur Entwürfe können bearbeitet werden. Bitte zuerst einen Entwurf anlegen.",
    );
  }
  return week;
}

function entryColumnsForWeek(week: ScheduleWeek, input: ScheduleEntryInputParsed) {
  const columns = toEntryColumns(input);
  if (!isEntryWithinWeek(columns, week.week_start)) {
    throw new UserFacingError(
      `Der Eintrag muss in der gewählten Woche (${formatWeekLabel(week.week_start)}) beginnen.`,
    );
  }
  return columns;
}

export async function createEntry(weekId: string, input: ScheduleEntryInputParsed): Promise<void> {
  const week = await requireDraft(weekId);
  const columns = entryColumnsForWeek(week, input);
  const { supabase } = await authorizedClient();
  const { error } = await supabase
    .from("schedule_entries")
    .insert({ ...columns, schedule_week_id: week.id, source: "manual" });
  if (error) throw toUserFacingError("Eintrag anlegen", error);
}

async function getEntryWeekId(entryId: string): Promise<string> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_entries")
    .select("schedule_week_id")
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw toUserFacingError("Eintrag laden", error);
  if (!data) throw new UserFacingError("Eintrag nicht gefunden.");
  return data.schedule_week_id;
}

export async function updateEntry(entryId: string, input: ScheduleEntryInputParsed): Promise<void> {
  const week = await requireDraft(await getEntryWeekId(entryId));
  const columns = entryColumnsForWeek(week, input);
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_entries")
    .update(columns)
    .eq("id", entryId)
    .select("id");
  if (error) throw toUserFacingError("Eintrag ändern", error);
  if (!data || data.length === 0) throw new UserFacingError("Eintrag nicht gefunden.");
}

export async function deleteEntry(entryId: string): Promise<void> {
  await requireDraft(await getEntryWeekId(entryId));
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_entries")
    .delete()
    .eq("id", entryId)
    .select("id");
  if (error) throw toUserFacingError("Eintrag löschen", error);
  if (!data || data.length === 0) throw new UserFacingError("Eintrag nicht gefunden.");
}

export async function setEntryCompletion(entryId: string, status: CompletionStatus): Promise<void> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("schedule_entries")
    .update({ completion_status: status })
    .eq("id", entryId)
    .select("id");
  if (error) throw toUserFacingError("Status ändern", error);
  if (!data || data.length === 0) throw new UserFacingError("Eintrag nicht gefunden.");
}

export async function countEntries(weekId: string): Promise<number> {
  const { supabase } = await authorizedClient();
  const { count, error } = await supabase
    .from("schedule_entries")
    .select("id", { count: "exact", head: true })
    .eq("schedule_week_id", weekId);
  if (error) throw toUserFacingError("Einträge zählen", error);
  return count ?? 0;
}

export interface NewEntryColumns {
  title: string;
  category: string;
  start_at: string;
  end_at: string;
  location: string | null;
  note: string | null;
  source: "manual" | "recurring" | "agent";
}

/** Fügt Einträge atomar in einen Entwurf ein (optional nach Entfernen aller vorhandenen). */
export async function addEntriesToDraft(
  weekId: string,
  entries: readonly NewEntryColumns[],
  replaceExisting: boolean,
): Promise<number> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("add_schedule_entries", {
    p_week_id: weekId,
    p_entries: entries.map((e) => ({ ...e })),
    p_replace_existing: replaceExisting,
  });
  if (error) throw toUserFacingError("Einträge übernehmen", error);
  return data ?? 0;
}

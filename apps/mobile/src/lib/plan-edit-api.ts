import {
  type CompletionStatus,
  type LocalDate,
  type ScheduleEntryInput,
  type ScheduleWeek,
  type ScheduleWeekWithEntries,
  formatWeekLabel,
  isEntryWithinWeek,
  scheduleEntryInputSchema,
  scheduleWeekRowSchema,
  scheduleWeekWithEntriesSchema,
  sortEntries,
  toEntryColumns,
} from "@tagestakt/schedule-schema";
import { z } from "zod";

import { type TypedSupabaseClient } from "./supabase";
import { WriteError, toWriteError } from "./write-errors";

/**
 * „Plan bearbeiten“ in der App – dieselben Regeln wie auf der Website:
 * Änderungen nur im Entwurf; eine veröffentlichte Version bleibt sichtbar, bis der
 * Entwurf ausdrücklich veröffentlicht wird. Entwürfe werden nie lokal zwischengespeichert.
 */

export async function listWeekVersions(
  supabase: TypedSupabaseClient,
  weekStart: LocalDate,
): Promise<ScheduleWeek[]> {
  const { data, error } = await supabase
    .from("schedule_weeks")
    .select("*")
    .eq("week_start", weekStart)
    .order("version", { ascending: false });
  if (error) throw toWriteError(error, "Die Versionen konnten nicht geladen werden.");
  return z.array(scheduleWeekRowSchema).parse(data);
}

export async function getWeekWithEntries(
  supabase: TypedSupabaseClient,
  weekId: string,
): Promise<ScheduleWeekWithEntries | null> {
  const { data, error } = await supabase
    .from("schedule_weeks")
    .select("*, schedule_entries(*)")
    .eq("id", weekId)
    .maybeSingle();
  if (error) throw toWriteError(error, "Der Entwurf konnte nicht geladen werden.");
  if (!data) return null;
  const week = scheduleWeekWithEntriesSchema.parse(data);
  return { ...week, schedule_entries: sortEntries(week.schedule_entries) };
}

/** Legt den Entwurf an (Kopie der veröffentlichten Version) oder liefert den vorhandenen. */
export async function createDraft(
  supabase: TypedSupabaseClient,
  weekStart: LocalDate,
): Promise<ScheduleWeek> {
  const { data, error } = await supabase.rpc("create_schedule_draft", { p_week_start: weekStart });
  if (error) throw toWriteError(error, "Der Entwurf konnte nicht angelegt werden.");
  return scheduleWeekRowSchema.parse(data);
}

export interface EntryFormErrors {
  [field: string]: string | undefined;
}

/** Prüft eine Eingabe mit dem gemeinsamen Schema; liefert Spalten oder Feldfehler. */
export function validateEntry(
  week: Pick<ScheduleWeek, "week_start">,
  input: ScheduleEntryInput,
):
  | { ok: true; columns: ReturnType<typeof toEntryColumns> }
  | { ok: false; errors: EntryFormErrors } {
  const parsed = scheduleEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    const errors: EntryFormErrors = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      errors[key] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const columns = toEntryColumns(parsed.data);
  if (!isEntryWithinWeek(columns, week.week_start)) {
    return {
      ok: false,
      errors: { date: `Der Block muss in ${formatWeekLabel(week.week_start)} beginnen.` },
    };
  }
  return { ok: true, columns };
}

export async function saveEntry(
  supabase: TypedSupabaseClient,
  week: ScheduleWeek,
  columns: ReturnType<typeof toEntryColumns>,
  entryId?: string,
): Promise<void> {
  if (week.status !== "draft") throw new WriteError("Nur Entwürfe können bearbeitet werden.");
  if (entryId) {
    const { data, error } = await supabase
      .from("schedule_entries")
      .update(columns)
      .eq("id", entryId)
      .select("id");
    if (error) throw toWriteError(error);
    if (!data || data.length === 0) throw new WriteError("Eintrag nicht gefunden.");
    return;
  }
  const { error } = await supabase
    .from("schedule_entries")
    .insert({ ...columns, schedule_week_id: week.id, source: "manual" });
  if (error) throw toWriteError(error);
}

export async function deleteEntry(supabase: TypedSupabaseClient, entryId: string): Promise<void> {
  const { data, error } = await supabase
    .from("schedule_entries")
    .delete()
    .eq("id", entryId)
    .select("id");
  if (error) throw toWriteError(error, "Löschen fehlgeschlagen.");
  if (!data || data.length === 0) throw new WriteError("Eintrag nicht gefunden.");
}

export async function publishDraft(supabase: TypedSupabaseClient, weekId: string): Promise<void> {
  const { error } = await supabase.rpc("publish_schedule_week", { p_week_id: weekId });
  if (error) throw toWriteError(error, "Veröffentlichen fehlgeschlagen.");
}

/** Erledigt-Status eines Blocks (auch in veröffentlichten Versionen erlaubt). */
export async function setEntryCompletion(
  supabase: TypedSupabaseClient,
  entryId: string,
  status: CompletionStatus,
): Promise<void> {
  const { data, error } = await supabase
    .from("schedule_entries")
    .update({ completion_status: status })
    .eq("id", entryId)
    .select("id");
  if (error) throw toWriteError(error);
  if (!data || data.length === 0) throw new WriteError("Eintrag nicht gefunden.");
}

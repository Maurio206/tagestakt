import "server-only";

import {
  type LocalDate,
  type RecurringCommitment,
  type RecurringCommitmentInputParsed,
  expandRecurringCommitments,
  formatWeekLabel,
  recurringCommitmentRowSchema,
} from "@tagestakt/schedule-schema";
import { z } from "zod";

import { authorizedClient } from "../auth";
import { UserFacingError, toUserFacingError } from "../errors";
import {
  addEntriesToDraft,
  countEntries,
  getOrCreateDraft,
  getWeekWithEntries,
  listWeekVersions,
} from "./schedule";

export async function listRecurring(): Promise<RecurringCommitment[]> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("recurring_commitments")
    .select("*")
    .order("weekday")
    .order("start_time");
  if (error) throw toUserFacingError("Wiederholungen laden", error);
  return z.array(recurringCommitmentRowSchema).parse(data);
}

function toColumns(input: RecurringCommitmentInputParsed) {
  return {
    title: input.title,
    category: input.category,
    weekday: input.weekday,
    start_time: input.startTime,
    end_time: input.endTime,
    location: input.location,
    note: input.note,
    active: input.active,
  };
}

export async function createRecurring(input: RecurringCommitmentInputParsed): Promise<void> {
  const { supabase } = await authorizedClient();
  const { error } = await supabase.from("recurring_commitments").insert(toColumns(input));
  if (error) throw toUserFacingError("Wiederholung anlegen", error);
}

export async function updateRecurring(
  id: string,
  input: RecurringCommitmentInputParsed,
): Promise<void> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("recurring_commitments")
    .update(toColumns(input))
    .eq("id", id)
    .select("id");
  if (error) throw toUserFacingError("Wiederholung ändern", error);
  if (!data || data.length === 0) throw new UserFacingError("Wiederholung nicht gefunden.");
}

export async function setRecurringActive(id: string, active: boolean): Promise<void> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("recurring_commitments")
    .update({ active })
    .eq("id", id)
    .select("id");
  if (error) throw toUserFacingError("Wiederholung umschalten", error);
  if (!data || data.length === 0) throw new UserFacingError("Wiederholung nicht gefunden.");
}

export async function deleteRecurring(id: string): Promise<void> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("recurring_commitments")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw toUserFacingError("Wiederholung löschen", error);
  if (!data || data.length === 0) throw new UserFacingError("Wiederholung nicht gefunden.");
}

export type ApplyMode = "append" | "replace";

export interface ApplyRecurringResult {
  weekStart: LocalDate;
  version: number;
  inserted: number;
  skippedDuplicates: number;
}

/**
 * Übernimmt aktive Wiederholungen in den Entwurf einer Woche.
 *
 * - Eine veröffentlichte Version wird nie verändert; es entsteht ggf. ein neuer Entwurf.
 * - Enthält der Ziel-Entwurf (bzw. die zu kopierende veröffentlichte Version) bereits
 *   Einträge, ist eine ausdrückliche Bestätigung nötig.
 * - „Ergänzen“ überspringt identische Einträge (gleicher Titel, Beginn und Ende).
 */
export async function applyRecurringToWeek(params: {
  weekStart: LocalDate;
  mode: ApplyMode;
  confirmed: boolean;
}): Promise<ApplyRecurringResult> {
  const commitments = await listRecurring();
  const expanded = expandRecurringCommitments(commitments, params.weekStart);
  if (expanded.length === 0) {
    throw new UserFacingError("Es gibt keine aktiven Wiederholungen zum Übernehmen.");
  }

  const versions = await listWeekVersions(params.weekStart);
  const existingDraft = versions.find((v) => v.status === "draft");
  const published = versions.find((v) => v.status === "published");
  const sourceWeek = existingDraft ?? published;
  const existingCount = sourceWeek ? await countEntries(sourceWeek.id) : 0;

  if (existingCount > 0 && !params.confirmed) {
    throw new UserFacingError(
      `${formatWeekLabel(params.weekStart)} enthält bereits ${existingCount} Einträge` +
        (existingDraft ? " im Entwurf" : " in der veröffentlichten Version") +
        ". Bitte bestätige ausdrücklich, ob ergänzt oder ersetzt werden soll.",
    );
  }

  const draft = await getOrCreateDraft(params.weekStart);

  let toInsert = expanded;
  if (params.mode === "append") {
    const current = await getWeekWithEntries(draft.id);
    const existingKeys = new Set(
      (current?.schedule_entries ?? []).map(
        (e) => `${e.title}|${Date.parse(e.start_at)}|${Date.parse(e.end_at)}`,
      ),
    );
    toInsert = expanded.filter(
      (e) => !existingKeys.has(`${e.title}|${Date.parse(e.start_at)}|${Date.parse(e.end_at)}`),
    );
  }

  const inserted =
    toInsert.length > 0 || params.mode === "replace"
      ? await addEntriesToDraft(draft.id, toInsert, params.mode === "replace")
      : 0;

  return {
    weekStart: params.weekStart,
    version: draft.version,
    inserted,
    skippedDuplicates: expanded.length - toInsert.length,
  };
}

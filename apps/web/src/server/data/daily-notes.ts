import "server-only";

import {
  DAILY_NOTE_CONFLICT_CODE,
  type DailyNoteSaveInputParsed,
  type DailyNoteSnapshot,
  type LocalDate,
  dailyNoteRowSchema,
  toNoteSnapshot,
} from "@tagestakt/schedule-schema";
import { z } from "zod";

import { authorizedClient } from "../auth";
import { toUserFacingError } from "../errors";

const NOTE_COLUMNS = "id, owner_id, note_date, content, revision, created_at, updated_at";
const notesSchema = z.array(dailyNoteRowSchema);

/** Notiz eines Kalendertags (oder `null`). Inhalte werden nie protokolliert. */
export async function getDailyNote(date: LocalDate): Promise<DailyNoteSnapshot | null> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("daily_notes")
    .select(NOTE_COLUMNS)
    .eq("note_date", date)
    .maybeSingle();
  if (error) throw toUserFacingError("Tagesnotiz laden", error);
  return data ? toNoteSnapshot(dailyNoteRowSchema.parse(data)) : null;
}

/** Tage im Bereich [from, to], an denen eine Notiz existiert – ohne Inhalte zu laden. */
export async function listNoteDates(from: LocalDate, to: LocalDate): Promise<LocalDate[]> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase
    .from("daily_notes")
    .select("note_date")
    .gte("note_date", from)
    .lte("note_date", to)
    .order("note_date", { ascending: true });
  if (error) throw toUserFacingError("Tagesnotizen laden", error);
  return z
    .array(z.object({ note_date: z.string() }))
    .parse(data)
    .map((row) => row.note_date);
}

export type SaveDailyNoteResult =
  | { status: "saved"; note: DailyNoteSnapshot | null }
  | { status: "conflict"; latest: DailyNoteSnapshot | null };

/**
 * Speichert über die RPC `save_daily_note` (atomar, nur auf dem zuletzt gelesenen Stand).
 * Wurde die Notiz inzwischen anderswo geändert, wird nichts geschrieben und der aktuelle
 * Stand zurückgegeben – die Oberfläche lässt den Benutzer entscheiden.
 */
export async function saveDailyNote(input: DailyNoteSaveInputParsed): Promise<SaveDailyNoteResult> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.rpc("save_daily_note", {
    p_note_date: input.date,
    p_content: input.content,
    ...(input.expected
      ? { p_expected_id: input.expected.id, p_expected_revision: input.expected.revision }
      : {}),
  });
  if (error) {
    if (error.code === DAILY_NOTE_CONFLICT_CODE) {
      return { status: "conflict", latest: await getDailyNote(input.date) };
    }
    throw toUserFacingError("Tagesnotiz speichern", error);
  }
  const rows = notesSchema.parse(data ?? []);
  const row = rows[0];
  return { status: "saved", note: row ? toNoteSnapshot(row) : null };
}

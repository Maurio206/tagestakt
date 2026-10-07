import {
  DAILY_NOTE_CONFLICT_CODE,
  DAILY_NOTE_MESSAGES,
  type DailyNoteSaveInput,
  type DailyNoteSaveResult,
  type DailyNoteSnapshot,
  type LocalDate,
  dailyNoteRowSchema,
  dailyNoteSaveInputSchema,
  noteDateSchema,
  toNoteSnapshot,
} from "@tagestakt/schedule-schema";

import { type TypedSupabaseClient } from "./supabase";
import { toWriteError } from "./write-errors";

/**
 * Tagesnotizen der App. Bewusst NUR online: Notizen werden weder in den Offline-Plan
 * (plan-cache.ts) noch sonst auf dem Gerät gespeichert, nicht protokolliert und nie in
 * Benachrichtigungen verwendet. React Query hält den zuletzt geladenen Stand nur im
 * Arbeitsspeicher (beim Abmelden geleert).
 */

const NOTE_COLUMNS = "id, owner_id, note_date, content, revision, created_at, updated_at";

export class NoteLoadError extends Error {
  constructor(readonly kind: "offline" | "failed") {
    super(
      kind === "offline"
        ? "Ohne Verbindung nicht verfügbar."
        : "Die Tagesnotiz konnte nicht geladen werden.",
    );
    this.name = "NoteLoadError";
  }
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return /network|fetch|timeout/i.test(message);
}

/** Notiz eines Kalendertags oder `null`. */
export async function fetchDailyNote(
  supabase: TypedSupabaseClient,
  date: LocalDate,
): Promise<DailyNoteSnapshot | null> {
  const day = noteDateSchema.safeParse(date);
  if (!day.success) throw new NoteLoadError("failed");
  try {
    const { data, error } = await supabase
      .from("daily_notes")
      .select(NOTE_COLUMNS)
      .eq("note_date", day.data)
      .maybeSingle();
    if (error) throw error;
    return data ? toNoteSnapshot(dailyNoteRowSchema.parse(data)) : null;
  } catch (error) {
    throw new NoteLoadError(isNetworkError(error) ? "offline" : "failed");
  }
}

/**
 * Speichert über die RPC `save_daily_note` – atomar und nur auf dem zuletzt gelesenen Stand.
 * Konflikte werden gemeldet (mit aktuellem Stand), nie still überschrieben.
 */
export async function saveDailyNote(
  supabase: TypedSupabaseClient,
  input: DailyNoteSaveInput,
): Promise<DailyNoteSaveResult> {
  const parsed = dailyNoteSaveInputSchema.safeParse(input);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.message === DAILY_NOTE_MESSAGES.tooLong);
    return {
      status: "error",
      message: tooLong ? DAILY_NOTE_MESSAGES.tooLong : "Ungültige Anfrage.",
    };
  }
  const { date, content, expected } = parsed.data;
  try {
    const { data, error } = await supabase.rpc("save_daily_note", {
      p_note_date: date,
      p_content: content,
      ...(expected ? { p_expected_id: expected.id, p_expected_revision: expected.revision } : {}),
    });
    if (error) {
      if (error.code === DAILY_NOTE_CONFLICT_CODE) {
        let latest: DailyNoteSnapshot | null;
        try {
          latest = await fetchDailyNote(supabase, date);
        } catch {
          // Ohne aktuellen Stand nicht „gelöscht“ melden: Fehler, der Text bleibt erhalten.
          return {
            status: "error",
            message: `${DAILY_NOTE_MESSAGES.conflict} Der aktuelle Stand konnte nicht geladen werden – bitte erneut speichern.`,
          };
        }
        return { status: "conflict", latest };
      }
      throw error;
    }
    const rows = Array.isArray(data) ? data : [];
    const row = rows[0] ? dailyNoteRowSchema.parse(rows[0]) : undefined;
    const note = row ? toNoteSnapshot(row) : null;
    return { status: "saved", note, at: note?.updatedAt ?? new Date().toISOString() };
  } catch (error) {
    if (isNetworkError(error)) return { status: "error", message: DAILY_NOTE_MESSAGES.offline };
    return { status: "error", message: toWriteError(error, DAILY_NOTE_MESSAGES.failed).message };
  }
}

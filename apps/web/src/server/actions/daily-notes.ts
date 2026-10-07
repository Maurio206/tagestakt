"use server";

import { DAILY_NOTE_MESSAGES, dailyNoteSaveInputSchema } from "@tagestakt/schedule-schema";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import type { DailyNoteActionResult } from "@/lib/daily-note";

import { saveDailyNote } from "../data/daily-notes";
import { UserFacingError } from "../errors";

/**
 * Tagesnotiz speichern (leerer Inhalt entfernt sie). Prüft mit dem gemeinsamen Schema,
 * schreibt nur auf dem zuletzt gelesenen Stand und meldet Konflikte, statt zu überschreiben.
 * Notizinhalte werden weder protokolliert noch in Fehlermeldungen übernommen.
 */
export async function saveDailyNoteAction(input: unknown): Promise<DailyNoteActionResult> {
  const parsed = dailyNoteSaveInputSchema.safeParse(input);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.message === DAILY_NOTE_MESSAGES.tooLong);
    return {
      status: "error",
      message: tooLong ? DAILY_NOTE_MESSAGES.tooLong : "Ungültige Anfrage.",
    };
  }
  try {
    const result = await saveDailyNote(parsed.data);
    if (result.status === "conflict") return result;
    revalidatePath("/wochenplan");
    revalidatePath("/");
    return {
      status: "saved",
      note: result.note,
      at: result.note?.updatedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof UserFacingError) return { status: "error", message: error.message };
    console.error("[tagestakt] unerwarteter Fehler beim Speichern der Tagesnotiz", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return { status: "error", message: DAILY_NOTE_MESSAGES.failed };
  }
}

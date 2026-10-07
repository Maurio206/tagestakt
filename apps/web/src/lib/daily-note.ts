import type { DailyNoteSaveInput, DailyNoteSaveResult } from "@tagestakt/schedule-schema";

/** Ergebnis der Server Action „Tagesnotiz speichern“ (gemeinsame Form mit der App). */
export type DailyNoteActionResult = DailyNoteSaveResult;

/** Die Seite reicht die Server Action als Prop weiter (Komponenten importieren nichts aus src/server). */
export type SaveDailyNote = (input: DailyNoteSaveInput) => Promise<DailyNoteActionResult>;

/** Anker der Tagesnotiz im Wochenplan. */
export const DAILY_NOTE_ANCHOR = "tagesnotiz";

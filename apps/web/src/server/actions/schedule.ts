"use server";

import {
  adjustEntryTimes,
  completionStatusSchema,
  idSchema,
  planningNoteSchema,
  scheduleEntryInputSchema,
  timestampSchema,
  weekStartSchema,
} from "@tagestakt/schedule-schema";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  type ActionState,
  formValues,
  readCheckbox,
  readString,
  validationError,
} from "@/lib/form";
import { weekPlanPath } from "@/lib/paths";

import { UserFacingError } from "../errors";
import {
  createEntry,
  deleteDraft,
  deleteEntry,
  getEntry,
  getOrCreateDraft,
  publishDraft,
  setEntryCompletion,
  setEntryTimes,
  updateEntry,
  updatePlanningNote,
} from "../data/schedule";
import { handleAction } from "./handle";

function parseId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new UserFacingError("Ungültige Anfrage.");
  return parsed.data;
}

function parseWeekStart(value: unknown): string {
  const parsed = weekStartSchema.safeParse(value);
  if (!parsed.success) throw new UserFacingError("Ungültige Woche.");
  return parsed.data;
}

function entryInput(formData: FormData) {
  return {
    title: readString(formData, "title"),
    category: readString(formData, "category"),
    date: readString(formData, "date"),
    startTime: readString(formData, "startTime"),
    endTime: readString(formData, "endTime"),
    endsNextDay: readCheckbox(formData, "endsNextDay"),
    location: readString(formData, "location"),
    note: readString(formData, "note"),
  };
}

export async function createEntryAction(
  weekId: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const id = parseId(weekId);
    const parsed = scheduleEntryInputSchema.safeParse(entryInput(formData));
    if (!parsed.success) return validationError(parsed.error, values);
    await createEntry(id, parsed.data);
    revalidatePath("/wochenplan");
    revalidatePath("/");
    return { status: "success", message: `„${parsed.data.title}“ wurde zum Entwurf hinzugefügt.` };
  }, values);
}

export async function updateEntryAction(
  entryId: string,
  weekStart: string,
  versionId: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  const result = await handleAction(async () => {
    const id = parseId(entryId);
    parseId(versionId);
    parseWeekStart(weekStart);
    const parsed = scheduleEntryInputSchema.safeParse(entryInput(formData));
    if (!parsed.success) return validationError(parsed.error, values);
    await updateEntry(id, parsed.data);
    revalidatePath("/wochenplan");
    revalidatePath("/");
    return { status: "success" };
  }, values);
  if (result.status === "success") {
    redirect(weekPlanPath(weekStart, { versionId, notice: "gespeichert" }));
  }
  return result;
}

export async function deleteEntryAction(entryId: string): Promise<ActionState> {
  return handleAction(async () => {
    await deleteEntry(parseId(entryId));
    revalidatePath("/wochenplan");
    revalidatePath("/");
    return { status: "success", message: "Eintrag gelöscht." };
  });
}

export async function setCompletionAction(entryId: string, status: string): Promise<ActionState> {
  return handleAction(async () => {
    const parsed = completionStatusSchema.safeParse(status);
    if (!parsed.success) throw new UserFacingError("Ungültiger Status.");
    await setEntryCompletion(parseId(entryId), parsed.data);
    revalidatePath("/wochenplan");
    revalidatePath("/");
    return { status: "success" };
  });
}

export async function savePlanningNoteAction(
  weekId: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const parsed = planningNoteSchema.safeParse(readString(formData, "planningNote"));
    if (!parsed.success) {
      return {
        status: "error",
        message: "Bitte die markierten Felder prüfen.",
        fieldErrors: { planningNote: parsed.error.issues.map((i) => i.message) },
        values,
      };
    }
    await updatePlanningNote(parseId(weekId), parsed.data);
    revalidatePath("/wochenplan");
    return { status: "success", message: "Entwurf gespeichert." };
  }, values);
}

export async function createDraftAction(weekStart: string): Promise<ActionState> {
  const result = await handleAction(async () => {
    const draft = await getOrCreateDraft(parseWeekStart(weekStart));
    revalidatePath("/wochenplan");
    return { status: "success", message: draft.id };
  });
  if (result.status === "success" && result.message) {
    redirect(weekPlanPath(weekStart, { versionId: result.message, notice: "entwurf" }));
  }
  return result;
}

export async function publishDraftAction(weekId: string, weekStart: string): Promise<ActionState> {
  const result = await handleAction(async () => {
    parseWeekStart(weekStart);
    await publishDraft(parseId(weekId));
    revalidatePath("/wochenplan");
    revalidatePath("/");
    return { status: "success" };
  });
  if (result.status === "success") {
    redirect(weekPlanPath(weekStart, { versionId: weekId, notice: "veroeffentlicht" }));
  }
  return result;
}

export async function deleteDraftAction(weekId: string, weekStart: string): Promise<ActionState> {
  const result = await handleAction(async () => {
    parseWeekStart(weekStart);
    await deleteDraft(parseId(weekId));
    revalidatePath("/wochenplan");
    return { status: "success" };
  });
  if (result.status === "success") {
    redirect(weekPlanPath(weekStart, { notice: "verworfen" }));
  }
  return result;
}

const NUDGE_STEPS = new Set([-30, -15, 15, 30]);

/** Verschieben (±15/±30) bzw. Dauer ändern – mit „Rückgängig“ über die vorherigen Zeiten. */
export async function nudgeEntryAction(
  entryId: string,
  weekStart: string,
  versionId: string,
  kind: "move" | "resize",
  minutes: number,
): Promise<ActionState> {
  let undo: { entryId: string; startAt: string; endAt: string } | undefined;
  const result = await handleAction(async () => {
    const id = parseId(entryId);
    parseId(versionId);
    parseWeekStart(weekStart);
    if (!NUDGE_STEPS.has(minutes) || (kind !== "move" && kind !== "resize")) {
      throw new UserFacingError("Ungültige Anfrage.");
    }
    const entry = await getEntry(id);
    const adjusted = adjustEntryTimes(
      entry,
      kind === "move" ? { moveMinutes: minutes } : { resizeMinutes: minutes },
    );
    if (!adjusted.ok) throw new UserFacingError(adjusted.message);
    await setEntryTimes(id, adjusted.start_at, adjusted.end_at);
    undo = { entryId: id, startAt: entry.start_at, endAt: entry.end_at };
    revalidatePath("/wochenplan");
    revalidatePath("/");
    return { status: "success" };
  });
  if (result.status === "success" && undo) {
    redirect(
      weekPlanPath(weekStart, {
        versionId,
        editEntryId: undo.entryId,
        notice: "verschoben",
        undo,
      }),
    );
  }
  return result;
}

/** „Rückgängig“: stellt die vorherigen Zeiten eines Blocks wieder her. */
export async function restoreEntryTimesAction(
  entryId: string,
  weekStart: string,
  versionId: string,
  startAt: string,
  endAt: string,
): Promise<ActionState> {
  const result = await handleAction(async () => {
    const id = parseId(entryId);
    parseId(versionId);
    parseWeekStart(weekStart);
    const times = z.object({ startAt: timestampSchema, endAt: timestampSchema }).safeParse({
      startAt,
      endAt,
    });
    if (!times.success) throw new UserFacingError("Ungültige Anfrage.");
    await setEntryTimes(id, times.data.startAt, times.data.endAt);
    revalidatePath("/wochenplan");
    revalidatePath("/");
    return { status: "success" };
  });
  if (result.status === "success") {
    redirect(weekPlanPath(weekStart, { versionId, editEntryId: entryId, notice: "rueckgaengig" }));
  }
  return result;
}

"use server";

import {
  formatWeekLabel,
  getWeekStart,
  idSchema,
  localDateSchema,
  recurringCommitmentInputSchema,
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

import { UserFacingError } from "../errors";
import {
  applyRecurringToWeek,
  createRecurring,
  deleteRecurring,
  setRecurringActive,
  updateRecurring,
} from "../data/recurring";
import { handleAction } from "./handle";

function parseId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new UserFacingError("Ungültige Anfrage.");
  return parsed.data;
}

function recurringInput(formData: FormData) {
  return {
    title: readString(formData, "title"),
    category: readString(formData, "category"),
    weekday: readString(formData, "weekday"),
    startTime: readString(formData, "startTime"),
    endTime: readString(formData, "endTime"),
    location: readString(formData, "location"),
    note: readString(formData, "note"),
    active: readCheckbox(formData, "active"),
  };
}

export async function createRecurringAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const parsed = recurringCommitmentInputSchema.safeParse(recurringInput(formData));
    if (!parsed.success) return validationError(parsed.error, values);
    await createRecurring(parsed.data);
    revalidatePath("/wiederholungen");
    return { status: "success", message: `„${parsed.data.title}“ wurde angelegt.` };
  }, values);
}

export async function updateRecurringAction(
  id: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  const result = await handleAction(async () => {
    const parsed = recurringCommitmentInputSchema.safeParse(recurringInput(formData));
    if (!parsed.success) return validationError(parsed.error, values);
    await updateRecurring(parseId(id), parsed.data);
    revalidatePath("/wiederholungen");
    return { status: "success" };
  }, values);
  if (result.status === "success") redirect("/wiederholungen");
  return result;
}

export async function toggleRecurringAction(id: string, active: boolean): Promise<ActionState> {
  return handleAction(async () => {
    await setRecurringActive(parseId(id), z.boolean().parse(active));
    revalidatePath("/wiederholungen");
    return { status: "success" };
  });
}

export async function deleteRecurringAction(id: string): Promise<ActionState> {
  return handleAction(async () => {
    await deleteRecurring(parseId(id));
    revalidatePath("/wiederholungen");
    return { status: "success" };
  });
}

const applySchema = z.object({
  week: localDateSchema,
  mode: z.enum(["append", "replace"], { error: "Bitte „Ergänzen“ oder „Ersetzen“ wählen" }),
  confirmed: z.literal(true, {
    error: "Bitte die Übernahme ausdrücklich bestätigen.",
  }),
});

export async function applyRecurringAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const parsed = applySchema.safeParse({
      week: readString(formData, "week"),
      mode: readString(formData, "mode"),
      confirmed: readCheckbox(formData, "confirmed"),
    });
    if (!parsed.success) return validationError(parsed.error, values);

    const weekStart = getWeekStart(parsed.data.week);
    const result = await applyRecurringToWeek({
      weekStart,
      mode: parsed.data.mode,
      confirmed: parsed.data.confirmed,
    });
    revalidatePath("/wochenplan");
    revalidatePath("/wiederholungen");
    const skipped =
      result.skippedDuplicates > 0
        ? ` ${result.skippedDuplicates} bereits vorhandene Einträge wurden übersprungen.`
        : "";
    return {
      status: "success",
      message: `${result.inserted} Einträge in den Entwurf ${formatWeekLabel(weekStart)} (Version ${result.version}) übernommen.${skipped} Bitte im Wochenplan prüfen und veröffentlichen.`,
    };
  }, values);
}

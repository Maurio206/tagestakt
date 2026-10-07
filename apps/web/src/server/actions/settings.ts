"use server";

import {
  goalSettingsInputSchema,
  parseHoursInput,
  reminderSettingsInputSchema,
} from "@tagestakt/schedule-schema";
import { revalidatePath } from "next/cache";

import {
  type ActionState,
  type FieldErrors,
  formValues,
  readCheckbox,
  readString,
} from "@/lib/form";

import { saveGoalTargets, saveReminderSettings } from "../data/settings";
import { handleAction } from "./handle";

const GOAL_FIELDS = {
  weeklyBusinessTargetHours: "weeklyBusinessTargetMinutes",
  weeklySportTargetHours: "weeklySportTargetMinutes",
  weeklyRelationshipTargetHours: "weeklyRelationshipTargetMinutes",
} as const;

/** Wochenziele in Stunden (leer = kein Ziel; Gewerbe leer = 0). */
export async function saveGoalsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const fieldErrors: FieldErrors = {};
    const minutes: Record<string, number | null> = {};
    for (const [field, key] of Object.entries(GOAL_FIELDS)) {
      const parsed = parseHoursInput(readString(formData, field) ?? "");
      if (parsed !== null && Number.isNaN(parsed)) {
        fieldErrors[field] = ["Bitte Stunden angeben, z. B. 20, 2,5 oder 1:30 – oder leer lassen."];
      }
      minutes[key] = parsed;
    }
    if (Object.keys(fieldErrors).length > 0) {
      return {
        status: "error",
        message: "Bitte die markierten Felder prüfen.",
        fieldErrors,
        values,
      };
    }
    const parsed = goalSettingsInputSchema.safeParse({
      weeklyBusinessTargetMinutes: minutes.weeklyBusinessTargetMinutes ?? 0,
      weeklySportTargetMinutes: minutes.weeklySportTargetMinutes ?? null,
      weeklyRelationshipTargetMinutes: minutes.weeklyRelationshipTargetMinutes ?? null,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        const field = Object.entries(GOAL_FIELDS).find(([, k]) => k === key)?.[0] ?? key;
        fieldErrors[field] = [issue.message];
      }
      return {
        status: "error",
        message: "Bitte die markierten Felder prüfen.",
        fieldErrors,
        values,
      };
    }
    await saveGoalTargets(parsed.data);
    revalidatePath("/", "layout");
    return { status: "success", message: "Wochenziele gespeichert." };
  }, values);
}

/** Erinnerungseinstellungen; die App liest sie und plant lokal. */
export async function saveRemindersAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const lead = readString(formData, "reminderMinutesBefore") ?? "";
    const parsed = reminderSettingsInputSchema.safeParse({
      reminderMinutesBefore: lead === "" ? null : Number(lead),
      remindAtStart: readCheckbox(formData, "remindAtStart"),
      remindIfNotStarted: readCheckbox(formData, "remindIfNotStarted"),
      reminderScope: readString(formData, "reminderScope"),
    });
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = [issue.message];
      return {
        status: "error",
        message: "Bitte die markierten Felder prüfen.",
        fieldErrors,
        values,
      };
    }
    await saveReminderSettings(parsed.data);
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: "Erinnerungen gespeichert. Die App übernimmt sie bei der nächsten Synchronisierung.",
    };
  }, values);
}

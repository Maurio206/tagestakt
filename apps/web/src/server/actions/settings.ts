"use server";

import { formatHours, goalSettingsInputSchema } from "@tagestakt/schedule-schema";
import { revalidatePath } from "next/cache";

import { type ActionState, formValues, hoursToMinutes, readString } from "@/lib/form";

import { saveWeeklyTarget } from "../data/settings";
import { handleAction } from "./handle";

export async function saveSettingsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const minutes = hoursToMinutes(readString(formData, "weeklyBusinessTargetHours"));
    const parsed = goalSettingsInputSchema.shape.weeklyBusinessTargetMinutes.safeParse(minutes);
    if (!parsed.success || Number.isNaN(minutes)) {
      return {
        status: "error",
        message: "Bitte die markierten Felder prüfen.",
        fieldErrors: {
          weeklyBusinessTargetHours: [
            Number.isNaN(minutes)
              ? "Bitte eine Zahl angeben, z. B. 20 oder 17,5"
              : (parsed.error?.issues[0]?.message ?? "Ungültiger Wert"),
          ],
        },
        values,
      };
    }
    await saveWeeklyTarget(parsed.data);
    revalidatePath("/");
    revalidatePath("/einstellungen");
    revalidatePath("/wochenplan");
    return {
      status: "success",
      message: `Wochenziel auf ${formatHours(parsed.data)} gesetzt.`,
    };
  }, values);
}

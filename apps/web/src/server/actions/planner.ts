"use server";

import {
  PLANNER_SLOT_GOALS,
  type PlannerSlotGoal,
  evaluatePlanDraft,
  goalSlotsInputSchema,
  isValidLocalDate,
  planningPreferencesInputSchema,
} from "@tagestakt/schedule-schema";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type ActionState,
  type FieldErrors,
  formValues,
  readCheckbox,
  readString,
  validationError,
} from "@/lib/form";
import { planPath } from "@/lib/paths";

import { authorizedClient } from "../auth";
import {
  loadPlanningContext,
  publishReviewedWeek,
  saveGoalSlots,
  savePlanningPreferences,
} from "../data/planner";
import { getWeekWithEntries } from "../data/schedule";
import { handleAction } from "./handle";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function error(message: string, details: readonly string[] = []): ActionState {
  return {
    status: "error",
    message: details.length > 0 ? `${message} ${details.join(" ")}` : message,
  };
}

/**
 * „Wochenplan veröffentlichen“: nur der angezeigte, geprüfte Stand (Prüfstand aus dem
 * Formular) und nur, wenn alle Pflichtregeln erfüllt sind. Doppelte Klicks sind harmlos.
 */
export async function publishPlannedWeekAction(
  weekId: string,
  weekStart: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return handleAction(async () => {
    await authorizedClient();
    const fingerprint = readString(formData, "stand") ?? "";
    if (!UUID_PATTERN.test(weekId) || !FINGERPRINT_PATTERN.test(fingerprint)) {
      return error("Ungültige Anfrage. Bitte die Seite neu laden.");
    }
    const week = await getWeekWithEntries(weekId);
    if (!week) return error("Wochenplan nicht gefunden.");
    if (week.status === "draft") {
      const context = await loadPlanningContext(week.week_start, new Date(), week.schedule_entries);
      const evaluation = evaluatePlanDraft(context, week.schedule_entries);
      if (!evaluation.publishable) {
        return error(
          "Der Entwurf erfüllt noch nicht alle Pflichtregeln und wird nicht veröffentlicht:",
          evaluation.openDecisions,
        );
      }
      await publishReviewedWeek(weekId, fingerprint);
    } else if (week.status !== "published") {
      return error("Nur Entwürfe können veröffentlicht werden.");
    }
    revalidatePath("/", "layout");
    redirect(
      planPath(isValidLocalDate(weekStart) ? weekStart : week.week_start, "veroeffentlicht"),
    );
  });
}

export async function savePlanningPreferencesAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const parsed = planningPreferencesInputSchema.safeParse(values);
    if (!parsed.success) return validationError(parsed.error, values);
    await savePlanningPreferences(parsed.data);
    revalidatePath("/einstellungen");
    revalidatePath("/planen");
    return { status: "success", message: "Planungsregeln gespeichert." };
  }, values);
}

const SLOT_FIELDS = {
  requirement: "requirement",
  title: "title",
  durationMinutes: "duration",
  windowStart: "start",
  windowEnd: "end",
  weekday: "active",
} as const;

/** Zeitfenster eines Ziels (Training bzw. Beziehungszeit) je Wochentag. */
export async function saveGoalSlotsAction(
  goal: PlannerSlotGoal,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    if (!(PLANNER_SLOT_GOALS as readonly string[]).includes(goal)) {
      return error("Unbekanntes Ziel.");
    }
    const slots = [1, 2, 3, 4, 5, 6, 7]
      .filter((weekday) => readCheckbox(formData, `slot-${weekday}-active`))
      .map((weekday) => ({
        weekday,
        requirement: readString(formData, `slot-${weekday}-requirement`),
        title: readString(formData, `slot-${weekday}-title`),
        durationMinutes: readString(formData, `slot-${weekday}-duration`),
        windowStart: readString(formData, `slot-${weekday}-start`),
        windowEnd: readString(formData, `slot-${weekday}-end`),
      }));
    const parsed = goalSlotsInputSchema.safeParse({ goal, slots });
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const [, index, field] = issue.path;
        const slot = typeof index === "number" ? slots[index] : undefined;
        const key =
          slot && typeof field === "string" && field in SLOT_FIELDS
            ? `slot-${slot.weekday}-${SLOT_FIELDS[field as keyof typeof SLOT_FIELDS]}`
            : "slots";
        fieldErrors[key] ??= [issue.message];
      }
      return {
        status: "error",
        message: "Bitte die markierten Felder prüfen.",
        fieldErrors,
        values,
      };
    }
    await saveGoalSlots(parsed.data);
    revalidatePath("/einstellungen");
    revalidatePath("/planen");
    return { status: "success", message: "Zeitfenster gespeichert." };
  }, values);
}

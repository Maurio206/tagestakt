"use server";

import {
  PLANNER_SLOT_GOALS,
  type PlannerSlotGoal,
  evaluatePlanDraft,
  findPlanningConflicts,
  getMissingPlanningRequirements,
  goalSlotsInputSchema,
  isValidLocalDate,
  plannableWeekStarts,
  planningPreferencesInputSchema,
} from "@tagestakt/schedule-schema";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

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
  getWeekFingerprint,
  loadPlanningContext,
  publishReviewedWeek,
  saveGoalSlots,
  savePlanningPreferences,
} from "../data/planner";
import { getWeekWithEntries, listWeekVersions } from "../data/schedule";
import { readPlannerConfig } from "../planner/config";
import { executePlanningJob } from "../planner/execute";
import { reservePlanningJob } from "../planner/jobs";
import { getPlannerAccessToken } from "../planner/session";
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
 * „Woche mit Claude planen“ / „Neu planen“. Prüft Anmeldung, Woche, Konfiguration,
 * Voraussetzungen und Machbarkeit sofort; die eigentliche Planung läuft danach im Hintergrund.
 * Ein vorhandener Entwurf wird nur ersetzt, wenn genau dieser Stand angezeigt und bestätigt wurde.
 */
export async function startPlanningAction(
  weekStart: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return handleAction(async () => {
    const { supabase, user } = await authorizedClient();
    const now = new Date();
    if (!isValidLocalDate(weekStart) || !plannableWeekStarts(now).includes(weekStart)) {
      return error("Diese Woche kann nicht geplant werden.");
    }
    const config = readPlannerConfig();
    if (!config.ok) return error(config.message);

    const context = await loadPlanningContext(weekStart, now);
    const missing = getMissingPlanningRequirements(context);
    if (missing.length > 0) {
      return error(
        "Es fehlen Angaben – ohne sie wird nicht geplant:",
        missing.map((m) => m.message),
      );
    }
    const conflicts = findPlanningConflicts(context);
    if (conflicts.length > 0) {
      return error("Die Woche ist mit den gespeicherten Regeln nicht planbar:", conflicts);
    }

    const versions = await listWeekVersions(weekStart);
    const draft = versions.find((v) => v.status === "draft");
    const shownDraftId = readString(formData, "entwurf") ?? "";
    const shownFingerprint = readString(formData, "stand") ?? "";
    let expected: { draftId: string; fingerprint: string } | null = null;
    if (draft) {
      const fingerprint = await getWeekFingerprint(draft.id);
      if (shownDraftId !== draft.id || shownFingerprint !== fingerprint) {
        return error(
          "Der Entwurf dieser Woche wurde inzwischen geändert. Bitte die aktuelle Fassung prüfen und dann neu planen.",
        );
      }
      expected = { draftId: draft.id, fingerprint };
    } else if (shownDraftId) {
      return error("Der angezeigte Entwurf existiert nicht mehr. Bitte die Seite neu laden.");
    }

    const accessToken = await getPlannerAccessToken(supabase);
    const reserved = reservePlanningJob(user.id, weekStart);
    if (!reserved.ok) {
      return reserved.reason === "running"
        ? { status: "success", message: "Die Planung läuft bereits." }
        : error("Zu viele Planungen in kurzer Zeit. Bitte später erneut versuchen.");
    }
    const { startedAt } = reserved.job;
    after(() =>
      executePlanningJob({
        ownerId: user.id,
        startedAt,
        weekStart,
        context,
        expected,
        accessToken,
        config: config.config,
      }),
    );
    revalidatePath("/planen");
    return {
      status: "success",
      message: "Claude plant die Woche. Das dauert meist ein bis drei Minuten.",
    };
  });
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
      const context = await loadPlanningContext(week.week_start, new Date());
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

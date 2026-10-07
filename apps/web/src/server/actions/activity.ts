"use server";

import {
  GOAL_LABELS,
  activityCorrectionInputSchema,
  activityManualInputSchema,
  activityStartInputSchema,
  idSchema,
  resolveActivityTimes,
} from "@tagestakt/schedule-schema";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type ActionState,
  formValues,
  readCheckbox,
  readString,
  validationError,
} from "@/lib/form";
import { evaluationPath } from "@/lib/paths";

import { UserFacingError } from "../errors";
import {
  correctSession,
  createManualSession,
  deleteSession,
  startSession,
  stopSession,
} from "../data/activity";
import { handleAction } from "./handle";

function parseId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new UserFacingError("Ungültige Anfrage.");
  return parsed.data;
}

/** Laufende Aktivität erscheint in der Seitenleiste – daher immer das Layout neu laden. */
function refreshAll(): void {
  revalidatePath("/", "layout");
}

/** Ohne Planblock trägt die Aktivität den Zielnamen („Gewerbe“, „Sport“, „Laila“). */
function parseStart(input: { goal: unknown; title?: unknown; scheduleEntryId?: unknown }) {
  const parsed = activityStartInputSchema.safeParse(input);
  if (!parsed.success) throw new UserFacingError("Bitte ein Ziel wählen.");
  const { goal, title, scheduleEntryId } = parsed.data;
  return { goal, scheduleEntryId, title: title ?? (scheduleEntryId ? null : GOAL_LABELS[goal]) };
}

/** „Fokus starten“ (mit Planblock) bzw. „Aktivität starten“ (ohne). Beginn = Serverzeit. */
export async function startActivityAction(
  goal: string,
  scheduleEntryId: string | null,
): Promise<ActionState> {
  return handleAction(async () => {
    const input = parseStart({ goal, scheduleEntryId });
    const session = await startSession(input);
    refreshAll();
    return { status: "success", message: `„${session.title}“ läuft.` };
  });
}

/** Wechsel: laufende Aktivität beenden, dann die neue starten (zwei Serveraufrufe). */
export async function switchActivityAction(
  runningSessionId: string,
  goal: string,
  scheduleEntryId: string | null,
): Promise<ActionState> {
  return handleAction(async () => {
    const input = parseStart({ goal, scheduleEntryId });
    await stopSession(parseId(runningSessionId));
    refreshAll();
    const session = await startSession(input);
    return { status: "success", message: `„${session.title}“ läuft.` };
  });
}

export async function stopActivityAction(sessionId: string): Promise<ActionState> {
  return handleAction(async () => {
    const session = await stopSession(parseId(sessionId));
    refreshAll();
    return { status: "success", message: `„${session.title}“ beendet.` };
  });
}

/** „Abbrechen“: versehentlich gestartete Aktivität verwerfen (wird gelöscht). */
export async function discardActivityAction(sessionId: string): Promise<ActionState> {
  return handleAction(async () => {
    await deleteSession(parseId(sessionId));
    refreshAll();
    return { status: "success", message: "Aktivität verworfen." };
  });
}

export async function deleteActivityAction(sessionId: string): Promise<ActionState> {
  return handleAction(async () => {
    await deleteSession(parseId(sessionId));
    refreshAll();
    return { status: "success", message: "Aktivität gelöscht." };
  });
}

/** „Zeit korrigieren“: Ende leer = läuft weiter. */
export async function correctActivityAction(
  weekStart: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  const result = await handleAction(async () => {
    const endTime = readString(formData, "endTime")?.trim() ?? "";
    const parsed = activityCorrectionInputSchema.safeParse({
      sessionId: readString(formData, "sessionId"),
      date: readString(formData, "date"),
      startTime: readString(formData, "startTime"),
      endTime: endTime === "" ? null : endTime,
      endsNextDay: readCheckbox(formData, "endsNextDay"),
    });
    if (!parsed.success) return validationError(parsed.error, values);
    const { start, end } = resolveActivityTimes(parsed.data);
    await correctSession(parsed.data.sessionId, start, end);
    refreshAll();
    return { status: "success" };
  }, values);
  if (result.status === "success") {
    redirect(evaluationPath(weekStart, { notice: "korrigiert" }));
  }
  return result;
}

/** „Zeit nachtragen“: vergangene Aktivität ohne Timer. */
export async function addManualActivityAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData);
  return handleAction(async () => {
    const parsed = activityManualInputSchema.safeParse({
      goal: readString(formData, "goal"),
      title: readString(formData, "title"),
      date: readString(formData, "date"),
      startTime: readString(formData, "startTime"),
      endTime: readString(formData, "endTime"),
      endsNextDay: readCheckbox(formData, "endsNextDay"),
    });
    if (!parsed.success) return validationError(parsed.error, values);
    const { start, end } = resolveActivityTimes(parsed.data);
    if (!end) throw new UserFacingError("Bitte ein Ende angeben.");
    await createManualSession({
      goal: parsed.data.goal,
      title: parsed.data.title,
      startedAt: start,
      endedAt: end,
    });
    refreshAll();
    return { status: "success", message: `„${parsed.data.title}“ wurde nachgetragen.` };
  }, values);
}

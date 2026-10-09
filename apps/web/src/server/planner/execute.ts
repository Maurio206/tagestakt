import "server-only";

import { type LocalDate, type PlanningContext } from "@tagestakt/schedule-schema";

import { saveGeneratedDraft } from "../data/planner";
import { type ProposalRequester, createAnthropicRequester } from "./anthropic";
import { PLANNER_JOB_TIMEOUT_MS, type PlannerConfig } from "./config";
import { finishPlanningJob } from "./jobs";
import { runPlanning } from "./service";
import { createPlannerDbClient } from "./session";

/** Führt einen reservierten Planungsauftrag im Hintergrund aus und hält das Ergebnis fest. */
export async function executePlanningJob(input: {
  ownerId: string;
  startedAt: number;
  weekStart: LocalDate;
  context: PlanningContext;
  expected: { draftId: string; fingerprint: string } | null;
  accessToken: string;
  config: PlannerConfig;
  requester?: ProposalRequester;
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLANNER_JOB_TIMEOUT_MS);
  try {
    const db = createPlannerDbClient(input.accessToken);
    const result = await runPlanning({
      context: input.context,
      requester: input.requester ?? createAnthropicRequester(input.config),
      signal: controller.signal,
      save: async (entries, planningNote) => {
        const week = await saveGeneratedDraft(db, {
          weekStart: input.weekStart,
          expected: input.expected,
          entries,
          planningNote,
        });
        return { draftId: week.id };
      },
    });
    finishPlanningJob(input.ownerId, input.startedAt, result);
  } catch (error) {
    console.error("[tagestakt] Wochenplanung: Auftrag abgebrochen", {
      name: error instanceof Error ? error.name : typeof error,
    });
    finishPlanningJob(input.ownerId, input.startedAt, {
      status: "failed",
      message: "Die Planung ist fehlgeschlagen. Es wurde nichts gespeichert.",
      details: [],
    });
  } finally {
    clearTimeout(timer);
  }
}

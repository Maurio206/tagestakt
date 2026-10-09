import "server-only";

import {
  PLANNER_MAX_LIST_ITEMS,
  PLANNER_SUMMARY_MAX_LENGTH,
  PLANNER_TEXT_MAX_LENGTH,
  PLANNING_NOTE_MAX_LENGTH,
  type PlannedEntry,
  type PlannerProposal,
  type PlanningContext,
  buildPlannerModelInput,
  cleanPlannerText,
  findPlanningConflicts,
  getMissingPlanningRequirements,
  materializeProposal,
  parsePlannerProposal,
} from "@tagestakt/schedule-schema";

import { UserFacingError } from "../errors";
import { PlannerModelError, type ProposalRequester } from "./anthropic";

/**
 * Ablauf einer Planung: Voraussetzungen → Machbarkeit → Claude (höchstens zwei Versuche, der
 * zweite mit den Prüffehlern) → strenge Prüfung → atomares Speichern als neuer Entwurf.
 * Bei jeder Abweichung wird nichts gespeichert. Ohne Netzwerk testbar (Requester/Speichern
 * werden übergeben).
 */

export const PLANNER_MAX_ATTEMPTS = 2;

export type PlanningRunResult =
  | { status: "succeeded"; draftId: string; warnings: string[] }
  | { status: "failed"; message: string; details: string[] };

export type SaveGeneratedDraft = (
  entries: readonly PlannedEntry[],
  planningNote: string,
) => Promise<{ draftId: string }>;

const NOTE_PREFIX = "Vorschlag des Claude-Wochenplaners – vor dem Veröffentlichen prüfen.";

function modelTexts(values: readonly string[]): string[] {
  return values
    .slice(0, PLANNER_MAX_LIST_ITEMS)
    .map((value) => cleanPlannerText(value, PLANNER_TEXT_MAX_LENGTH))
    .filter((value) => value.length > 0);
}

/** Planungshinweis des Entwurfs: Zusammenfassung und Hinweise als reiner Text. */
export function buildPlanningNote(proposal: PlannerProposal): string {
  const summary = cleanPlannerText(proposal.summary, PLANNER_SUMMARY_MAX_LENGTH);
  const hints = modelTexts([...proposal.warnings, ...proposal.conflicts]);
  const lines = [NOTE_PREFIX];
  if (summary) lines.push(summary);
  if (hints.length > 0) lines.push("Hinweise:", ...hints.map((hint) => `– ${hint}`));
  return lines.join("\n").slice(0, PLANNING_NOTE_MAX_LENGTH);
}

export async function runPlanning(input: {
  context: PlanningContext;
  requester: ProposalRequester;
  save: SaveGeneratedDraft;
  signal: AbortSignal;
}): Promise<PlanningRunResult> {
  const { context, requester, save, signal } = input;

  const missing = getMissingPlanningRequirements(context);
  if (missing.length > 0) {
    return {
      status: "failed",
      message: "Es fehlen Angaben. Ohne sie wird nicht geplant.",
      details: missing.map((m) => m.message),
    };
  }
  const conflicts = findPlanningConflicts(context);
  if (conflicts.length > 0) {
    return {
      status: "failed",
      message: "Die Woche ist mit den gespeicherten Regeln nicht vollständig planbar.",
      details: conflicts,
    };
  }

  const modelInput = buildPlannerModelInput(context);
  let previousErrors: string[] = [];
  let modelConflicts: string[] = [];
  for (let attempt = 1; attempt <= PLANNER_MAX_ATTEMPTS; attempt += 1) {
    let raw: unknown;
    try {
      raw = await requester(modelInput, { previousErrors, signal });
    } catch (error) {
      const modelError =
        error instanceof PlannerModelError ? error : new PlannerModelError("invalid-response");
      console.error("[tagestakt] Wochenplanung: Planungsdienst fehlgeschlagen", {
        code: modelError.code,
        status: modelError.status,
      });
      // Ungültiges JSON darf einmal korrigiert werden; alles andere endet hier.
      if (modelError.code === "invalid-response" && attempt < PLANNER_MAX_ATTEMPTS) {
        previousErrors = ["Antwortformat: kein gültiges JSON"];
        continue;
      }
      return { status: "failed", message: modelError.message, details: [] };
    }

    const parsed = parsePlannerProposal(raw);
    if (!parsed.ok) {
      previousErrors = parsed.errors;
      continue;
    }
    modelConflicts = modelTexts(parsed.proposal.conflicts);
    const materialized = materializeProposal(context, parsed.proposal);
    if (!materialized.ok) {
      previousErrors = materialized.errors;
      continue;
    }

    try {
      const { draftId } = await save(materialized.entries, buildPlanningNote(parsed.proposal));
      return {
        status: "succeeded",
        draftId,
        warnings: modelTexts([...parsed.proposal.warnings, ...parsed.proposal.conflicts]),
      };
    } catch (error) {
      if (error instanceof UserFacingError) {
        return { status: "failed", message: error.message, details: [] };
      }
      console.error("[tagestakt] Wochenplanung: Speichern fehlgeschlagen", {
        name: error instanceof Error ? error.name : typeof error,
      });
      return {
        status: "failed",
        message: "Der Entwurf konnte nicht gespeichert werden. Bitte erneut planen.",
        details: [],
      };
    }
  }

  console.error("[tagestakt] Wochenplanung: Vorschlag verworfen", {
    attempts: PLANNER_MAX_ATTEMPTS,
    problems: previousErrors.length,
  });
  return {
    status: "failed",
    message:
      "Claude hat keinen Plan geliefert, der alle Regeln erfüllt. Es wurde nichts gespeichert.",
    details: [
      ...previousErrors.slice(0, PLANNER_MAX_LIST_ITEMS),
      ...modelConflicts.map((text) => `Hinweis von Claude: ${text}`),
    ],
  };
}

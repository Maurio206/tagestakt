import "server-only";

import {
  type ConnectorPlanningContext,
  type DeclaredExceptions,
  type EvaluatedEntry,
  type LocalDate,
  type NeutralBlock,
  PLANNER_HORIZON_WEEKS,
  PLANNER_SUMMARY_MAX_LENGTH,
  type PlannedEntry,
  type PlanningContext,
  type WeekPlanProposal,
  buildConnectorPlanningContext,
  cleanPlannerText,
  evaluatePlanDraft,
  getMissingPlanningRequirements,
  materializeProposal,
  neutralBlocks,
  neutralizePlannerText,
  plannableWeekStarts,
} from "@tagestakt/schedule-schema";

import { type ConnectorConfig } from "./config";
import { type Tx, asOwner, connectorTransaction, lockWeek } from "./db";
import {
  type WeekState,
  type WritableEntry,
  discardDraft,
  loadWeekState,
  planDraftWrite,
  publishDraft,
  saveDraft,
  weekFingerprint,
} from "./planning-data";

/**
 * Fachliche Abläufe hinter den MCP-Tools. Die Identität (Eigentümer, Freigabe) kommt
 * ausschließlich aus dem geprüften Access-Token; Tool-Eingaben enthalten nie eine owner_id.
 * Jede Änderung läuft in einer Transaktion mit Wochensperre; Prüfregeln sind dieselben wie in
 * der Website (packages/schedule-schema) und lassen sich nicht umgehen.
 */

export interface ConnectorAuth {
  ownerId: string;
  grantId: string;
}

export interface ServiceDeps {
  config: ConnectorConfig;
  now: () => Date;
}

export type ToolFailureCode =
  | "week_not_allowed"
  | "rules_missing"
  | "validation_failed"
  | "conflict"
  | "no_draft"
  | "not_publishable"
  | "failed";

export class ToolFailure extends Error {
  constructor(
    readonly code: ToolFailureCode,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ToolFailure";
  }
}

const DRAFT_REF_PATTERN = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine
// ---------------------------------------------------------------------------

/** Die laufende Woche (ab jetzt) und die nächsten Wochen; Vergangenes bleibt unverändert. */
function assertPlannableWeek(weekStart: LocalDate, now: Date): void {
  const weeks = plannableWeekStarts(now);
  if (!weeks.includes(weekStart)) {
    throw new ToolFailure(
      "week_not_allowed",
      `Erlaubt sind die laufende und die nächsten ${PLANNER_HORIZON_WEEKS} Wochen (jeweils Montag): ${weeks.join(", ")}.`,
    );
  }
}

/** Eintrag mit Herkunft – für Prüfung und neutrale Darstellung. */
type SourcedEntry = EvaluatedEntry & { source: "manual" | "recurring" | "agent" };

function sourced(entries: readonly SourcedEntry[]) {
  return entries.map((entry) => ({
    category: entry.category,
    start_at: entry.start_at,
    end_at: entry.end_at,
    source: entry.source,
  }));
}

function blocksOf(context: PlanningContext, entries: readonly SourcedEntry[]): NeutralBlock[] {
  return neutralBlocks(sourced(entries), context.timeZone);
}

const yesNo = (value: boolean) => (value ? "ja" : "nein");

export interface DraftOverview {
  draftVersion: number | null;
  draftRef: string | null;
  dutyComplete: boolean;
  trainingDaysMet: boolean;
  relationshipDaysMet: boolean;
  businessMinutes: number;
  businessMinimumMinutes: number;
  businessMinimumReached: boolean;
  overlaps: number;
  openDecisions: string[];
  /** Abweichungen von Wiederholungen und Regeln in dieser Woche (mit Grund, wenn genannt). */
  deviations: string[];
  hints: string[];
  publishable: boolean;
  /** Dieselbe Übersicht als Zeilen für die Anzeige im Gespräch. */
  summary: string[];
}

/** Server-Prüfübersicht eines (geplanten) Entwurfs – ohne Inhalte, nur Prüfergebnisse. */
export function draftOverview(
  context: PlanningContext,
  entries: readonly EvaluatedEntry[],
  version: number | null,
  draftRef: string | null,
  exceptions: DeclaredExceptions | null = null,
  extraDeviations: readonly string[] = [],
): DraftOverview {
  const evaluation = evaluatePlanDraft(context, entries, exceptions);
  const byKey = new Map(evaluation.checks.map((check) => [check.key, check]));
  const ok = (key: string) => byKey.get(key)?.ok ?? false;
  const openDecisions = evaluation.openDecisions.map(neutralizePlannerText);
  const deviations = [...evaluation.deviations, ...extraDeviations].map(neutralizePlannerText);
  const hints = evaluation.checks
    .filter((check) => !check.hard && !check.ok && !check.deviation)
    .map((check) =>
      neutralizePlannerText(check.value ? `${check.label}: ${check.value}` : check.label),
    );
  return {
    draftVersion: version,
    draftRef,
    dutyComplete: ok("duty"),
    trainingDaysMet: ok("sport-slots"),
    relationshipDaysMet: ok("relationship-slots"),
    businessMinutes: evaluation.minutes.business,
    businessMinimumMinutes: context.settings.businessTargetMinutes,
    businessMinimumReached: ok("business-minimum"),
    overlaps: evaluation.overlapCount,
    openDecisions,
    deviations,
    hints,
    publishable: evaluation.publishable,
    summary: [
      `Dienst vollständig: ${yesNo(ok("duty"))}`,
      `Trainingstage erfüllt: ${yesNo(ok("sport-slots"))}`,
      `Beziehungstage erfüllt: ${yesNo(ok("relationship-slots"))}`,
      `Gewerbeminuten: ${evaluation.minutes.business} (Minimum ${context.settings.businessTargetMinutes})`,
      `Gewerbe-Minimum erreicht: ${yesNo(ok("business-minimum"))}`,
      `Abweichungen diese Woche: ${deviations.length === 0 ? "keine" : deviations.join(" | ")}`,
      `Überschneidungen: ${evaluation.overlapCount}`,
      `Offene Entscheidungen: ${openDecisions.length === 0 ? "keine" : openDecisions.join(" | ")}`,
      `Entwurfsversion: ${version ?? "–"}`,
    ],
  };
}

async function ownerState(tx: Tx, auth: ConnectorAuth, weekStart: LocalDate, now: Date) {
  await asOwner(tx, auth.ownerId);
  return loadWeekState(tx, weekStart, now);
}

function requireDraft(state: WeekState, expectedDraftRef: string) {
  if (!state.draft) {
    throw new ToolFailure("no_draft", "Für diese Woche gibt es keinen Entwurf.");
  }
  if (state.draft.fingerprint !== expectedDraftRef) {
    throw new ToolFailure(
      "conflict",
      "Der Entwurf wurde inzwischen geändert. Bitte mit get_week_draft den aktuellen Stand laden.",
    );
  }
  return state.draft;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export async function getPlanningContext(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  weekStart: LocalDate,
): Promise<ConnectorPlanningContext> {
  const now = deps.now();
  assertPlannableWeek(weekStart, now);
  return connectorTransaction(deps.config, async (tx) => {
    await tx`set transaction read only`;
    const state = await ownerState(tx, auth, weekStart, now);
    return buildConnectorPlanningContext(state.context, {
      locale: state.locale,
      saveAllowed: getMissingPlanningRequirements(state.context).length === 0,
      draft: state.draft
        ? {
            ref: state.draft.fingerprint,
            version: state.draft.week.version,
            entries: sourced(state.draft.entries),
          }
        : null,
      published: state.published
        ? {
            version: state.published.week.version,
            publishedAt: state.published.week.published_at,
            entries: sourced(state.published.entries),
          }
        : null,
    });
  });
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  overview: DraftOverview | null;
  blocks: NeutralBlock[];
}

interface ValidPlan {
  /** Alle Einträge der Woche: Begonnenes, ab jetzt Geplantes und Einzeltermine. */
  desired: WritableEntry[];
  exceptions: DeclaredExceptions;
  oneOffChanges: string[];
}

function validateAgainst(
  state: WeekState,
  proposal: WeekPlanProposal,
): { result: ValidationResult; plan: ValidPlan | null } {
  const missing = getMissingPlanningRequirements(state.context).map((m) =>
    neutralizePlannerText(m.message),
  );
  if (missing.length > 0) {
    return { result: { valid: false, errors: missing, overview: null, blocks: [] }, plan: null };
  }
  const materialized = materializeProposal(state.context, proposal);
  if (!materialized.ok) {
    return {
      result: {
        valid: false,
        errors: materialized.errors.map(neutralizePlannerText),
        overview: null,
        blocks: [],
      },
      plan: null,
    };
  }
  const planned: SourcedEntry[] = [
    ...materialized.locked,
    ...[...materialized.entries, ...materialized.oneOffs].map((entry) => ({
      ...entry,
      completion_status: "planned" as const,
    })),
  ];
  const overview = draftOverview(
    state.context,
    planned,
    null,
    null,
    materialized.exceptions,
    materialized.oneOffChanges,
  );
  const begun = materialized.locked.map((entry): PlannedEntry => ({
    title: entry.title,
    category: entry.category,
    start_at: entry.start_at,
    end_at: entry.end_at,
    location: entry.location,
    note: entry.note,
    source: entry.source,
  }));
  return {
    result: {
      valid: overview.publishable,
      errors: overview.openDecisions,
      overview,
      blocks: blocksOf(state.context, planned),
    },
    plan: overview.publishable
      ? {
          desired: [
            ...begun,
            ...materialized.entries,
            ...materialized.oneOffs.map((entry): WritableEntry => ({
              title: entry.title,
              category: entry.category,
              start_at: entry.start_at,
              end_at: entry.end_at,
              location: entry.location,
              note: entry.note,
              source: "manual",
            })),
          ],
          exceptions: materialized.exceptions,
          oneOffChanges: materialized.oneOffChanges,
        }
      : null,
  };
}

/** Vollständige deterministische Prüfung ohne Speichern. */
export async function validateWeekPlan(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  proposal: WeekPlanProposal,
): Promise<ValidationResult> {
  const now = deps.now();
  assertPlannableWeek(proposal.weekStart, now);
  return connectorTransaction(deps.config, async (tx) => {
    await tx`set transaction read only`;
    const state = await ownerState(tx, auth, proposal.weekStart, now);
    return validateAgainst(state, proposal).result;
  });
}

export interface SaveResult {
  saved: true;
  replayed: boolean;
  draftVersion: number;
  draftRef: string;
  overview: DraftOverview;
  /** Mit `publish: true`: die veröffentlichte Version; sonst null. */
  published: { version: number; publishedAt: string | null } | null;
}

/**
 * Speichert nur einen vollständig gültigen Vorschlag als Entwurf; mit `publish: true` wird er in
 * derselben Transaktion veröffentlicht. Scheitert die Prüfung, wird nichts gespeichert und nichts
 * veröffentlicht.
 */
export async function saveWeekDraft(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  input: WeekPlanProposal & { expectedDraftRef: string | null; publish?: boolean },
): Promise<SaveResult> {
  const now = deps.now();
  assertPlannableWeek(input.weekStart, now);
  if (input.expectedDraftRef !== null && !DRAFT_REF_PATTERN.test(input.expectedDraftRef)) {
    throw new ToolFailure("conflict", "Ungültiger Entwurfsbezug.");
  }
  return connectorTransaction(deps.config, async (tx) => {
    await asOwner(tx, auth.ownerId);
    await lockWeek(tx, auth.ownerId, input.weekStart);
    const state = await loadWeekState(tx, input.weekStart, now);
    // Abweichungen im aktuellen Stand prüft materializeProposal: Sie müssen im Vorschlag
    // übernommen oder ausdrücklich zurückgesetzt werden – nichts geht still verloren.
    const { expectedDraftRef, publish, ...proposal } = input;
    const validation = validateAgainst(state, proposal);
    if (!validation.result.valid || !validation.plan) {
      throw new ToolFailure(
        "validation_failed",
        "Der Plan ist nicht gültig und wurde nicht gespeichert.",
        validation.result.errors,
      );
    }
    const planningNote = proposal.summary
      ? cleanPlannerText(proposal.summary, PLANNER_SUMMARY_MAX_LENGTH) || null
      : null;
    const cutoff = state.context.notBefore;
    // Genau dieser Plan ist schon veröffentlicht (z. B. wiederholter Aufruf nach einer
    // Zeitüberschreitung, auch mit dem alten Bezug): nichts tun.
    if (publish && !state.draft && state.published) {
      const write = planDraftWrite(state.published.entries, validation.plan.desired, cutoff, false);
      const unchanged =
        write.remove.length + write.endChanges.length + write.insert.length === 0 &&
        state.published.week.planning_note === planningNote;
      if (unchanged) {
        return {
          saved: true,
          replayed: true,
          draftVersion: state.published.week.version,
          draftRef: await weekFingerprint(tx, state.published.week.id),
          overview: draftOverview(
            state.context,
            state.published.entries,
            state.published.week.version,
            null,
            validation.plan.exceptions,
            validation.plan.oneOffChanges,
          ),
          published: {
            version: state.published.week.version,
            publishedAt: state.published.week.published_at,
          },
        };
      }
    }
    if (input.expectedDraftRef !== null && !state.draft) {
      throw new ToolFailure(
        "conflict",
        "Der erwartete Entwurf existiert nicht mehr. Bitte den Planungskontext neu laden.",
      );
    }
    const previous = state.draft?.fingerprint ?? null;
    const saved = await saveDraft(tx, {
      weekStart: input.weekStart,
      expectedDraftRef,
      desired: validation.plan.desired,
      cutoff,
      historyFromRules: !state.draft && !state.published,
      planningNote,
    });
    const after = await loadWeekState(tx, input.weekStart, now);
    if (!after.draft || after.draft.week.id !== saved.id) throw new Error("draft_missing");
    const overview = draftOverview(
      after.context,
      after.draft.entries,
      saved.version,
      after.draft.fingerprint,
      validation.plan.exceptions,
      validation.plan.oneOffChanges,
    );
    // Veröffentlichen in derselben Transaktion: scheitert es, bleibt auch der Entwurf ungespeichert.
    const published = publish
      ? await publishChecked(tx, after.context, after.draft, validation.plan.oneOffChanges)
      : null;
    return {
      saved: true,
      replayed: previous !== null && previous === after.draft.fingerprint,
      draftVersion: saved.version,
      draftRef: after.draft.fingerprint,
      overview,
      published: published
        ? { version: published.version, publishedAt: published.publishedAt }
        : null,
    };
  });
}

export interface DraftView {
  weekStart: LocalDate;
  draft: {
    version: number;
    draftRef: string;
    blocks: NeutralBlock[];
    overview: DraftOverview;
  } | null;
  published: { version: number; publishedAt: string | null } | null;
}

export async function getWeekDraft(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  weekStart: LocalDate,
): Promise<DraftView> {
  const now = deps.now();
  assertPlannableWeek(weekStart, now);
  return connectorTransaction(deps.config, async (tx) => {
    await tx`set transaction read only`;
    const state = await ownerState(tx, auth, weekStart, now);
    return {
      weekStart,
      draft: state.draft
        ? {
            version: state.draft.week.version,
            draftRef: state.draft.fingerprint,
            blocks: blocksOf(state.context, state.draft.entries),
            overview: draftOverview(
              state.context,
              state.draft.entries,
              state.draft.week.version,
              state.draft.fingerprint,
            ),
          }
        : null,
      published: state.published
        ? {
            version: state.published.week.version,
            publishedAt: state.published.week.published_at,
          }
        : null,
    };
  });
}

export interface PublishResult {
  published: true;
  version: number;
  publishedAt: string | null;
}

/**
 * Veröffentlicht einen vollständig gültigen, seit dem Lesen unveränderten Entwurf (der Benutzer hat
 * am 2026-10-10 entschieden, dass Claude gültige Pläne selbst veröffentlicht). Die bisher
 * veröffentlichte Version wird archiviert.
 */
export async function publishWeekDraft(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  input: { weekStart: LocalDate; expectedDraftRef: string },
): Promise<PublishResult> {
  const now = deps.now();
  assertPlannableWeek(input.weekStart, now);
  return connectorTransaction(deps.config, async (tx) => {
    await asOwner(tx, auth.ownerId);
    await lockWeek(tx, auth.ownerId, input.weekStart);
    const state = await loadWeekState(tx, input.weekStart, now);
    const draft = requireDraft(state, input.expectedDraftRef);
    return publishChecked(tx, state.context, draft);
  });
}

/** Prüft den gespeicherten Entwurf erneut und veröffentlicht ihn (innerhalb der Wochensperre). */
async function publishChecked(
  tx: Tx,
  context: PlanningContext,
  draft: NonNullable<WeekState["draft"]>,
  extraDeviations: readonly string[] = [],
): Promise<PublishResult> {
  const overview = draftOverview(
    context,
    draft.entries,
    draft.week.version,
    draft.fingerprint,
    null,
    extraDeviations,
  );
  if (!overview.publishable) {
    throw new ToolFailure(
      "not_publishable",
      "Der Entwurf erfüllt nicht alle Pflichtregeln und wird nicht veröffentlicht.",
      overview.openDecisions,
    );
  }
  const published = await publishDraft(tx, draft.week.id, draft.fingerprint);
  if (published.status !== "published") throw new Error("not_published");
  return { published: true, version: published.version, publishedAt: published.published_at };
}

/** Verwirft ausschließlich den eigenen, unveröffentlichten Entwurf genau dieses Stands. */
export async function discardWeekDraft(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  input: { weekStart: LocalDate; expectedDraftRef: string },
): Promise<{ discarded: true; version: number }> {
  const now = deps.now();
  assertPlannableWeek(input.weekStart, now);
  return connectorTransaction(deps.config, async (tx) => {
    await asOwner(tx, auth.ownerId);
    await lockWeek(tx, auth.ownerId, input.weekStart);
    const state = await loadWeekState(tx, input.weekStart, now);
    const draft = requireDraft(state, input.expectedDraftRef);
    // Doppelt abgesichert: die RPC prüft den Fingerabdruck erneut.
    if ((await weekFingerprint(tx, draft.week.id)) !== draft.fingerprint) {
      throw new ToolFailure("conflict", "Der Entwurf wurde inzwischen geändert.");
    }
    await discardDraft(tx, draft.week.id, draft.fingerprint);
    return { discarded: true, version: draft.week.version };
  });
}

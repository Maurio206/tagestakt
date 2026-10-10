import "server-only";

import {
  type ConnectorPlanningContext,
  type EvaluatedEntry,
  type LocalDate,
  type NeutralBlock,
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
  upcomingWeekStarts,
} from "@tagestakt/schedule-schema";

import { type ConnectorConfig } from "./config";
import { type Tx, asConnector, asOwner, connectorTransaction, lockWeek } from "./db";
import {
  type WeekState,
  discardDraft,
  loadWeekState,
  publishDraft,
  saveDraft,
  weekFingerprint,
} from "./planning-data";
import { generateToken, isTokenOfKind, sha256Hex } from "./tokens";

/**
 * Fachliche Abläufe hinter den MCP-Tools. Die Identität (Eigentümer, Freigabe) kommt
 * ausschließlich aus dem geprüften Access-Token; Tool-Eingaben enthalten nie eine owner_id.
 * Jede Änderung läuft in einer Transaktion mit Wochensperre; Prüfregeln sind dieselben wie in
 * der Website (packages/schedule-schema) und lassen sich nicht umgehen.
 */

export const CONFIRMATION_SECONDS = 10 * 60;

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
  | "confirmation_invalid"
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

function assertUpcomingWeek(weekStart: LocalDate, now: Date): void {
  if (!upcomingWeekStarts(now).includes(weekStart)) {
    throw new ToolFailure(
      "week_not_allowed",
      `Erlaubt sind nur die kommenden Wochen ab Montag: ${upcomingWeekStarts(now).join(", ")}.`,
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
): DraftOverview {
  const evaluation = evaluatePlanDraft(context, entries);
  const byKey = new Map(evaluation.checks.map((check) => [check.key, check]));
  const ok = (key: string) => byKey.get(key)?.ok ?? false;
  const openDecisions = evaluation.openDecisions.map(neutralizePlannerText);
  const hints = evaluation.checks
    .filter((check) => !check.hard && !check.ok)
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
    hints,
    publishable: evaluation.publishable,
    summary: [
      `Dienst vollständig: ${yesNo(ok("duty"))}`,
      `Trainingstage erfüllt: ${yesNo(ok("sport-slots"))}`,
      `Beziehungstage erfüllt: ${yesNo(ok("relationship-slots"))}`,
      `Gewerbeminuten: ${evaluation.minutes.business} (Minimum ${context.settings.businessTargetMinutes})`,
      `Gewerbe-Minimum erreicht: ${yesNo(ok("business-minimum"))}`,
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
  assertUpcomingWeek(weekStart, now);
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

function validateAgainst(
  state: WeekState,
  proposal: WeekPlanProposal,
): { result: ValidationResult; entries: PlannedEntry[] | null } {
  const missing = getMissingPlanningRequirements(state.context).map((m) =>
    neutralizePlannerText(m.message),
  );
  if (missing.length > 0) {
    return { result: { valid: false, errors: missing, overview: null, blocks: [] }, entries: null };
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
      entries: null,
    };
  }
  const planned: SourcedEntry[] = [...materialized.entries, ...materialized.oneOffs].map(
    (entry) => ({ ...entry, completion_status: "planned" as const }),
  );
  const overview = draftOverview(state.context, planned, null, null);
  return {
    result: {
      valid: overview.publishable,
      errors: overview.openDecisions,
      overview,
      blocks: blocksOf(state.context, planned),
    },
    entries: overview.publishable ? materialized.entries : null,
  };
}

/** Vollständige deterministische Prüfung ohne Speichern. */
export async function validateWeekPlan(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  proposal: WeekPlanProposal,
): Promise<ValidationResult> {
  const now = deps.now();
  assertUpcomingWeek(proposal.weekStart, now);
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
}

/** Speichert nur einen vollständig gültigen Vorschlag als Entwurf (nie veröffentlichen). */
export async function saveWeekDraft(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  input: WeekPlanProposal & { expectedDraftRef: string | null },
): Promise<SaveResult> {
  const now = deps.now();
  assertUpcomingWeek(input.weekStart, now);
  if (input.expectedDraftRef !== null && !DRAFT_REF_PATTERN.test(input.expectedDraftRef)) {
    throw new ToolFailure("conflict", "Ungültiger Entwurfsbezug.");
  }
  return connectorTransaction(deps.config, async (tx) => {
    await asOwner(tx, auth.ownerId);
    await lockWeek(tx, auth.ownerId, input.weekStart);
    const state = await loadWeekState(tx, input.weekStart, now);
    const { weekStart, blocks, summary } = input;
    const validation = validateAgainst(state, { weekStart, blocks, summary });
    if (!validation.result.valid || !validation.entries) {
      throw new ToolFailure(
        "validation_failed",
        "Der Plan ist nicht gültig und wurde nicht gespeichert.",
        validation.result.errors,
      );
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
      expected:
        state.draft && input.expectedDraftRef !== null
          ? { draftId: state.draft.week.id, fingerprint: input.expectedDraftRef }
          : null,
      entries: validation.entries,
      planningNote: summary ? cleanPlannerText(summary, PLANNER_SUMMARY_MAX_LENGTH) || null : null,
    });
    const after = await loadWeekState(tx, input.weekStart, now);
    if (!after.draft || after.draft.week.id !== saved.id) throw new Error("draft_missing");
    return {
      saved: true,
      replayed: previous !== null && previous === after.draft.fingerprint,
      draftVersion: saved.version,
      draftRef: after.draft.fingerprint,
      overview: draftOverview(
        after.context,
        after.draft.entries,
        saved.version,
        after.draft.fingerprint,
      ),
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
  assertUpcomingWeek(weekStart, now);
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

export interface PreparedPublish {
  confirmationId: string;
  expiresAt: string;
  draftVersion: number;
  draftRef: string;
  overview: DraftOverview;
  blocks: NeutralBlock[];
  question: string;
}

export const PUBLISH_QUESTION = "Soll dieser Wochenplan veröffentlicht werden?";

/** Bereitet die Veröffentlichung vor: einmalige, kurzlebige Bestätigungs-ID. Veröffentlicht nichts. */
export async function prepareWeekPublish(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  input: { weekStart: LocalDate; expectedDraftRef: string },
): Promise<PreparedPublish> {
  const now = deps.now();
  assertUpcomingWeek(input.weekStart, now);
  return connectorTransaction(deps.config, async (tx) => {
    await asOwner(tx, auth.ownerId);
    await lockWeek(tx, auth.ownerId, input.weekStart);
    const state = await loadWeekState(tx, input.weekStart, now);
    const draft = requireDraft(state, input.expectedDraftRef);
    const overview = draftOverview(
      state.context,
      draft.entries,
      draft.week.version,
      draft.fingerprint,
    );
    if (!overview.publishable) {
      throw new ToolFailure(
        "not_publishable",
        "Der Entwurf erfüllt noch nicht alle Pflichtregeln.",
        overview.openDecisions,
      );
    }
    const confirmationId = generateToken("confirmation");
    await asConnector(tx);
    // Je Freigabe und Entwurf höchstens eine offene Bestätigung; Abgelaufenes aufräumen.
    await tx`delete from connector.publish_confirmations
              where grant_id = ${auth.grantId}
                and (schedule_week_id = ${draft.week.id}::uuid or expires_at < now())
                and used_at is null`;
    const [row] = await tx<{ expires_at: Date }[]>`
      insert into connector.publish_confirmations (
        confirmation_hash, grant_id, owner_id, schedule_week_id, fingerprint, expires_at)
      values (${sha256Hex(confirmationId)}, ${auth.grantId}::uuid, ${auth.ownerId}::uuid,
              ${draft.week.id}::uuid, ${draft.fingerprint},
              now() + make_interval(secs => ${CONFIRMATION_SECONDS}))
      returning expires_at`;
    if (!row) throw new Error("confirmation_insert_failed");
    return {
      confirmationId,
      expiresAt: row.expires_at.toISOString(),
      draftVersion: draft.week.version,
      draftRef: draft.fingerprint,
      overview,
      blocks: blocksOf(state.context, draft.entries),
      question: PUBLISH_QUESTION,
    };
  });
}

export interface PublishResult {
  published: true;
  version: number;
  publishedAt: string | null;
}

/** Veröffentlicht genau den bestätigten, unveränderten und vollständig gültigen Entwurf. */
export async function publishWeekDraft(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  input: { weekStart: LocalDate; expectedDraftRef: string; confirmationId: string },
): Promise<PublishResult> {
  const now = deps.now();
  assertUpcomingWeek(input.weekStart, now);
  const invalid = () =>
    new ToolFailure(
      "confirmation_invalid",
      "Die Bestätigung ist ungültig, abgelaufen oder bereits verwendet. Bitte prepare_week_publish erneut aufrufen und die Freigabe erneut einholen.",
    );
  if (!isTokenOfKind(input.confirmationId, "confirmation")) throw invalid();
  return connectorTransaction(deps.config, async (tx) => {
    const hash = sha256Hex(input.confirmationId);
    const [confirmation] = await tx<
      {
        grant_id: string;
        owner_id: string;
        schedule_week_id: string;
        fingerprint: string;
        usable: boolean;
      }[]
    >`select grant_id, owner_id, schedule_week_id, fingerprint,
             used_at is null and expires_at > now() as usable
        from connector.publish_confirmations
       where confirmation_hash = ${hash}
         for update`;
    if (
      !confirmation ||
      !confirmation.usable ||
      confirmation.grant_id !== auth.grantId ||
      confirmation.owner_id !== auth.ownerId
    ) {
      throw invalid();
    }

    await asOwner(tx, auth.ownerId);
    await lockWeek(tx, auth.ownerId, input.weekStart);
    const state = await loadWeekState(tx, input.weekStart, now);
    const draft = requireDraft(state, input.expectedDraftRef);
    if (
      draft.week.id !== confirmation.schedule_week_id ||
      draft.fingerprint !== confirmation.fingerprint
    ) {
      throw new ToolFailure(
        "conflict",
        "Der Entwurf wurde seit der Vorbereitung geändert. Bitte erneut prüfen und bestätigen lassen.",
      );
    }
    const overview = draftOverview(
      state.context,
      draft.entries,
      draft.week.version,
      draft.fingerprint,
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

    await asConnector(tx);
    await tx`update connector.publish_confirmations set used_at = now()
              where confirmation_hash = ${hash}`;
    return {
      published: true,
      version: published.version,
      publishedAt: published.published_at,
    };
  });
}

/** Verwirft ausschließlich den eigenen, unveröffentlichten Entwurf genau dieses Stands. */
export async function discardWeekDraft(
  deps: ServiceDeps,
  auth: ConnectorAuth,
  input: { weekStart: LocalDate; expectedDraftRef: string },
): Promise<{ discarded: true; version: number }> {
  const now = deps.now();
  assertUpcomingWeek(input.weekStart, now);
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

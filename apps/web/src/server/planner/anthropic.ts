import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { PLANNER_PROPOSAL_JSON_SCHEMA, type PlannerModelInput } from "@tagestakt/schedule-schema";

import { PLANNER_REQUEST_TIMEOUT_MS, type PlannerConfig } from "./config";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserMessage } from "./prompt";

/**
 * Aufruf der Claude Messages API (offizielles SDK). Nur der Server spricht mit Anthropic;
 * protokolliert werden höchstens Fehlerart und HTTP-Status – nie Prompt, Antwort oder Inhalte.
 */

export type PlannerModelErrorCode =
  | "auth"
  | "rate-limit"
  | "timeout"
  | "unavailable"
  | "refusal"
  | "truncated"
  | "invalid-response"
  | "aborted";

export const PLANNER_MODEL_ERROR_MESSAGES: Readonly<Record<PlannerModelErrorCode, string>> = {
  auth: "Der Planungsdienst hat den Server-Schlüssel abgelehnt. Bitte ANTHROPIC_API_KEY prüfen.",
  "rate-limit":
    "Der Planungsdienst ist gerade ausgelastet. Bitte in einigen Minuten erneut planen.",
  timeout: "Der Planungsdienst hat nicht rechtzeitig geantwortet. Bitte erneut planen.",
  unavailable: "Der Planungsdienst ist gerade nicht erreichbar. Bitte später erneut planen.",
  refusal: "Der Planungsdienst hat die Anfrage nicht bearbeitet. Bitte erneut planen.",
  truncated: "Die Antwort des Planungsdienstes war unvollständig. Bitte erneut planen.",
  "invalid-response": "Die Antwort des Planungsdienstes war kein gültiger Wochenplan.",
  aborted: "Die Planung wurde abgebrochen.",
};

export class PlannerModelError extends Error {
  constructor(
    readonly code: PlannerModelErrorCode,
    readonly status?: number,
  ) {
    super(PLANNER_MODEL_ERROR_MESSAGES[code]);
    this.name = "PlannerModelError";
  }
}

/** Liefert die (noch ungeprüfte) JSON-Antwort des Modells. */
export type ProposalRequester = (
  input: PlannerModelInput,
  options: { previousErrors: readonly string[]; signal: AbortSignal },
) => Promise<unknown>;

/** Modelle, für die die serverseitige Ausweichlösung bei Ablehnungen verfügbar ist. */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

export function toPlannerModelError(error: unknown): PlannerModelError {
  if (error instanceof PlannerModelError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new PlannerModelError("aborted");
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new PlannerModelError("timeout");
  if (error instanceof Anthropic.APIConnectionError) return new PlannerModelError("unavailable");
  if (error instanceof Anthropic.AuthenticationError) return new PlannerModelError("auth", 401);
  if (error instanceof Anthropic.PermissionDeniedError) return new PlannerModelError("auth", 403);
  if (error instanceof Anthropic.RateLimitError) return new PlannerModelError("rate-limit", 429);
  if (error instanceof Anthropic.APIError) {
    return new PlannerModelError(
      error.status === 529 || (error.status ?? 0) >= 500 ? "unavailable" : "invalid-response",
      error.status,
    );
  }
  return new PlannerModelError("invalid-response");
}

export function createAnthropicRequester(
  config: PlannerConfig,
  client: Anthropic = new Anthropic({
    apiKey: config.apiKey,
    timeout: PLANNER_REQUEST_TIMEOUT_MS,
    maxRetries: 2,
  }),
): ProposalRequester {
  return async (input, { previousErrors, signal }) => {
    try {
      const withFallback = FALLBACK_MODELS.has(config.model);
      const stream = client.beta.messages.stream(
        {
          model: config.model,
          max_tokens: 32_000,
          system: PLANNER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildPlannerUserMessage(input, previousErrors) }],
          output_config: {
            effort: "high",
            format: { type: "json_schema", schema: PLANNER_PROPOSAL_JSON_SCHEMA },
          },
          ...(withFallback
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
        },
        { signal },
      );
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new PlannerModelError("refusal");
      if (message.stop_reason === "max_tokens") throw new PlannerModelError("truncated");
      const text = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new PlannerModelError("invalid-response");
      }
    } catch (error) {
      throw toPlannerModelError(error);
    }
  };
}

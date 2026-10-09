import "server-only";

/**
 * Serverseitige Konfiguration des Wochenplaners. Der API-Schlüssel kommt ausschließlich aus der
 * Laufzeitumgebung (Coolify-Secret `ANTHROPIC_API_KEY`), nie aus `NEXT_PUBLIC_*`, nie aus dem
 * Client. Meldungen nennen nur Variablennamen, nie Werte.
 */

export const DEFAULT_PLANNER_MODEL = "claude-opus-5-5";
/** Höchstdauer eines Modellaufrufs (ms); das SDK wiederholt zusätzlich höchstens zweimal. */
export const PLANNER_REQUEST_TIMEOUT_MS = 180_000;
/** Höchstdauer des gesamten Planungsauftrags inklusive Korrekturversuch. */
export const PLANNER_JOB_TIMEOUT_MS = 8 * 60_000;

export interface PlannerConfig {
  apiKey: string;
  model: string;
}

export type PlannerConfigResult =
  { ok: true; config: PlannerConfig } | { ok: false; message: string };

const MODEL_PATTERN = /^claude-[a-z0-9.-]{2,60}$/;

export function readPlannerConfig(
  env: Record<string, string | undefined> = process.env,
): PlannerConfigResult {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      message:
        "Der Wochenplaner ist noch nicht eingerichtet: Das Server-Secret ANTHROPIC_API_KEY fehlt.",
    };
  }
  if (apiKey.length < 20 || /\s/.test(apiKey)) {
    return {
      ok: false,
      message: "Das Server-Secret ANTHROPIC_API_KEY hat kein gültiges Format.",
    };
  }
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_PLANNER_MODEL;
  if (!MODEL_PATTERN.test(model)) {
    return { ok: false, message: "ANTHROPIC_MODEL enthält keine gültige Modellbezeichnung." };
  }
  return { ok: true, config: { apiKey, model } };
}

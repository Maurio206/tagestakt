import { parsePublicEnv } from "@/lib/env";

import { resolveOwnerId } from "./owner";

/**
 * Prüft die serverseitige Konfiguration beim Start. Liefert verständliche
 * Meldungen – ohne die konfigurierten Werte selbst auszugeben.
 */
export function validateServerConfiguration(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const publicEnv = parsePublicEnv(env, env.NODE_ENV);
  if (!publicEnv.ok) problems.push(...publicEnv.messages);
  try {
    resolveOwnerId(env.TAGESTAKT_OWNER_USER_ID, env.NODE_ENV);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "TAGESTAKT_OWNER_USER_ID ist ungültig.");
  }
  return problems;
}

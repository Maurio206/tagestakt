import { parsePublicEnv } from "@/lib/env";

import { resolveOwnerId } from "./owner";

/** Öffentliche Variablen dürfen nie etwas mit dem Anthropic-Schlüssel zu tun haben. */
export function findPublicAnthropicVariables(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter(
    (name) => /^(NEXT_PUBLIC|EXPO_PUBLIC)_/.test(name) && /ANTHROPIC|CLAUDE/i.test(name),
  );
}

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
  // Der Anthropic-Schlüssel ist ein Server-Secret: öffentliche Varianten landen im Browser-Bundle.
  for (const name of findPublicAnthropicVariables(env)) {
    problems.push(
      `${name} ist öffentlich und würde im Browser-Bundle landen. Bitte entfernen und nur ANTHROPIC_API_KEY (ohne NEXT_PUBLIC_) als Server-Secret setzen.`,
    );
  }
  return problems;
}

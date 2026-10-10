import { parsePublicEnv } from "@/lib/env";

import { parseConnectorConfig } from "./connector/config";
import { resolveOwnerId } from "./owner";

/**
 * Öffentliche Variablen (Browser- bzw. App-Bundle) dürfen nie Datenbank-Zugangsdaten oder
 * Connector-Geheimnisse tragen.
 */
export function findDangerousPublicVariables(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter(
    (name) =>
      /^(NEXT_PUBLIC|EXPO_PUBLIC)_/.test(name) &&
      /DATABASE|CONNECTOR|POSTGRES|PASSWORD|SECRET|SERVICE_ROLE/i.test(name),
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
  for (const name of findDangerousPublicVariables(env)) {
    problems.push(
      `${name} ist öffentlich und würde im Browser-Bundle landen. Zugangsdaten nur als Server-Variable ohne NEXT_PUBLIC_ setzen.`,
    );
  }
  return problems;
}

/**
 * Der Claude-Connector ist optional: Ist er unvollständig oder unsicher konfiguriert, bleibt er
 * abgeschaltet (404), die Website läuft weiter. Die Meldungen erscheinen beim Start im Log.
 */
export function connectorConfigurationWarnings(env: Record<string, string | undefined>): string[] {
  const result = parseConnectorConfig(env);
  if (result.ok || !result.enabled) return [];
  return result.problems.map((problem) => `Claude-Connector deaktiviert: ${problem}`);
}

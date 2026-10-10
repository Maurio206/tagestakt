/** Minimale Scopes des Connectors – mehr gibt es nicht. */
export const CONNECTOR_SCOPES = ["planning:read", "planning:draft", "planning:publish"] as const;

export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Readonly<Record<ConnectorScope, string>> = {
  "planning:read":
    "Planungsregeln, feste Termine (nur Zeiten und neutrale Arten), Entwurf und veröffentlichten Plan der laufenden und kommenden Wochen lesen",
  "planning:draft":
    "Geprüfte Wochenpläne speichern – auch Wiederholungen und Einzeltermine für eine Woche ändern, immer mit Grund – oder eigene Entwürfe verwerfen",
  "planning:publish":
    "Gültige Wochenpläne selbstständig veröffentlichen; die vorherige Version wird archiviert",
};

export function isConnectorScope(value: string): value is ConnectorScope {
  return (CONNECTOR_SCOPES as readonly string[]).includes(value);
}

/**
 * Liest den `scope`-Parameter. Fehlt er, gelten alle drei Scopes (der Eigentümer sieht sie
 * auf der Zustimmungsseite). Unbekannte Scopes → `null` (invalid_scope).
 */
export function parseRequestedScopes(raw: string | null | undefined): ConnectorScope[] | null {
  const parts = (raw ?? "").split(" ").filter(Boolean);
  if (parts.length === 0) return [...CONNECTOR_SCOPES];
  if (parts.some((scope) => !isConnectorScope(scope))) return null;
  return CONNECTOR_SCOPES.filter((scope) => parts.includes(scope));
}

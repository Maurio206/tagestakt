import "server-only";

import { authorizedClient } from "../auth";
import { getConnectorConfig } from "../connector/config";
import { type GrantSummary, listActiveGrants } from "../connector/oauth-store";

export type ConnectorOverview =
  | { configured: false; misconfigured: boolean }
  | { configured: true; mcpUrl: string; grants: GrantSummary[] };

/** Status des Claude-Connectors für die Einstellungen (nur eigene Freigaben, keine Tokens). */
export async function getConnectorOverview(): Promise<ConnectorOverview> {
  const { user } = await authorizedClient();
  const result = getConnectorConfig();
  if (!result.ok) return { configured: false, misconfigured: result.enabled };
  return {
    configured: true,
    mcpUrl: result.config.resource.href,
    grants: await listActiveGrants(result.config, user.id),
  };
}

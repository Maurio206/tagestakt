import "server-only";

import {
  type AuthInfo,
  type McpHttpHandler,
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  createMcpHandler,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
  verifyBearerToken,
} from "@modelcontextprotocol/server";

import { type ConnectorConfig, getConnectorConfig } from "./config";
import { createConnectorMcpServer } from "./mcp-server";
import {
  authorizationServerMetadata,
  handleRevocationRequest,
  handleTokenRequest,
  protectedResourceMetadata,
  resourceMetadataUrl,
} from "./oauth";
import { verifyAccessToken } from "./oauth-store";
import { CONNECTOR_SCOPES } from "./scopes";

/**
 * HTTP-Einstiegspunkte des Connectors (Streamable HTTP, zustandslos). Reihenfolge je Anfrage:
 * Konfiguration → Host/Origin (DNS-Rebinding, CSRF) → Ratenbegrenzung → Bearer-Token
 * (Ressource, Ablauf, Scope) → MCP-Handler des offiziellen SDK.
 */

const MAX_MCP_BODY_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Ratenbegrenzung (ein Prozess, ein Benutzer – im Speicher genügt)
// ---------------------------------------------------------------------------

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 1000) {
      for (const [entry, times] of this.hits) {
        if (times.every((time) => time <= since)) this.hits.delete(entry);
      }
    }
    return true;
  }
}

const limits = {
  mcpPerClientAddress: new RateLimiter(120, 60_000),
  mcpPerGrant: new RateLimiter(60, 60_000),
  oauthPerClientAddress: new RateLimiter(30, 60_000),
};

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unbekannt";
}

function tooMany(): Response {
  return new Response(JSON.stringify({ error: "too_many_requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": "60",
      "Cache-Control": "no-store",
    },
  });
}

function notAvailable(): Response {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function connectorConfigOrNull(): ConnectorConfig | null {
  const result = getConnectorConfig();
  return result.ok ? result.config : null;
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

let mcpHandler: { config: ConnectorConfig; handler: McpHttpHandler } | undefined;

function handlerFor(config: ConnectorConfig): McpHttpHandler {
  if (mcpHandler?.config !== config) {
    mcpHandler = {
      config,
      handler: createMcpHandler(() => createConnectorMcpServer({ config, now: () => new Date() }), {
        legacy: "stateless",
        responseMode: "json",
        maxRequestBodySize: MAX_MCP_BODY_BYTES,
        onerror: (error) => {
          // Nur der Fehlertyp – keine Anfrageinhalte, keine Tokens.
          console.error("[tagestakt] MCP-Anfrage abgewiesen", { name: error.name });
        },
      }),
    };
  }
  return mcpHandler.handler;
}

export async function authenticate(
  request: Request,
  config: ConnectorConfig,
  verify: typeof verifyAccessToken = verifyAccessToken,
): Promise<AuthInfo | Response> {
  const metadataUrl = resourceMetadataUrl(config);
  try {
    return await verifyBearerToken(request.headers.get("authorization"), {
      verifier: {
        async verifyAccessToken(token) {
          const access = await verify(config, token);
          if (!access) {
            throw new OAuthError(
              OAuthErrorCode.InvalidToken,
              "Ungültiges oder abgelaufenes Token.",
            );
          }
          return {
            token,
            clientId: access.clientId,
            scopes: access.scopes,
            expiresAt: access.expiresAt,
            resource: new URL(access.resource),
            extra: { ownerId: access.ownerId, grantId: access.grantId },
          };
        },
      },
      requiredScopes: ["planning:read"],
      resourceMetadataUrl: metadataUrl,
      expectedResource: config.resource,
    });
  } catch (error) {
    // Die Challenge nennt alle Scopes des Connectors, damit Claude sie in einem Schritt anfragt.
    return bearerAuthChallengeResponse(error, {
      requiredScopes: [...CONNECTOR_SCOPES],
      resourceMetadataUrl: metadataUrl,
    });
  }
}

export async function handleMcpHttp(request: Request): Promise<Response> {
  const config = connectorConfigOrNull();
  if (!config) return notAvailable();
  const rejected =
    hostHeaderValidationResponse(request, [config.hostname]) ??
    originValidationResponse(request, [config.hostname]);
  if (rejected) return rejected;
  if (!limits.mcpPerClientAddress.allow(clientAddress(request))) return tooMany();

  const auth = await authenticate(request, config);
  if (auth instanceof Response) return auth;
  if (!limits.mcpPerGrant.allow(String(auth.extra?.grantId))) return tooMany();
  return handlerFor(config).fetch(request, { authInfo: auth });
}

// ---------------------------------------------------------------------------
// OAuth-Metadaten, Token und Widerruf
// ---------------------------------------------------------------------------

export function handleOAuthMetadata(request: Request): Response {
  const config = connectorConfigOrNull();
  if (!config) return notAvailable();
  // Wurzel-Variante (ohne Pfad der Ressource) für Clients, die so nachfragen.
  if (
    new URL(request.url).pathname === "/.well-known/oauth-protected-resource" &&
    request.method === "GET"
  ) {
    return new Response(JSON.stringify(protectedResourceMetadata(config)), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }
  return (
    oauthMetadataResponse(request, {
      oauthMetadata: authorizationServerMetadata(config),
      resourceServerUrl: config.resource,
      scopesSupported: [...CONNECTOR_SCOPES],
      resourceName: "TagesTakt Wochenplanung",
      dangerouslyAllowInsecureIssuerUrl: config.insecureLocal,
    }) ?? notAvailable()
  );
}

export async function handleTokenHttp(request: Request): Promise<Response> {
  const config = connectorConfigOrNull();
  if (!config) return notAvailable();
  if (!limits.oauthPerClientAddress.allow(clientAddress(request))) return tooMany();
  try {
    return await handleTokenRequest(request, config);
  } catch (error) {
    console.error("[tagestakt] Token-Endpunkt fehlgeschlagen", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return new Response(JSON.stringify({ error: "server_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

export async function handleRevocationHttp(request: Request): Promise<Response> {
  const config = connectorConfigOrNull();
  if (!config) return notAvailable();
  if (!limits.oauthPerClientAddress.allow(clientAddress(request))) return tooMany();
  try {
    return await handleRevocationRequest(request, config);
  } catch (error) {
    console.error("[tagestakt] Widerruf fehlgeschlagen", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

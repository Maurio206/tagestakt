import "server-only";

import {
  type OAuthMetadata,
  type OAuthProtectedResourceMetadata,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/server";

import { type ClientMetadata, matchesRegisteredRedirect } from "./client-metadata";
import { type ConnectorConfig } from "./config";
import {
  type TokenResult,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
} from "./oauth-store";
import { CONNECTOR_SCOPES, type ConnectorScope, parseRequestedScopes } from "./scopes";
import { PKCE_CHALLENGE_PATTERN } from "./tokens";

/**
 * Minimaler OAuth-2.1-Autorisierungsserver für genau ein TagesTakt-Konto (MCP-Autorisierung):
 * Authorization Code + PKCE (S256), Client ID Metadata Documents, Ressourcenbindung (RFC 8707),
 * Refresh-Token-Rotation, Widerruf (RFC 7009). Keine dynamische Registrierung, keine
 * Client-Secrets, keine impliziten oder Passwort-Grants.
 */

export const OAUTH_PATHS = {
  authorize: "/oauth/authorize",
  token: "/api/oauth/token",
  revoke: "/api/oauth/revoke",
} as const;

export function authorizationServerMetadata(config: ConnectorConfig): OAuthMetadata {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.origin}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${config.origin}${OAUTH_PATHS.token}`,
    revocation_endpoint: `${config.origin}${OAUTH_PATHS.revoke}`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...CONNECTOR_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  } as OAuthMetadata;
}

export function protectedResourceMetadata(config: ConnectorConfig): OAuthProtectedResourceMetadata {
  return buildOAuthProtectedResourceMetadata({
    oauthMetadata: authorizationServerMetadata(config),
    resourceServerUrl: config.resource,
    scopesSupported: [...CONNECTOR_SCOPES],
    resourceName: "TagesTakt Wochenplanung",
    dangerouslyAllowInsecureIssuerUrl: config.insecureLocal,
  });
}

export function resourceMetadataUrl(config: ConnectorConfig): string {
  return getOAuthProtectedResourceMetadataUrl(config.resource);
}

// ---------------------------------------------------------------------------
// Autorisierungsanfrage
// ---------------------------------------------------------------------------

export interface AuthorizeRequest {
  client: ClientMetadata;
  redirectUri: string;
  scopes: ConnectorScope[];
  codeChallenge: string;
  state: string | null;
  resource: string;
}

export type AuthorizeParseResult =
  | { kind: "ok"; request: AuthorizeRequest }
  /** Client oder Redirect unbekannt: Fehlerseite, niemals weiterleiten. */
  | { kind: "fatal"; message: string }
  /** Gültiger Client, fehlerhafte Anfrage: Fehler an die registrierte Redirect-URI. */
  | { kind: "redirect"; location: string };

const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

export function authorizationRedirect(
  config: ConnectorConfig,
  redirectUri: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set("iss", config.issuer);
  return url.toString();
}

/**
 * Prüft eine Autorisierungsanfrage (RFC 6749 4.1.1, PKCE, RFC 8707). Reihenfolge wie im
 * Standard: Erst Client und Redirect – sind sie ungültig, wird nie umgeleitet.
 */
export async function parseAuthorizeRequest(
  params: URLSearchParams,
  config: ConnectorConfig,
  resolveClient: (clientId: string) => Promise<ClientMetadata | null>,
): Promise<AuthorizeParseResult> {
  const single = (name: string): string | null => {
    const values = params.getAll(name);
    return values.length === 1 ? (values[0] ?? null) : null;
  };
  const clientId = single("client_id");
  const redirectUri = single("redirect_uri");
  if (!clientId || !redirectUri) {
    return { kind: "fatal", message: "Die Anfrage enthält keinen gültigen Client." };
  }
  const client = await resolveClient(clientId);
  if (!client) {
    return {
      kind: "fatal",
      message: "Dieser Client ist für TagesTakt nicht zugelassen oder nicht erreichbar.",
    };
  }
  if (!matchesRegisteredRedirect(redirectUri, client.redirectUris)) {
    return {
      kind: "fatal",
      message: "Die Rücksprungadresse ist für diesen Client nicht registriert.",
    };
  }

  const state = single("state");
  const fail = (error: string, description: string): AuthorizeParseResult => ({
    kind: "redirect",
    location: authorizationRedirect(config, redirectUri, {
      error,
      error_description: description,
      state,
    }),
  });

  if (AUTHORIZE_PARAMS.some((name) => params.getAll(name).length > 1)) {
    return fail("invalid_request", "Parameter mehrfach angegeben.");
  }
  if (state !== null && state.length > 1024) {
    return fail("invalid_request", "state ist zu lang.");
  }
  if (single("response_type") !== "code") {
    return fail("unsupported_response_type", "Nur response_type=code wird unterstützt.");
  }
  const codeChallenge = single("code_challenge");
  if (single("code_challenge_method") !== "S256" || !codeChallenge) {
    return fail("invalid_request", "PKCE mit code_challenge_method=S256 ist Pflicht.");
  }
  if (!PKCE_CHALLENGE_PATTERN.test(codeChallenge)) {
    return fail("invalid_request", "code_challenge ist ungültig.");
  }
  const scopes = parseRequestedScopes(single("scope"));
  if (!scopes) return fail("invalid_scope", "Unbekannter Scope angefragt.");
  const resource = single("resource");
  if (resource !== null && resource !== config.resource.href) {
    return fail("invalid_target", "Unbekannte Ressource.");
  }
  return {
    kind: "ok",
    request: {
      client,
      redirectUri,
      scopes,
      codeChallenge,
      state,
      resource: config.resource.href,
    },
  };
}

// ---------------------------------------------------------------------------
// Token- und Widerrufs-Endpunkt
// ---------------------------------------------------------------------------

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...headers },
  });
}

function oauthError(error: string, description: string, status = 400) {
  return oauthJson({ error, error_description: description }, status);
}

const MAX_FORM_BYTES = 8 * 1024;

/** Liest einen x-www-form-urlencoded-Body; mehrfach angegebene Parameter sind unzulässig. */
async function readForm(request: Request): Promise<Map<string, string> | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_FORM_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES) return null;
  const params = new URLSearchParams(text);
  const form = new Map<string, string>();
  for (const [key, value] of params) {
    if (form.has(key)) return null;
    form.set(key, value);
  }
  return form;
}

export interface TokenEndpointDeps {
  exchange: typeof exchangeAuthorizationCode;
  refresh: typeof refreshAccessToken;
}

const DEFAULT_TOKEN_DEPS: TokenEndpointDeps = {
  exchange: exchangeAuthorizationCode,
  refresh: refreshAccessToken,
};

function tokenResponse(result: TokenResult): Response {
  if (!result.ok) return oauthError(result.failure.error, result.failure.description);
  return oauthJson(result.tokens);
}

export async function handleTokenRequest(
  request: Request,
  config: ConnectorConfig,
  deps: TokenEndpointDeps = DEFAULT_TOKEN_DEPS,
): Promise<Response> {
  if (request.method !== "POST") {
    return oauthError("invalid_request", "Nur POST.", 405);
  }
  // Öffentliche Clients: keine Client-Secrets (Basic-Auth wird nicht akzeptiert).
  if (request.headers.get("authorization")) {
    return oauthError("invalid_client", "Client-Authentifizierung wird nicht unterstützt.", 401);
  }
  const form = await readForm(request);
  if (!form) return oauthError("invalid_request", "Ungültiger Formular-Body.");
  const clientId = form.get("client_id");
  if (!clientId) return oauthError("invalid_request", "client_id fehlt.");
  const resource = form.get("resource") ?? null;

  switch (form.get("grant_type")) {
    case "authorization_code": {
      const code = form.get("code");
      const redirectUri = form.get("redirect_uri");
      const codeVerifier = form.get("code_verifier");
      if (!code || !redirectUri || !codeVerifier) {
        return oauthError("invalid_request", "code, redirect_uri und code_verifier sind Pflicht.");
      }
      return tokenResponse(
        await deps.exchange(config, { code, clientId, redirectUri, codeVerifier, resource }),
      );
    }
    case "refresh_token": {
      const refreshToken = form.get("refresh_token");
      if (!refreshToken) return oauthError("invalid_request", "refresh_token fehlt.");
      return tokenResponse(
        await deps.refresh(config, {
          refreshToken,
          clientId,
          scope: form.get("scope") ?? null,
          resource,
        }),
      );
    }
    default:
      return oauthError("unsupported_grant_type", "Nur authorization_code und refresh_token.");
  }
}

/** RFC 7009: Antwort immer 200 – auch für unbekannte Tokens. */
export async function handleRevocationRequest(
  request: Request,
  config: ConnectorConfig,
  revoke: typeof revokeToken = revokeToken,
): Promise<Response> {
  if (request.method !== "POST") return oauthError("invalid_request", "Nur POST.", 405);
  const form = await readForm(request);
  const token = form?.get("token");
  if (!form || !token) return oauthError("invalid_request", "token fehlt.");
  await revoke(config, { token, clientId: form.get("client_id") ?? null });
  return new Response(null, { status: 200, headers: NO_STORE });
}

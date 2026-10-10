// @vitest-environment node
/**
 * Claude-Connector ohne Datenbank: Konfiguration, Tokens/PKCE, Client-Metadaten (CIMD),
 * Autorisierungsanfrage, Token- und Widerrufs-Endpunkt. Alle Werte frei erfunden.
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ClientMetadata,
  clearClientMetadataCache,
  isAcceptableClientId,
  matchesRegisteredRedirect,
  resolveClientMetadata,
} from "./client-metadata";
import { type ConnectorConfig, parseConnectorConfig } from "./config";
import {
  authorizationServerMetadata,
  handleRevocationRequest,
  handleTokenRequest,
  parseAuthorizeRequest,
  protectedResourceMetadata,
} from "./oauth";
import { CONNECTOR_SCOPES, parseRequestedScopes } from "./scopes";
import { generateToken, isTokenOfKind, sha256Hex, verifyPkceS256 } from "./tokens";

const CLIENT_ID = "https://claude.ai/oauth/mcp-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const DB_URL = "postgres://tagestakt_connector:nur-ein-testwert@127.0.0.1:5432/postgres";

function config(overrides: Partial<ConnectorConfig> = {}): ConnectorConfig {
  const result = parseConnectorConfig({
    TAGESTAKT_PUBLIC_URL: "https://plan.tagestakt.test",
    CONNECTOR_DATABASE_URL: DB_URL,
    NODE_ENV: "production",
  });
  if (!result.ok) throw new Error(result.problems.join("\n"));
  return { ...result.config, ...overrides };
}

const client: ClientMetadata = {
  clientId: CLIENT_ID,
  clientName: "Claude",
  redirectUris: [CALLBACK, "http://localhost/callback"],
};

function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const VERIFIER = "v".repeat(20) + "erifier-0123456789-abcdefghijk";

function authorizeParams(overrides: Record<string, string | null> = {}): URLSearchParams {
  const values: Record<string, string | null> = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK,
    code_challenge: challengeOf(VERIFIER),
    code_challenge_method: "S256",
    state: "zustand-123",
    scope: "planning:read planning:draft planning:publish",
    resource: "https://plan.tagestakt.test/mcp",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null) params.set(key, value);
  return params;
}

const resolveKnown = async (id: string) => (id === CLIENT_ID ? client : null);

describe("Konfiguration", () => {
  it("ohne Variablen bewusst abgeschaltet – kein Fehler", () => {
    expect(parseConnectorConfig({ NODE_ENV: "production" })).toEqual({
      ok: false,
      enabled: false,
      problems: [],
    });
  });

  it("leitet Issuer, Ressource und Host aus der öffentlichen Adresse ab", () => {
    const value = config();
    expect(value.issuer).toBe("https://plan.tagestakt.test");
    expect(value.resource.href).toBe("https://plan.tagestakt.test/mcp");
    expect(value.hostname).toBe("plan.tagestakt.test");
    expect(value.clientHosts).toEqual(["claude.ai", "claude.com"]);
  });

  it("lehnt unsichere oder zu weit berechtigte Konfigurationen ab – ohne Werte zu nennen", () => {
    const cases: Record<string, string | undefined>[] = [
      { TAGESTAKT_PUBLIC_URL: "http://plan.tagestakt.test", CONNECTOR_DATABASE_URL: DB_URL },
      { TAGESTAKT_PUBLIC_URL: "https://plan.tagestakt.test/pfad", CONNECTOR_DATABASE_URL: DB_URL },
      {
        TAGESTAKT_PUBLIC_URL: "https://plan.tagestakt.test",
        CONNECTOR_DATABASE_URL: "postgres://postgres:nur-ein-testwert@127.0.0.1/postgres",
      },
      {
        TAGESTAKT_PUBLIC_URL: "https://plan.tagestakt.test",
        CONNECTOR_DATABASE_URL: "postgres://service_role:nur-ein-testwert@127.0.0.1/x",
      },
      { TAGESTAKT_PUBLIC_URL: "https://plan.tagestakt.test" },
      { TAGESTAKT_PUBLIC_URL: "https://localhost", CONNECTOR_DATABASE_URL: DB_URL },
    ];
    for (const env of cases) {
      const result = parseConnectorConfig({ ...env, NODE_ENV: "production" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.enabled).toBe(true);
        expect(result.problems.join(" ")).not.toContain("nur-ein-testwert");
      }
    }
  });
});

describe("Tokens und PKCE", () => {
  it("erzeugt 256-Bit-Zufallswerte mit Präfix und speichert nur Hashes", () => {
    const token = generateToken("access");
    expect(token).toMatch(/^tt_at_[A-Za-z0-9_-]{43}$/);
    expect(isTokenOfKind(token, "access")).toBe(true);
    expect(isTokenOfKind(token, "refresh")).toBe(false);
    expect(isTokenOfKind(`${token}x`, "access")).toBe(false);
    expect(generateToken("access")).not.toBe(token);
    expect(sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prüft S256 und lehnt plain sowie falsche Verifier ab", () => {
    const challenge = challengeOf(VERIFIER);
    expect(verifyPkceS256(VERIFIER, challenge)).toBe(true);
    expect(verifyPkceS256(`${VERIFIER}x`, challenge)).toBe(false);
    expect(verifyPkceS256(VERIFIER, VERIFIER)).toBe(false);
    expect(verifyPkceS256("zu-kurz", challengeOf("zu-kurz"))).toBe(false);
  });

  it("Scopes: nur die drei Planungs-Scopes", () => {
    expect(parseRequestedScopes(null)).toEqual([...CONNECTOR_SCOPES]);
    expect(parseRequestedScopes("planning:read")).toEqual(["planning:read"]);
    expect(parseRequestedScopes("planning:read admin")).toBeNull();
  });
});

describe("Client ID Metadata Documents", () => {
  beforeEach(() => clearClientMetadataCache());

  const document = (overrides: Record<string, unknown> = {}) => ({
    client_id: CLIENT_ID,
    client_name: "Claude",
    redirect_uris: [CALLBACK],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...overrides,
  });
  const fetchJson = (body: unknown, init: ResponseInit = {}) =>
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200, ...init }));

  it("akzeptiert nur https-URLs der freigegebenen Hosts", () => {
    const value = config();
    expect(isAcceptableClientId(CLIENT_ID, value)).toBe(true);
    for (const id of [
      "http://claude.ai/oauth/x",
      "https://claude.ai",
      "https://boese.tagestakt.test/client.json",
      "https://claude.ai.boese.tagestakt.test/x",
      // Zugangsdaten in der URL; zusammengesetzt, damit der Secret-Scan keine E-Mail-Adresse sieht.
      "https://nutzer:pw@" + "claude.ai/x",
      "https://claude.ai/x#frag",
      "https://claude.ai/a/../b",
    ]) {
      expect(isAcceptableClientId(id, value)).toBe(false);
    }
  });

  it("lädt und prüft das Dokument (ohne Weiterleitungen, mit Zeitlimit)", async () => {
    const fetchImpl = fetchJson(document());
    const metadata = await resolveClientMetadata(CLIENT_ID, config(), fetchImpl);
    expect(metadata).toEqual({
      clientId: CLIENT_ID,
      clientName: "Claude",
      redirectUris: [CALLBACK],
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("lehnt abweichende IDs, Client-Secrets, fremde Redirects und zu große Dokumente ab", async () => {
    const value = config();
    for (const body of [
      document({ client_id: "https://claude.ai/anderer-client" }),
      document({ token_endpoint_auth_method: "client_secret_basic" }),
      document({ redirect_uris: ["https://boese.tagestakt.test/callback"] }),
      document({ grant_types: ["client_credentials"] }),
      { ...document(), client_name: "x".repeat(20_000) },
    ]) {
      clearClientMetadataCache();
      expect(await resolveClientMetadata(CLIENT_ID, value, fetchJson(body))).toBeNull();
    }
    const failing = vi.fn(async () => {
      throw new Error("netz weg");
    });
    expect(await resolveClientMetadata(CLIENT_ID, value, failing)).toBeNull();
    expect(
      await resolveClientMetadata(CLIENT_ID, value, fetchJson(document(), { status: 404 })),
    ).toBeNull();
  });

  it("bereinigt den Anzeigenamen", async () => {
    const metadata = await resolveClientMetadata(
      CLIENT_ID,
      config(),
      fetchJson(document({ client_name: "Claude‮\u0000 Desktop" })),
    );
    expect(metadata?.clientName).toBe("Claude Desktop");
  });

  it("Redirect-Vergleich exakt, Loopback mit beliebigem Port (RFC 8252)", () => {
    expect(matchesRegisteredRedirect(CALLBACK, client.redirectUris)).toBe(true);
    expect(matchesRegisteredRedirect(`${CALLBACK}/x`, client.redirectUris)).toBe(false);
    expect(matchesRegisteredRedirect("http://localhost:53682/callback", client.redirectUris)).toBe(
      true,
    );
    expect(matchesRegisteredRedirect("http://localhost:53682/anders", client.redirectUris)).toBe(
      false,
    );
    expect(
      matchesRegisteredRedirect("http://boese.tagestakt.test/callback", client.redirectUris),
    ).toBe(false);
  });
});

describe("Autorisierungsanfrage", () => {
  it("gültige Anfrage mit PKCE, Ressource und Scopes", async () => {
    const result = await parseAuthorizeRequest(authorizeParams(), config(), resolveKnown);
    expect(result).toMatchObject({
      kind: "ok",
      request: {
        redirectUri: CALLBACK,
        scopes: ["planning:read", "planning:draft", "planning:publish"],
        state: "zustand-123",
        resource: "https://plan.tagestakt.test/mcp",
      },
    });
  });

  it("unbekannter Client oder fremder Redirect: Fehlerseite, nie Weiterleitung", async () => {
    const value = config();
    for (const params of [
      authorizeParams({ client_id: "https://boese.tagestakt.test/client.json" }),
      authorizeParams({ redirect_uri: "https://boese.tagestakt.test/callback" }),
      authorizeParams({ client_id: null }),
    ]) {
      expect((await parseAuthorizeRequest(params, value, resolveKnown)).kind).toBe("fatal");
    }
  });

  it("fehlerhafte Anfragen gehen mit Fehlercode, state und iss an die Redirect-URI", async () => {
    const value = config();
    const cases: [Record<string, string | null>, string][] = [
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge: null }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ scope: "planning:read admin" }, "invalid_scope"],
      [{ resource: "https://andere.tagestakt.test/mcp" }, "invalid_target"],
    ];
    for (const [overrides, error] of cases) {
      const result = await parseAuthorizeRequest(authorizeParams(overrides), value, resolveKnown);
      expect(result.kind).toBe("redirect");
      if (result.kind !== "redirect") continue;
      const location = new URL(result.location);
      expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
      expect(location.searchParams.get("error")).toBe(error);
      expect(location.searchParams.get("state")).toBe("zustand-123");
      expect(location.searchParams.get("iss")).toBe("https://plan.tagestakt.test");
    }
    const duplicated = authorizeParams();
    duplicated.append("scope", "planning:read");
    const result = await parseAuthorizeRequest(duplicated, value, resolveKnown);
    expect(result.kind === "redirect" && result.location).toContain("error=invalid_request");
  });
});

describe("Metadaten", () => {
  it("Autorisierungsserver: nur Code + PKCE S256, öffentliche Clients, CIMD, keine Registrierung", () => {
    const metadata = authorizationServerMetadata(config()) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      issuer: "https://plan.tagestakt.test",
      authorization_endpoint: "https://plan.tagestakt.test/oauth/authorize",
      token_endpoint: "https://plan.tagestakt.test/api/oauth/token",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      scopes_supported: [...CONNECTOR_SCOPES],
    });
    expect(metadata).not.toHaveProperty("registration_endpoint");
  });

  it("geschützte Ressource verweist auf den eigenen Autorisierungsserver", () => {
    expect(protectedResourceMetadata(config())).toMatchObject({
      resource: "https://plan.tagestakt.test/mcp",
      authorization_servers: ["https://plan.tagestakt.test"],
      scopes_supported: [...CONNECTOR_SCOPES],
    });
  });
});

describe("Token-Endpunkt", () => {
  const deps = () => ({
    exchange: vi.fn(async () => ({
      ok: true as const,
      tokens: {
        access_token: "tt_at_x",
        token_type: "Bearer" as const,
        expires_in: 3600,
        refresh_token: "tt_rt_x",
        scope: "planning:read",
      },
    })),
    refresh: vi.fn(async () => ({
      ok: false as const,
      failure: { error: "invalid_grant" as const, description: "abgelaufen" },
    })),
  });
  const post = (body: Record<string, string>, headers: Record<string, string> = {}) =>
    new Request("https://plan.tagestakt.test/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(body).toString(),
    });

  it("authorization_code: reicht Code, Verifier, Redirect und Ressource weiter – no-store", async () => {
    const d = deps();
    const response = await handleTokenRequest(
      post({
        grant_type: "authorization_code",
        code: "tt_ac_x",
        client_id: CLIENT_ID,
        redirect_uri: CALLBACK,
        code_verifier: VERIFIER,
        resource: "https://plan.tagestakt.test/mcp",
      }),
      config(),
      d,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(d.exchange).toHaveBeenCalledWith(expect.anything(), {
      code: "tt_ac_x",
      clientId: CLIENT_ID,
      redirectUri: CALLBACK,
      codeVerifier: VERIFIER,
      resource: "https://plan.tagestakt.test/mcp",
    });
  });

  it("Fehlerfälle nach RFC 6749", async () => {
    const d = deps();
    const value = config();
    const cases: [Request, number, string][] = [
      [post({ grant_type: "password", client_id: CLIENT_ID }), 400, "unsupported_grant_type"],
      [post({ grant_type: "authorization_code", client_id: CLIENT_ID }), 400, "invalid_request"],
      [post({ grant_type: "refresh_token" }), 400, "invalid_request"],
      [
        post(
          { grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: "tt_rt_x" },
          { authorization: "Basic eDp5" },
        ),
        401,
        "invalid_client",
      ],
      [
        new Request("https://plan.tagestakt.test/api/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        400,
        "invalid_request",
      ],
      [
        post({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: "tt_rt_x" }),
        400,
        "invalid_grant",
      ],
    ];
    for (const [request, status, error] of cases) {
      const response = await handleTokenRequest(request, value, d);
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: string }).error).toBe(error);
    }
    expect(d.exchange).not.toHaveBeenCalled();
  });

  it("Widerruf antwortet immer mit 200", async () => {
    const revoke = vi.fn(async () => undefined);
    const request = new Request("https://plan.tagestakt.test/api/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "tt_rt_unbekannt", client_id: CLIENT_ID }).toString(),
    });
    const response = await handleRevocationRequest(request, config(), revoke);
    expect(response.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith(expect.anything(), {
      token: "tt_rt_unbekannt",
      clientId: CLIENT_ID,
    });
  });
});

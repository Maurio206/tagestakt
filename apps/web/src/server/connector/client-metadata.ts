import "server-only";

import { z } from "zod";

import { type ConnectorConfig } from "./config";

/**
 * Client ID Metadata Documents (CIMD): Claude identifiziert sich mit einer https-URL als
 * `client_id`; dort liegt ein JSON-Dokument mit Name und erlaubten Redirect-URIs. Eine offene
 * dynamische Registrierung gibt es bewusst nicht.
 *
 * Schutzmaßnahmen: nur https-URLs auf den freigegebenen Hosts (claude.ai, claude.com), keine
 * Weiterleitungen, Zeit- und Größenlimit, das Dokument muss genau diese `client_id` nennen und
 * einen öffentlichen Client (`token_endpoint_auth_method: none`) beschreiben.
 */

export interface ClientMetadata {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const MAX_DOCUMENT_BYTES = 16 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const documentSchema = z.object({
  client_id: z.string().max(512),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().max(512)).min(1).max(10),
  token_endpoint_auth_method: z.string().max(64).optional(),
  grant_types: z.array(z.string().max(64)).max(10).optional(),
  response_types: z.array(z.string().max(64)).max(10).optional(),
});

const cache = new Map<string, { metadata: ClientMetadata; expires: number }>();

/** Formale Prüfung der client_id-URL (vor jedem Abruf). */
export function isAcceptableClientId(clientId: string, config: ConnectorConfig): boolean {
  if (clientId.length > 512) return false;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  const secure =
    url.protocol === "https:" || (config.insecureLocal && LOOPBACK_HOSTS.has(url.hostname));
  return (
    secure &&
    url.href === clientId &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.pathname.length > 1 &&
    !url.pathname.split("/").some((segment) => segment === "." || segment === "..") &&
    config.clientHosts.includes(url.hostname)
  );
}

function cleanName(value: string | undefined, fallback: string): string {
  const name = (value ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return name || fallback;
}

/** Erlaubte Redirect-URIs: https auf freigegebenem Host oder http-Loopback (RFC 8252). */
function isAcceptableRedirectUri(value: string, config: ConnectorConfig): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return url.protocol === "https:" && config.clientHosts.includes(url.hostname);
}

/**
 * Stimmt die Redirect-URI der Anfrage mit einer registrierten überein? Exakt – außer bei
 * http-Loopback-Adressen, deren Port frei wählbar ist (RFC 8252, Abschnitt 7.3).
 */
export function matchesRegisteredRedirect(
  requested: string,
  registered: readonly string[],
): boolean {
  if (registered.includes(requested)) return true;
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return false;
  return registered.some((candidate) => {
    try {
      const allowed = new URL(candidate);
      return (
        allowed.protocol === "http:" &&
        allowed.hostname === url.hostname &&
        allowed.pathname === url.pathname &&
        allowed.search === url.search
      );
    } catch {
      return false;
    }
  });
}

async function readLimited(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_DOCUMENT_BYTES) return null;
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) return null;
  return new TextDecoder().decode(buffer);
}

/** Lädt und prüft die Client-Metadaten. `null` = unbekannter bzw. unzulässiger Client. */
export async function resolveClientMetadata(
  clientId: string,
  config: ConnectorConfig,
  fetchImpl: FetchLike = fetch,
): Promise<ClientMetadata | null> {
  if (!isAcceptableClientId(clientId, config)) return null;
  const hit = cache.get(clientId);
  if (hit && hit.expires > Date.now()) return hit.metadata;

  let text: string | null;
  try {
    const response = await fetchImpl(clientId, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    text = await readLimited(response);
  } catch {
    return null;
  }
  if (text === null) return null;

  let parsed: z.infer<typeof documentSchema>;
  try {
    const result = documentSchema.safeParse(JSON.parse(text));
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }
  if (parsed.client_id !== clientId) return null;
  if ((parsed.token_endpoint_auth_method ?? "none") !== "none") return null;
  if (parsed.grant_types && !parsed.grant_types.includes("authorization_code")) return null;
  if (parsed.response_types && !parsed.response_types.includes("code")) return null;
  const redirectUris = parsed.redirect_uris.filter((uri) => isAcceptableRedirectUri(uri, config));
  if (redirectUris.length === 0) return null;

  const metadata: ClientMetadata = {
    clientId,
    clientName: cleanName(parsed.client_name, new URL(clientId).host),
    redirectUris,
  };
  cache.set(clientId, { metadata, expires: Date.now() + CACHE_TTL_MS });
  return metadata;
}

/** Nur für Tests. */
export function clearClientMetadataCache(): void {
  cache.clear();
}

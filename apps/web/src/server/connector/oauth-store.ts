import "server-only";

import { isAllowedUser } from "../owner";
import { type ConnectorConfig } from "./config";
import { type Tx, connectorTransaction } from "./db";
import { CONNECTOR_SCOPES, type ConnectorScope, isConnectorScope } from "./scopes";
import { generateToken, isTokenOfKind, sha256Hex, verifyPkceS256 } from "./tokens";

/**
 * Speicher des Autorisierungsservers (Schema connector). Codes, Tokens und Bestätigungen liegen
 * nur als SHA-256-Hash vor; Klartext existiert nur in der jeweiligen Antwort an Claude.
 */

export const LIFETIMES = {
  codeSeconds: 5 * 60,
  accessSeconds: 60 * 60,
  refreshSeconds: 60 * 24 * 60 * 60,
  /** Erneute Vorlage eines eben getauschten Refresh-Tokens: Wettlauf, kein Diebstahl. */
  refreshReuseGraceSeconds: 60,
} as const;

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export type OAuthFailure = {
  error: "invalid_grant" | "invalid_request" | "invalid_target" | "invalid_scope";
  description: string;
};

export type TokenResult =
  { ok: true; tokens: TokenResponse } | { ok: false; failure: OAuthFailure };

export interface VerifiedAccess {
  ownerId: string;
  grantId: string;
  clientId: string;
  scopes: ConnectorScope[];
  resource: string;
  /** Sekunden seit Epoche. */
  expiresAt: number;
}

function failure(error: OAuthFailure["error"], description: string): TokenResult {
  return { ok: false, failure: { error, description } };
}

function normalizeScopes(scopes: readonly string[]): ConnectorScope[] {
  return CONNECTOR_SCOPES.filter((scope) => scopes.includes(scope));
}

/** Nach ausdrücklicher Zustimmung des Eigentümers: einmaliger Autorisierungscode. */
export async function createAuthorizationCode(
  config: ConnectorConfig,
  input: {
    ownerId: string;
    clientId: string;
    clientName: string;
    redirectUri: string;
    codeChallenge: string;
    scopes: readonly ConnectorScope[];
    resource: string;
  },
): Promise<string> {
  const code = generateToken("code");
  await connectorTransaction(config, async (tx) => {
    // Abgelaufene Codes nebenbei entfernen.
    await tx`delete from connector.oauth_authorization_codes
              where expires_at < now() - interval '1 day'`;
    await tx`insert into connector.oauth_authorization_codes (
               code_hash, owner_id, client_id, client_name, redirect_uri, code_challenge,
               scopes, resource, expires_at)
             values (${sha256Hex(code)}, ${input.ownerId}, ${input.clientId}, ${input.clientName},
                     ${input.redirectUri}, ${input.codeChallenge},
                     ${tx.array(normalizeScopes(input.scopes))}::text[], ${input.resource},
                     now() + make_interval(secs => ${LIFETIMES.codeSeconds}))`;
  });
  return code;
}

async function revokeGrantInTx(tx: Tx, grantId: string): Promise<void> {
  await tx`update connector.oauth_grants set revoked_at = coalesce(revoked_at, now())
            where id = ${grantId}`;
  await tx`delete from connector.oauth_tokens where grant_id = ${grantId}`;
  await tx`delete from connector.publish_confirmations where grant_id = ${grantId}`;
}

async function issueTokens(
  tx: Tx,
  grantId: string,
  scopes: readonly ConnectorScope[],
): Promise<TokenResponse> {
  const accessToken = generateToken("access");
  const refreshToken = generateToken("refresh");
  await tx`delete from connector.oauth_tokens
            where grant_id = ${grantId} and expires_at < now()`;
  await tx`insert into connector.oauth_tokens (token_hash, grant_id, kind, expires_at)
           values (${sha256Hex(accessToken)}, ${grantId}, 'access',
                   now() + make_interval(secs => ${LIFETIMES.accessSeconds})),
                  (${sha256Hex(refreshToken)}, ${grantId}, 'refresh',
                   now() + make_interval(secs => ${LIFETIMES.refreshSeconds}))`;
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: LIFETIMES.accessSeconds,
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  };
}

/** authorization_code-Grant mit PKCE (S256), Redirect- und Ressourcenbindung. */
export async function exchangeAuthorizationCode(
  config: ConnectorConfig,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string | null;
  },
): Promise<TokenResult> {
  if (!isTokenOfKind(input.code, "code")) {
    return failure("invalid_grant", "Unbekannter oder abgelaufener Code.");
  }
  return connectorTransaction(config, async (tx) => {
    const [code] = await tx<
      {
        owner_id: string;
        client_id: string;
        client_name: string;
        redirect_uri: string;
        code_challenge: string;
        scopes: string[];
        resource: string;
        expired: boolean;
        used: boolean;
        grant_id: string | null;
      }[]
    >`select owner_id, client_id, client_name, redirect_uri, code_challenge, scopes, resource,
             expires_at < now() as expired, used_at is not null as used, grant_id
        from connector.oauth_authorization_codes
       where code_hash = ${sha256Hex(input.code)}
         for update`;
    if (!code) return failure("invalid_grant", "Unbekannter oder abgelaufener Code.");
    if (code.used) {
      // Erneute Vorlage: möglicher Diebstahl → daraus entstandene Freigabe widerrufen.
      if (code.grant_id) await revokeGrantInTx(tx, code.grant_id);
      return failure("invalid_grant", "Der Code wurde bereits verwendet.");
    }
    if (code.expired) return failure("invalid_grant", "Unbekannter oder abgelaufener Code.");
    if (code.client_id !== input.clientId || code.redirect_uri !== input.redirectUri) {
      return failure("invalid_grant", "Code gehört zu einem anderen Client oder Redirect.");
    }
    if (!verifyPkceS256(input.codeVerifier, code.code_challenge)) {
      return failure("invalid_grant", "PKCE-Prüfung fehlgeschlagen.");
    }
    if (input.resource !== null && input.resource !== code.resource) {
      return failure("invalid_target", "Die angefragte Ressource passt nicht zum Code.");
    }
    if (code.resource !== config.resource.href || !isAllowedUser(code.owner_id)) {
      return failure("invalid_grant", "Der Code ist nicht mehr gültig.");
    }

    // Je Client höchstens eine aktive Freigabe: eine neue Verbindung ersetzt die alte.
    const previous = await tx<{ id: string }[]>`
      select id from connector.oauth_grants
       where owner_id = ${code.owner_id} and client_id = ${code.client_id} and revoked_at is null`;
    for (const grant of previous) await revokeGrantInTx(tx, grant.id);

    const scopes = normalizeScopes(code.scopes);
    const [grant] = await tx<{ id: string }[]>`
      insert into connector.oauth_grants (owner_id, client_id, client_name, scopes, resource)
      values (${code.owner_id}, ${code.client_id}, ${code.client_name}, ${tx.array(scopes)}::text[], ${code.resource})
      returning id`;
    if (!grant) throw new Error("grant_insert_failed");
    await tx`update connector.oauth_authorization_codes
                set used_at = now(), grant_id = ${grant.id}
              where code_hash = ${sha256Hex(input.code)}`;
    return { ok: true, tokens: await issueTokens(tx, grant.id, scopes) };
  });
}

/** refresh_token-Grant mit Rotation und Erkennung wiederverwendeter Tokens. */
export async function refreshAccessToken(
  config: ConnectorConfig,
  input: { refreshToken: string; clientId: string; scope: string | null; resource: string | null },
): Promise<TokenResult> {
  if (!isTokenOfKind(input.refreshToken, "refresh")) {
    return failure("invalid_grant", "Unbekanntes oder abgelaufenes Refresh-Token.");
  }
  return connectorTransaction(config, async (tx) => {
    const [token] = await tx<
      {
        grant_id: string;
        expired: boolean;
        rotated_seconds_ago: number | null;
        owner_id: string;
        client_id: string;
        scopes: string[];
        resource: string;
        revoked: boolean;
      }[]
    >`select t.grant_id, t.expires_at < now() as expired,
             extract(epoch from (now() - t.rotated_at))::float8 as rotated_seconds_ago,
             g.owner_id, g.client_id, g.scopes, g.resource, g.revoked_at is not null as revoked
        from connector.oauth_tokens t
        join connector.oauth_grants g on g.id = t.grant_id
       where t.token_hash = ${sha256Hex(input.refreshToken)} and t.kind = 'refresh'
         for update of t, g`;
    if (!token || token.revoked || token.expired) {
      return failure("invalid_grant", "Unbekanntes oder abgelaufenes Refresh-Token.");
    }
    if (token.client_id !== input.clientId) {
      return failure("invalid_grant", "Das Refresh-Token gehört zu einem anderen Client.");
    }
    if (token.rotated_seconds_ago !== null) {
      // Bereits getauscht: kurz danach ein Wettlauf, später ein Hinweis auf Diebstahl.
      if (token.rotated_seconds_ago > LIFETIMES.refreshReuseGraceSeconds) {
        await revokeGrantInTx(tx, token.grant_id);
      }
      return failure("invalid_grant", "Das Refresh-Token wurde bereits verwendet.");
    }
    if (input.resource !== null && input.resource !== token.resource) {
      return failure("invalid_target", "Die angefragte Ressource passt nicht zur Freigabe.");
    }
    if (token.resource !== config.resource.href || !isAllowedUser(token.owner_id)) {
      return failure("invalid_grant", "Die Freigabe ist nicht mehr gültig.");
    }
    const granted = normalizeScopes(token.scopes);
    if (input.scope !== null) {
      const requested = input.scope.split(" ").filter(Boolean);
      if (requested.some((scope) => !isConnectorScope(scope) || !granted.includes(scope))) {
        return failure("invalid_scope", "Angefragter Scope wurde nicht freigegeben.");
      }
    }
    await tx`update connector.oauth_tokens set rotated_at = now()
              where token_hash = ${sha256Hex(input.refreshToken)}`;
    return { ok: true, tokens: await issueTokens(tx, token.grant_id, granted) };
  });
}

/** Prüft ein Access-Token. Liefert nur gültige, nicht widerrufene Freigaben des Eigentümers. */
export async function verifyAccessToken(
  config: ConnectorConfig,
  accessToken: string,
): Promise<VerifiedAccess | null> {
  if (!isTokenOfKind(accessToken, "access")) return null;
  return connectorTransaction(config, async (tx) => {
    const [row] = await tx<
      {
        grant_id: string;
        owner_id: string;
        client_id: string;
        scopes: string[];
        resource: string;
        expires_epoch: number;
      }[]
    >`select t.grant_id, g.owner_id, g.client_id, g.scopes, g.resource,
             extract(epoch from t.expires_at)::float8 as expires_epoch
        from connector.oauth_tokens t
        join connector.oauth_grants g on g.id = t.grant_id
       where t.token_hash = ${sha256Hex(accessToken)} and t.kind = 'access'
         and t.expires_at > now() and g.revoked_at is null`;
    if (!row || !isAllowedUser(row.owner_id)) return null;
    await tx`update connector.oauth_grants set last_used_at = now()
              where id = ${row.grant_id}
                and (last_used_at is null or last_used_at < now() - interval '5 minutes')`;
    return {
      ownerId: row.owner_id,
      grantId: row.grant_id,
      clientId: row.client_id,
      scopes: normalizeScopes(row.scopes),
      resource: row.resource,
      expiresAt: Math.floor(row.expires_epoch),
    };
  });
}

/** RFC 7009: Refresh-Token → ganze Freigabe widerrufen; Access-Token → nur dieses Token. */
export async function revokeToken(
  config: ConnectorConfig,
  input: { token: string; clientId: string | null },
): Promise<void> {
  const kind = isTokenOfKind(input.token, "refresh")
    ? "refresh"
    : isTokenOfKind(input.token, "access")
      ? "access"
      : null;
  if (!kind) return;
  await connectorTransaction(config, async (tx) => {
    const [row] = await tx<{ grant_id: string; client_id: string }[]>`
      select t.grant_id, g.client_id
        from connector.oauth_tokens t
        join connector.oauth_grants g on g.id = t.grant_id
       where t.token_hash = ${sha256Hex(input.token)} and t.kind = ${kind}`;
    if (!row || (input.clientId !== null && row.client_id !== input.clientId)) return;
    if (kind === "refresh") {
      await revokeGrantInTx(tx, row.grant_id);
    } else {
      await tx`delete from connector.oauth_tokens where token_hash = ${sha256Hex(input.token)}`;
    }
  });
}

export interface GrantSummary {
  id: string;
  clientName: string;
  clientHost: string;
  scopes: ConnectorScope[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** Aktive Freigaben des Eigentümers (Einstellungen). */
export async function listActiveGrants(
  config: ConnectorConfig,
  ownerId: string,
): Promise<GrantSummary[]> {
  const rows = await connectorTransaction(
    config,
    (tx) => tx<
      {
        id: string;
        client_name: string;
        client_id: string;
        scopes: string[];
        created_at: Date;
        last_used_at: Date | null;
      }[]
    >`select id, client_name, client_id, scopes, created_at, last_used_at
        from connector.oauth_grants
       where owner_id = ${ownerId} and revoked_at is null
       order by created_at desc`,
  );
  return rows.map((row) => ({
    id: row.id,
    clientName: row.client_name,
    clientHost: safeHost(row.client_id),
    scopes: normalizeScopes(row.scopes),
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  }));
}

/** Widerruft eine eigene Freigabe samt Tokens und offenen Bestätigungen. */
export async function revokeOwnGrant(
  config: ConnectorConfig,
  ownerId: string,
  grantId: string,
): Promise<boolean> {
  return connectorTransaction(config, async (tx) => {
    const [grant] = await tx<{ id: string }[]>`
      select id from connector.oauth_grants
       where id = ${grantId} and owner_id = ${ownerId} and revoked_at is null
         for update`;
    if (!grant) return false;
    await revokeGrantInTx(tx, grant.id);
    return true;
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unbekannt";
  }
}

import "server-only";

/**
 * Konfiguration des Claude-Connectors (Remote MCP). Beide Variablen sind nur serverseitig:
 *
 * - `TAGESTAKT_PUBLIC_URL`: öffentliche Adresse der Website (Origin, in Produktion https). Daraus
 *   folgen Issuer, MCP-Ressource (`<origin>/mcp`) und alle OAuth-Adressen.
 * - `CONNECTOR_DATABASE_URL`: Postgres-Verbindung der Rolle `tagestakt_connector` (Secret). Keine
 *   andere Rolle ist erlaubt – insbesondere nie postgres, supabase_admin oder service_role.
 *
 * Fehlen beide, ist nur der Connector deaktiviert; die Website läuft unverändert.
 */

export const CONNECTOR_DATABASE_ROLE = "tagestakt_connector";

/** Einzige erlaubte Anbieter von Client-Metadaten (Client ID Metadata Documents). */
export const PRODUCTION_CLIENT_HOSTS = ["claude.ai", "claude.com"] as const;

export interface ConnectorConfig {
  /** Origin ohne abschließenden Schrägstrich, z. B. https://plan.example.test */
  origin: string;
  /** Issuer des Autorisierungsservers (= Origin). */
  issuer: string;
  /** RFC-8707-Ressource des MCP-Servers. */
  resource: URL;
  /** Hostname für Host-/Origin-Prüfungen. */
  hostname: string;
  databaseUrl: string;
  /** Hosts, deren Client-Metadaten akzeptiert werden. */
  clientHosts: readonly string[];
  /** Nur lokal: http erlaubt (Issuer, Loopback-Clients für Tests). */
  insecureLocal: boolean;
}

export type ConnectorConfigResult =
  { ok: true; config: ConnectorConfig } | { ok: false; enabled: boolean; problems: string[] };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Prüft die Connector-Konfiguration ohne Werte preiszugeben. `enabled: false` bedeutet: bewusst
 * nicht eingerichtet (beide Variablen leer) – kein Fehler.
 */
export function parseConnectorConfig(
  env: Record<string, string | undefined>,
): ConnectorConfigResult {
  const rawUrl = env.TAGESTAKT_PUBLIC_URL?.trim() ?? "";
  const rawDatabaseUrl = env.CONNECTOR_DATABASE_URL?.trim() ?? "";
  if (!rawUrl && !rawDatabaseUrl) return { ok: false, enabled: false, problems: [] };

  const problems: string[] = [];
  const production = env.NODE_ENV === "production";
  let publicUrl: URL | null = null;
  try {
    publicUrl = new URL(rawUrl);
  } catch {
    problems.push("TAGESTAKT_PUBLIC_URL fehlt oder ist keine gültige Adresse.");
  }
  if (publicUrl) {
    const local = LOCAL_HOSTS.has(publicUrl.hostname);
    if (publicUrl.protocol !== "https:" && !(publicUrl.protocol === "http:" && local)) {
      problems.push("TAGESTAKT_PUBLIC_URL muss mit https:// beginnen.");
    }
    if (production && local) {
      problems.push("TAGESTAKT_PUBLIC_URL darf in Produktion nicht auf localhost zeigen.");
    }
    if (
      (publicUrl.pathname !== "/" && publicUrl.pathname !== "") ||
      publicUrl.search ||
      publicUrl.hash ||
      publicUrl.username ||
      publicUrl.password
    ) {
      problems.push("TAGESTAKT_PUBLIC_URL darf nur aus Schema und Host bestehen (ohne Pfad).");
    }
  }

  let databaseUrl: URL | null = null;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    problems.push("CONNECTOR_DATABASE_URL fehlt oder ist keine gültige Verbindungsadresse.");
  }
  if (databaseUrl) {
    if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
      problems.push("CONNECTOR_DATABASE_URL muss mit postgres:// beginnen.");
    }
    if (decodeURIComponent(databaseUrl.username) !== CONNECTOR_DATABASE_ROLE) {
      problems.push(
        `CONNECTOR_DATABASE_URL muss die Rolle ${CONNECTOR_DATABASE_ROLE} verwenden (keine Admin- oder Service-Rolle).`,
      );
    }
    if (!databaseUrl.password) {
      problems.push("CONNECTOR_DATABASE_URL enthält kein Passwort.");
    }
  }

  if (problems.length > 0 || !publicUrl || !databaseUrl) {
    return { ok: false, enabled: true, problems };
  }

  const origin = publicUrl.origin;
  const insecureLocal = !production && LOCAL_HOSTS.has(publicUrl.hostname);
  return {
    ok: true,
    config: {
      origin,
      issuer: origin,
      resource: new URL("/mcp", origin),
      hostname: publicUrl.hostname,
      databaseUrl: rawDatabaseUrl,
      clientHosts: insecureLocal
        ? [...PRODUCTION_CLIENT_HOSTS, "localhost", "127.0.0.1"]
        : PRODUCTION_CLIENT_HOSTS,
      insecureLocal,
    },
  };
}

let cached: ConnectorConfigResult | undefined;

/** Laufzeitkonfiguration (einmal je Prozess gelesen). */
export function getConnectorConfig(): ConnectorConfigResult {
  cached ??= parseConnectorConfig({
    TAGESTAKT_PUBLIC_URL: process.env.TAGESTAKT_PUBLIC_URL,
    CONNECTOR_DATABASE_URL: process.env.CONNECTOR_DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  });
  return cached;
}

/** Nur für Tests: Konfiguration neu einlesen. */
export function resetConnectorConfigForTests(): void {
  cached = undefined;
}

import "server-only";

import postgres from "postgres";

import { type ConnectorConfig } from "./config";

/**
 * Datenbankzugang des Connectors – ausschließlich über die Rolle `tagestakt_connector`.
 *
 * - Auf dem Schema `connector` (OAuth, Bestätigungen) arbeitet die Rolle mit eigenen Rechten.
 * - Planungsdaten liest und schreibt sie nur in {@link asOwner}: `set local role authenticated`
 *   mit den Claims des autorisierten Eigentümers. Damit gelten dieselben RLS-Policies, Trigger
 *   und RPCs wie für die Website; ein anderes Konto ist so nicht erreichbar.
 *
 * Abfragen sind ausschließlich feste, parametrisierte Statements dieses Moduls – es gibt keinen
 * Weg, freies SQL, Tabellen- oder Spaltennamen von außen einzuschleusen.
 */

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

let client: { url: string; sql: Sql } | undefined;

export function connectorSql(config: ConnectorConfig): Sql {
  if (client?.url !== config.databaseUrl) {
    client = {
      url: config.databaseUrl,
      sql: postgres(config.databaseUrl, {
        max: 4,
        idle_timeout: 30,
        connect_timeout: 10,
        // Keine Server-Hinweise in die Logs (könnten Inhalte enthalten).
        onnotice: () => undefined,
        connection: {
          application_name: "tagestakt-connector",
          TimeZone: "UTC",
          statement_timeout: 10_000,
          idle_in_transaction_session_timeout: 15_000,
        },
      }),
    };
  }
  return client.sql;
}

/** Eine Transaktion als Connector-Rolle (Schema connector). */
export async function connectorTransaction<T>(
  config: ConnectorConfig,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return (await connectorSql(config).begin((tx) => run(tx))) as T;
}

/**
 * Wechselt innerhalb der Transaktion in die Rolle `authenticated` des Eigentümers. Die ID
 * stammt immer aus der serverseitig geprüften Freigabe bzw. Sitzung – nie aus Tool-Eingaben.
 */
export async function asOwner(tx: Tx, ownerId: string): Promise<void> {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
}

/** Zurück zur Connector-Rolle (für Zugriffe auf das Schema connector). */
export async function asConnector(tx: Tx): Promise<void> {
  await tx`set local role none`;
}

/** Serialisiert gleichzeitige Änderungen derselben Woche (gleicher Schlüssel wie die RPCs). */
export async function lockWeek(tx: Tx, ownerId: string, weekStart: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`tagestakt.schedule_week:${ownerId}:${weekStart}`}, 0))`;
}

/** Nur für Tests: Verbindungen schließen. */
export async function closeConnectorSql(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.sql.end({ timeout: 5 });
}

import { z } from "zod";

/**
 * Konfigurationsfehler, der den Betrieb verhindern muss. Die Meldung enthält
 * nie den konfigurierten Wert selbst.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const uuidSchema = z.guid();

/**
 * Ermittelt die UUID des einzigen erlaubten Benutzers.
 *
 * - development/test: Die Variable darf fehlen (dann ist jeder angemeldete
 *   Supabase-Benutzer zugelassen; RLS schützt die Daten weiterhin).
 * - production: Die Variable ist Pflicht und muss eine gültige UUID sein.
 */
export function resolveOwnerId(
  raw: string | undefined,
  nodeEnv: string | undefined,
): string | undefined {
  const value = raw?.trim();
  if (!value) {
    if (nodeEnv === "production") {
      throw new ConfigurationError(
        "TAGESTAKT_OWNER_USER_ID fehlt. In Produktion ist die UUID des einzigen Supabase-Benutzers Pflicht (siehe docs/deployment-coolify.md).",
      );
    }
    return undefined;
  }
  if (!uuidSchema.safeParse(value).success) {
    throw new ConfigurationError("TAGESTAKT_OWNER_USER_ID muss eine gültige UUID sein.");
  }
  return value.toLowerCase();
}

/** Serverseitige Laufzeitvariable – wird nie an den Client gegeben. */
export function getAllowedOwnerId(): string | undefined {
  return resolveOwnerId(process.env.TAGESTAKT_OWNER_USER_ID, process.env.NODE_ENV);
}

export function isAllowedUser(
  userId: string,
  allowedOwnerId: string | undefined = getAllowedOwnerId(),
): boolean {
  return allowedOwnerId === undefined || userId.toLowerCase() === allowedOwnerId;
}

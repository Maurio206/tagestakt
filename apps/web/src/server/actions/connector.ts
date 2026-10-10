"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionState, readString } from "@/lib/form";
import { AUTHORIZE_PATH } from "@/lib/paths";

import { authorizedClient } from "../auth";
import { resolveClientMetadata } from "../connector/client-metadata";
import { getConnectorConfig } from "../connector/config";
import { authorizationRedirect, parseAuthorizeRequest } from "../connector/oauth";
import { createAuthorizationCode, revokeOwnGrant } from "../connector/oauth-store";
import { UserFacingError } from "../errors";
import { handleAction } from "./handle";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST_LENGTH = 4096;

/**
 * Zustimmung bzw. Ablehnung auf der Freigabeseite. Die Anfrage wird vollständig erneut geprüft
 * (Client-Metadaten, Redirect, PKCE, Scopes, Ressource); die Identität stammt ausschließlich aus
 * der serverseitig geprüften Sitzung des einzigen erlaubten Kontos.
 */
export async function decideAuthorizationAction(formData: FormData): Promise<void> {
  const { user } = await authorizedClient();
  const result = getConnectorConfig();
  if (!result.ok) redirect("/");
  const config = result.config;

  const raw = readString(formData, "anfrage") ?? "";
  if (raw.length > MAX_REQUEST_LENGTH) redirect("/");
  const parsed = await parseAuthorizeRequest(new URLSearchParams(raw), config, (clientId) =>
    resolveClientMetadata(clientId, config),
  );
  // Ungültig geworden (z. B. Client nicht mehr erreichbar): Fehlerseite statt Weiterleitung.
  if (parsed.kind === "fatal") redirect(`${AUTHORIZE_PATH}?${raw}`);
  if (parsed.kind === "redirect") redirect(parsed.location);
  const { request } = parsed;

  if (readString(formData, "entscheidung") !== "erlauben") {
    redirect(
      authorizationRedirect(config, request.redirectUri, {
        error: "access_denied",
        error_description: "Zugriff abgelehnt.",
        state: request.state,
      }),
    );
  }
  const code = await createAuthorizationCode(config, {
    ownerId: user.id,
    clientId: request.client.clientId,
    clientName: request.client.clientName,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scopes: request.scopes,
    resource: request.resource,
  });
  redirect(authorizationRedirect(config, request.redirectUri, { code, state: request.state }));
}

/** Widerruft eine Connector-Freigabe samt Tokens und offenen Bestätigungen (Einstellungen). */
export async function revokeConnectorGrantAction(grantId: string): Promise<ActionState> {
  return handleAction(async () => {
    const { user } = await authorizedClient();
    const result = getConnectorConfig();
    if (!result.ok) throw new UserFacingError("Der Claude-Connector ist nicht eingerichtet.");
    if (!UUID_PATTERN.test(grantId)) throw new UserFacingError("Ungültige Anfrage.");
    const revoked = await revokeOwnGrant(result.config, user.id, grantId);
    revalidatePath("/einstellungen");
    return revoked
      ? { status: "success", message: "Zugriff widerrufen. Claude muss sich neu verbinden." }
      : { status: "error", message: "Diese Freigabe ist bereits widerrufen." };
  });
}

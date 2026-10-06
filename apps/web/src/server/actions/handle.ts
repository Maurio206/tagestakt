import "server-only";

import { unstable_rethrow } from "next/navigation";

import { type ActionState } from "@/lib/form";

import { UserFacingError } from "../errors";

/**
 * Führt eine Server Action aus und wandelt Fehler in einen anzeigbaren Zustand um.
 * Redirects (z. B. fehlende Anmeldung) werden unverändert weitergereicht.
 */
export async function handleAction(
  run: () => Promise<ActionState>,
  values?: Record<string, string>,
): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof UserFacingError) {
      return { status: "error", message: error.message, values };
    }
    // Nur Fehlertyp protokollieren – keine Inhalte, keine Tokens.
    console.error("[tagestakt] unerwarteter Fehler in Server Action", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return {
      status: "error",
      message: "Unerwarteter Fehler. Bitte erneut versuchen.",
      values,
    };
  }
}

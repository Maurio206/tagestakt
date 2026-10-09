import "server-only";

import { type Database } from "@tagestakt/schedule-schema";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";

import { UserFacingError } from "../errors";
import { type TypedSupabaseClient } from "../supabase";
import { PLANNER_JOB_TIMEOUT_MS } from "./config";

/**
 * Hintergrund-Client des Wochenplaners: Publishable Key + Zugriffstoken des angemeldeten
 * Benutzers. Damit gelten RLS und Grants unverändert – kein Service-Role-/Secret-Key.
 * Das Token wird nie protokolliert und nur im Speicher dieses Auftrags gehalten.
 */

/** Restlaufzeit, die das Token beim Start mindestens haben muss (Auftrag + Reserve). */
const MIN_TOKEN_LIFETIME_MS = PLANNER_JOB_TIMEOUT_MS + 2 * 60_000;

export async function getPlannerAccessToken(supabase: TypedSupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const expiresAt = (session?.expires_at ?? 0) * 1000;
  if (!session || expiresAt - Date.now() < MIN_TOKEN_LIFETIME_MS) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session;
    if (refreshed.error || !session) {
      throw new UserFacingError("Die Anmeldung ist abgelaufen. Bitte neu anmelden.");
    }
  }
  return session.access_token;
}

export function createPlannerDbClient(accessToken: string): SupabaseClient<Database> {
  const env = getPublicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

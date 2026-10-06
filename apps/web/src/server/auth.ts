import "server-only";

import { type User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { isAllowedUser } from "./owner";
import { createSupabaseServerClient, type TypedSupabaseClient } from "./supabase";

/**
 * Zusätzliche Autorisierung über TAGESTAKT_OWNER_USER_ID (in Produktion Pflicht):
 * Ausschließlich dieser Benutzer wird akzeptiert – auch wenn in Supabase Auth
 * versehentlich weitere Konten existieren sollten. Siehe ./owner.ts.
 */
export { getAllowedOwnerId, isAllowedUser } from "./owner";

/**
 * Prüft die Session serverseitig gegen Supabase Auth (getUser validiert das
 * Token beim Auth-Server). Ergebnis wird pro Request zwischengespeichert.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!isAllowedUser(data.user.id)) return null;
  return data.user;
});

/** Für geschützte Seiten und Server Actions: ohne gültige Anmeldung → /login. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Authentifizierter Zugriff für die Data-Access-Schicht. */
export async function authorizedClient(): Promise<{ supabase: TypedSupabaseClient; user: User }> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  return { supabase, user };
}

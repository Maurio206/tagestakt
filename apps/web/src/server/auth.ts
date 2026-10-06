import "server-only";

import { type User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { createSupabaseServerClient, type TypedSupabaseClient } from "./supabase";

const ownerIdSchema = z.guid().optional();

/**
 * Optionale zusätzliche Autorisierung: Ist TAGESTAKT_OWNER_USER_ID gesetzt,
 * wird ausschließlich dieser Benutzer akzeptiert – auch wenn in Supabase Auth
 * versehentlich weitere Konten existieren sollten.
 */
export function getAllowedOwnerId(): string | undefined {
  const raw = process.env.TAGESTAKT_OWNER_USER_ID?.trim();
  const parsed = ownerIdSchema.safeParse(raw ? raw : undefined);
  if (!parsed.success) {
    throw new Error("TAGESTAKT_OWNER_USER_ID muss eine gültige UUID sein.");
  }
  return parsed.data;
}

export function isAllowedUser(userId: string, allowedOwnerId = getAllowedOwnerId()): boolean {
  return allowedOwnerId === undefined || userId === allowedOwnerId;
}

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

import "server-only";

import { type Database } from "@tagestakt/schedule-schema";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

import { getPublicEnv } from "@/lib/env";
import { SESSION_COOKIE_OPTIONS } from "@/lib/session-cookies";

/**
 * Supabase-Client für Server Components und Server Actions.
 *
 * Verwendet ausschließlich den Publishable Key + die Session des Benutzers
 * (Cookies). Damit greifen RLS und Grants vollständig – es gibt in der
 * Web-App bewusst keinen Service-Role-/Secret-Key.
 */
export const createSupabaseServerClient = cache(async () => {
  const env = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Aus Server Components heraus sind Cookies schreibgeschützt.
            // Die Session wird im Proxy (src/proxy.ts) aktualisiert.
          }
        },
      },
    },
  );
});

export type TypedSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

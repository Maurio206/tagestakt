import { type Database } from "@tagestakt/schedule-schema";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/env";
import { SESSION_COOKIE_OPTIONS } from "@/lib/session-cookies";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security-headers";

const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Proxy (früher „Middleware“):
 *  1. setzt pro Request eine CSP mit Nonce,
 *  2. aktualisiert die Supabase-Session (Token-Refresh über Cookies),
 *  3. leitet nicht angemeldete Besucher zur Loginseite um.
 *
 * Wichtig: Das ist nur die erste Schutzschicht für eine gute Nutzerführung.
 * Jede geschützte Seite und jede Server Action prüft die Anmeldung zusätzlich
 * serverseitig über die Data-Access-Schicht (src/server/auth.ts).
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers } });
  };

  let response = forward();
  const env = getPublicEnv();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = forward();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // getClaims() validiert das JWT und erneuert bei Bedarf die Session.
  // Zwischen createServerClient und diesem Aufruf darf keine weitere Logik stehen.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  let finalResponse: NextResponse = response;
  if (!isAuthenticated && !PUBLIC_PATHS.has(pathname)) {
    finalResponse = redirectWithCookies(request, "/login", response);
  } else if (isAuthenticated && pathname === "/login") {
    finalResponse = redirectWithCookies(request, "/", response);
  }

  finalResponse.headers.set("Content-Security-Policy", csp);
  return finalResponse;
}

function redirectWithCookies(request: NextRequest, path: string, source: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  for (const cookie of source.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export const config = {
  matcher: [
    // Alles außer statischen Dateien und Next.js-Interna.
    {
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

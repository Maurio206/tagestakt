import { type Database } from "@tagestakt/schedule-schema";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/env";
import { AUTHORIZE_PATH, isConnectorApiPath, safeReturnPath } from "@/lib/paths";
import { SESSION_COOKIE_OPTIONS } from "@/lib/session-cookies";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security-headers";
import { getAllowedOwnerId, isAllowedUser } from "@/server/owner";

const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Proxy (früher „Middleware“):
 *  1. setzt pro Request eine CSP mit Nonce,
 *  2. aktualisiert die Supabase-Session (Token-Refresh über Cookies),
 *  3. leitet nicht angemeldete Besucher zur Loginseite um,
 *  4. behandelt Sessions anderer Supabase-Benutzer wie „nicht angemeldet“,
 *  5. verweigert den Betrieb (503), wenn die Konfiguration unvollständig ist.
 *
 * Die Endpunkte des Claude-Connectors (/mcp, OAuth-Token/-Widerruf, /.well-known) haben eine
 * eigene OAuth-Prüfung und laufen ohne Website-Sitzung. Die Zustimmungsseite
 * (/oauth/authorize) verlangt dagegen die normale Anmeldung und kehrt danach dorthin zurück.
 *
 * Wichtig: Das ist nur die erste Schutzschicht für eine gute Nutzerführung.
 * Jede geschützte Seite und jede Server Action prüft die Anmeldung zusätzlich
 * serverseitig über die Data-Access-Schicht (src/server/auth.ts).
 */
export async function proxy(request: NextRequest) {
  if (isConnectorApiPath(request.nextUrl.pathname)) return NextResponse.next();

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers } });
  };

  let response = forward();

  let env: ReturnType<typeof getPublicEnv>;
  let allowedOwnerId: string | undefined;
  try {
    env = getPublicEnv();
    allowedOwnerId = getAllowedOwnerId();
  } catch (error) {
    // Fail closed: ohne gültige Konfiguration keine geschützten Seiten.
    console.error("[tagestakt] Konfigurationsfehler im Proxy", {
      message: error instanceof Error ? error.message : "unbekannt",
    });
    return new NextResponse("Dienst nicht verfügbar: Konfiguration unvollständig.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

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
  const subject = data?.claims?.sub;
  // Nur der eine konfigurierte Eigentümer gilt als angemeldet.
  const isAuthenticated = typeof subject === "string" && isAllowedUser(subject, allowedOwnerId);
  const { pathname } = request.nextUrl;

  let finalResponse: NextResponse = response;
  if (!isAuthenticated && !PUBLIC_PATHS.has(pathname)) {
    const returnPath =
      pathname === AUTHORIZE_PATH ? safeReturnPath(`${pathname}${request.nextUrl.search}`) : null;
    finalResponse = redirectWithCookies(request, "/login", response, returnPath);
  } else if (isAuthenticated && pathname === "/login") {
    const back = safeReturnPath(request.nextUrl.searchParams.get("weiter"));
    finalResponse = back
      ? redirectToReturnPath(request, back, response)
      : redirectWithCookies(request, "/", response);
  }

  finalResponse.headers.set("Content-Security-Policy", csp);
  return finalResponse;
}

/** Zurück zur Connector-Freigabe (Pfad bereits über safeReturnPath geprüft). */
function redirectToReturnPath(request: NextRequest, returnPath: string, source: NextResponse) {
  const target = new URL(returnPath, request.nextUrl.origin);
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  url.search = target.search;
  return withSessionCookies(NextResponse.redirect(url), source);
}

function redirectWithCookies(
  request: NextRequest,
  path: string,
  source: NextResponse,
  returnPath: string | null = null,
) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = returnPath ? `?${new URLSearchParams({ weiter: returnPath }).toString()}` : "";
  return withSessionCookies(NextResponse.redirect(url), source);
}

function withSessionCookies(redirect: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export const config = {
  matcher: [
    // Alles außer statischen Dateien, Next.js-Interna, Health- und OAuth-Endpunkten
    // (/mcp prüft der Proxy selbst über isConnectorApiPath).
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|robots.txt|api/health|api/oauth/|\\.well-known/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

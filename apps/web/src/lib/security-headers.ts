/**
 * Sicherheits-Header der Verwaltungswebsite.
 *
 * Statische Header gelten für jede Antwort (next.config.ts). Die Content Security
 * Policy enthält eine Nonce pro Request und wird deshalb im Proxy gesetzt.
 */

export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  // Private Anwendung: nicht indexieren, Links nicht folgen, nichts archivieren.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Wirkt nur über HTTPS; lokal (http) ignorieren Browser den Header.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic': nur von nonce-tragenden Next.js-Skripten nachgeladene Skripte.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    // Der Browser spricht nie direkt mit Supabase – nur mit dem eigenen Server.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

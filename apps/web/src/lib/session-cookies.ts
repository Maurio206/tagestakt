/**
 * Optionen für die Supabase-Session-Cookies.
 *
 * Der Browser spricht nie direkt mit Supabase; deshalb dürfen die Cookies
 * `httpOnly` sein – Tokens sind so für (eingeschleustes) JavaScript unlesbar.
 */
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

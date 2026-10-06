import { z } from "zod";

/**
 * Art eines Supabase-Schlüssels:
 * - `publishable`: neuer öffentlicher Key (`sb_publishable_…`)
 * - `legacy-anon`: Legacy-JWT mit Rolle `anon` (z. B. selbstgehostetes Supabase)
 * - `secret`: neuer Secret-Key (`sb_secret_…`) – niemals öffentlich verwenden
 * - `service-role`: Legacy-JWT mit Rolle `service_role` – niemals öffentlich verwenden
 * - `other-jwt`: JWT mit anderer/unlesbarer Rolle – wird sicherheitshalber abgelehnt
 * - `unknown`: kein bekanntes Format
 */
export type SupabaseKeyKind =
  "publishable" | "legacy-anon" | "secret" | "service-role" | "other-jwt" | "unknown";

function decodeJwtRole(key: string): string | undefined {
  const parts = key.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    if (typeof payload === "object" && payload !== null && "role" in payload) {
      return typeof payload.role === "string" ? payload.role : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function classifySupabaseKey(key: string): SupabaseKeyKind {
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.split(".").length === 3) {
    const role = decodeJwtRole(key);
    if (role === "anon") return "legacy-anon";
    if (role === "service_role") return "service-role";
    return "other-jwt";
  }
  return "unknown";
}

/** Schlüssel, die niemals in öffentliche Variablen gehören. */
export function looksLikeSecretKey(key: string): boolean {
  const kind = classifySupabaseKey(key);
  return kind === "secret" || kind === "service-role";
}

/** Nur Publishable Keys oder Legacy-anon-JWTs dürfen öffentlich verwendet werden. */
export function isAcceptablePublicKey(key: string): boolean {
  const kind = classifySupabaseKey(key);
  return kind === "publishable" || kind === "legacy-anon";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function publicEnvSchema(nodeEnv: string | undefined) {
  return z.object({
    NEXT_PUBLIC_SUPABASE_URL: z
      .url({ error: "NEXT_PUBLIC_SUPABASE_URL fehlt oder ist ungültig" })
      .refine(
        (value) => {
          if (nodeEnv !== "production") return true;
          const url = new URL(value);
          return url.protocol === "https:" || LOCAL_HOSTS.has(url.hostname);
        },
        { error: "NEXT_PUBLIC_SUPABASE_URL muss in Produktion mit https:// beginnen" },
      ),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
      .string({ error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY fehlt" })
      .min(20, { error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ist zu kurz" })
      .refine((key) => !looksLikeSecretKey(key), {
        error:
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY enthält einen Secret-/Service-Role-Key. Nur den Publishable Key verwenden!",
        abort: true,
      })
      .refine(isAcceptablePublicKey, {
        error:
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY muss ein Publishable Key (sb_publishable_…) oder ein Legacy-JWT mit Rolle „anon“ sein",
      }),
  });
}

export type PublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
};

export type PublicEnvResult = { ok: true; env: PublicEnv } | { ok: false; messages: string[] };

/** Prüft die öffentliche Konfiguration, ohne Werte in Meldungen preiszugeben. */
export function parsePublicEnv(
  raw: Record<string, string | undefined>,
  nodeEnv: string | undefined,
): PublicEnvResult {
  const result = publicEnvSchema(nodeEnv).safeParse({
    NEXT_PUBLIC_SUPABASE_URL: raw.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (result.success) return { ok: true, env: result.data };
  return { ok: false, messages: result.error.issues.map((issue) => issue.message) };
}

/** Liest die öffentliche Konfiguration. Wirft mit verständlicher Meldung, wenn sie fehlt. */
export function getPublicEnv(): PublicEnv {
  // Statische Zugriffe, damit Next.js die NEXT_PUBLIC_-Werte beim Build einsetzen kann.
  const result = parsePublicEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
    process.env.NODE_ENV,
  );
  if (!result.ok) {
    throw new Error(
      `Ungültige Konfiguration: ${result.messages.join("; ")}. Siehe apps/web/.env.example.`,
    );
  }
  return result.env;
}

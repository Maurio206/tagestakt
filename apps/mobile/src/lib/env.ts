import { z } from "zod";

/**
 * Erkennt Schlüssel, die niemals ins App-Bundle gehören:
 * Secret-Keys (`sb_secret_…`) und Legacy-JWTs mit Rolle `service_role`.
 */
export function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length === 3 && parts[1]) {
    try {
      const payload: unknown = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return (
        typeof payload === "object" &&
        payload !== null &&
        "role" in payload &&
        payload.role === "service_role"
      );
    } catch {
      return false;
    }
  }
  return false;
}

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.url({ error: "EXPO_PUBLIC_SUPABASE_URL fehlt oder ist ungültig" }),
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({ error: "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY fehlt" })
    .min(20, { error: "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ist zu kurz" })
    .refine((key) => !looksLikeSecretKey(key), {
      error:
        "Im App-Bundle ist ein Secret-/Service-Role-Key eingetragen. Nur den Publishable Key verwenden!",
    }),
});

export type MobileEnv = z.infer<typeof envSchema>;

export type EnvResult = { ok: true; env: MobileEnv } | { ok: false; message: string };

export function parseMobileEnv(raw: Record<string, string | undefined>): EnvResult {
  const result = envSchema.safeParse(raw);
  if (result.success) return { ok: true, env: result.data };
  return { ok: false, message: result.error.issues.map((issue) => issue.message).join("\n") };
}

/** Expo ersetzt process.env.EXPO_PUBLIC_* beim Bundling – deshalb statische Zugriffe. */
export function readMobileEnv(): EnvResult {
  return parseMobileEnv({
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

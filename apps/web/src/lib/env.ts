import { z } from "zod";

/**
 * Erkennt Schlüssel, die niemals in öffentliche Variablen gehören:
 * neue Secret-Keys (`sb_secret_…`) und Legacy-JWTs mit Rolle `service_role`.
 */
export function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length === 3 && parts[1]) {
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload: unknown = JSON.parse(atob(base64));
      if (
        typeof payload === "object" &&
        payload !== null &&
        "role" in payload &&
        payload.role === "service_role"
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL fehlt oder ist ungültig" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({ error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY fehlt" })
    .min(20, { error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ist zu kurz" })
    .refine((key) => !looksLikeSecretKey(key), {
      error:
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY enthält einen Secret-/Service-Role-Key. Nur den Publishable Key verwenden!",
    }),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Liest die öffentliche Konfiguration. Wirft mit verständlicher Meldung, wenn sie fehlt. */
export function getPublicEnv(): PublicEnv {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.success) {
    throw new Error(
      `Ungültige Konfiguration: ${result.error.issues.map((i) => i.message).join("; ")}. Siehe apps/web/.env.example.`,
    );
  }
  return result.data;
}

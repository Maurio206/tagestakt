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

/** Hosts, die im Debug-Build per HTTP erreichbar sein dürfen (Gerät über `adb reverse`, Emulator). */
const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "localhost", "10.0.2.2"]);

/**
 * Release: ausschließlich HTTPS. Debug: zusätzlich HTTP, aber nur zu diesem Rechner (lokale
 * Supabase) – nie über WLAN oder Internet, damit Tokens nicht unverschlüsselt übertragen werden.
 * Bewusst ohne `URL` (in React Native nur teilweise implementiert).
 */
export function isAllowedSupabaseUrl(url: string, allowLocalHttp: boolean): boolean {
  const match = /^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  if (!match) return false;
  const scheme = match[1]?.toLowerCase();
  const host = match[2]?.toLowerCase() ?? "";
  if (scheme === "https") return true;
  return allowLocalHttp && LOCAL_HTTP_HOSTS.has(host);
}

function envSchema(allowLocalHttp: boolean) {
  return z.object({
    EXPO_PUBLIC_SUPABASE_URL: z
      .url({ error: "EXPO_PUBLIC_SUPABASE_URL fehlt oder ist ungültig" })
      .refine((url) => isAllowedSupabaseUrl(url, allowLocalHttp), {
        error: allowLocalHttp
          ? "EXPO_PUBLIC_SUPABASE_URL muss mit https:// beginnen (HTTP nur lokal: 127.0.0.1, localhost, 10.0.2.2)."
          : "EXPO_PUBLIC_SUPABASE_URL muss im Release mit https:// beginnen.",
      }),
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
      .string({ error: "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY fehlt" })
      .min(20, { error: "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ist zu kurz" })
      .refine((key) => !looksLikeSecretKey(key), {
        error:
          "Im App-Bundle ist ein Secret-/Service-Role-Key eingetragen. Nur den Publishable Key verwenden!",
      }),
  });
}

export type MobileEnv = z.infer<ReturnType<typeof envSchema>>;

export type EnvResult = { ok: true; env: MobileEnv } | { ok: false; message: string };

/**
 * @param options.allowLocalHttp nur im Debug-Build (`__DEV__`) wahr; Standard: Release-Regeln.
 */
export function parseMobileEnv(
  raw: Record<string, string | undefined>,
  { allowLocalHttp = false }: { allowLocalHttp?: boolean } = {},
): EnvResult {
  const result = envSchema(allowLocalHttp).safeParse(raw);
  if (result.success) return { ok: true, env: result.data };
  return { ok: false, message: result.error.issues.map((issue) => issue.message).join("\n") };
}

/** Expo ersetzt process.env.EXPO_PUBLIC_* beim Bundling – deshalb statische Zugriffe. */
export function readMobileEnv(): EnvResult {
  return parseMobileEnv(
    {
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
    // Im Release-Bundle ist `__DEV__` fest `false`: dort gilt ausschließlich HTTPS.
    { allowLocalHttp: __DEV__ },
  );
}

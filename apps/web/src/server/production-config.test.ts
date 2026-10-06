// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { classifySupabaseKey, isAcceptablePublicKey, parsePublicEnv } from "@/lib/env";

import { GET } from "../app/api/health/route";
import { validateServerConfiguration } from "./config-check";
import { ConfigurationError, isAllowedUser, resolveOwnerId } from "./owner";

const OWNER = "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11";
const OTHER = "22222222-2222-4222-8222-222222222222";

function fakeJwt(payload: object): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signatur`;
}

const validPublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TAGESTAKT_OWNER_USER_ID", () => {
  it("darf in development und test fehlen", () => {
    expect(resolveOwnerId(undefined, "development")).toBeUndefined();
    expect(resolveOwnerId("", "test")).toBeUndefined();
    expect(resolveOwnerId("   ", undefined)).toBeUndefined();
  });

  it("ist in Produktion Pflicht", () => {
    expect(() => resolveOwnerId(undefined, "production")).toThrow(ConfigurationError);
    expect(() => resolveOwnerId("", "production")).toThrow(/fehlt/);
  });

  it("muss eine gültige UUID sein – ohne den Wert in der Meldung zu wiederholen", () => {
    for (const env of ["production", "development"]) {
      try {
        resolveOwnerId("geheim-aber-keine-uuid", env);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as Error).message).not.toContain("geheim-aber-keine-uuid");
      }
    }
  });

  it("akzeptiert eine gültige UUID (Groß-/Kleinschreibung egal)", () => {
    expect(resolveOwnerId(` ${OWNER.toUpperCase()} `, "production")).toBe(OWNER);
  });

  it("lässt in Produktion nur genau den Eigentümer zu", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TAGESTAKT_OWNER_USER_ID", OWNER);
    expect(isAllowedUser(OWNER)).toBe(true);
    expect(isAllowedUser(OTHER)).toBe(false);
  });

  it("verweigert in Produktion jeden Benutzer, wenn die Variable fehlt (fail closed)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TAGESTAKT_OWNER_USER_ID", "");
    expect(() => isAllowedUser(OWNER)).toThrow(ConfigurationError);
  });

  it("lässt ohne Variable in der Entwicklung jeden angemeldeten Benutzer zu (RLS schützt weiter)", () => {
    expect(isAllowedUser(OTHER, undefined)).toBe(true);
  });
});

describe("Startprüfung der Konfiguration", () => {
  it("meldet fehlende Produktionswerte verständlich", () => {
    const problems = validateServerConfiguration({ NODE_ENV: "production" });
    expect(problems.join("\n")).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(problems.join("\n")).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(problems.join("\n")).toContain("TAGESTAKT_OWNER_USER_ID");
  });

  it("akzeptiert eine vollständige Produktionskonfiguration", () => {
    expect(
      validateServerConfiguration({
        NODE_ENV: "production",
        ...validPublicEnv,
        TAGESTAKT_OWNER_USER_ID: OWNER,
      }),
    ).toEqual([]);
  });

  it("verlangt in Produktion https für Supabase", () => {
    const result = parsePublicEnv(
      { ...validPublicEnv, NEXT_PUBLIC_SUPABASE_URL: "http://supabase.example.test" },
      "production",
    );
    expect(result.ok).toBe(false);
    expect(
      parsePublicEnv(
        { ...validPublicEnv, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
        "production",
      ).ok,
    ).toBe(true);
    expect(
      parsePublicEnv(
        { ...validPublicEnv, NEXT_PUBLIC_SUPABASE_URL: "http://supabase.example.test" },
        "development",
      ).ok,
    ).toBe(true);
  });
});

describe("Öffentlicher Supabase-Schlüssel (auch selbstgehostet)", () => {
  it("akzeptiert Publishable Keys und Legacy-JWTs mit Rolle anon", () => {
    expect(classifySupabaseKey("sb_publishable_abcdefghijklmnopqrstuvwxyz")).toBe("publishable");
    expect(classifySupabaseKey(fakeJwt({ role: "anon", iss: "supabase" }))).toBe("legacy-anon");
    const anon = fakeJwt({ role: "anon", iss: "supabase" });
    expect(
      parsePublicEnv(
        { ...validPublicEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon },
        "production",
      ).ok,
    ).toBe(true);
  });

  it("lehnt Secret- und Service-Role-Keys ab", () => {
    for (const key of [
      "sb_secret_abcdefghijklmnopqrstuvwxyz",
      fakeJwt({ role: "service_role", iss: "supabase" }),
    ]) {
      const result = parsePublicEnv(
        { ...validPublicEnv, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key },
        "production",
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.messages.join(" ")).toContain("Secret-/Service-Role-Key");
    }
  });

  it("lehnt JWTs mit anderer oder unlesbarer Rolle und unbekannte Formate ab", () => {
    expect(isAcceptablePublicKey(fakeJwt({ role: "supabase_admin" }))).toBe(false);
    expect(isAcceptablePublicKey(fakeJwt({ sub: "ohne-rolle" }))).toBe(false);
    expect(isAcceptablePublicKey("eyJhbGciOi.kaputt.signatur")).toBe(false);
    expect(isAcceptablePublicKey("irgendein-langer-zufaelliger-text-ohne-format")).toBe(false);
  });
});

describe("GET /api/health", () => {
  it("antwortet mit 200 und minimalem JSON ohne interne Details", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", service: "tagestakt-web" });
  });
});

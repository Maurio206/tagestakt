import { describe, expect, it } from "vitest";

import { loginErrorMessage } from "./auth-messages";
import { getPublicEnv, looksLikeSecretKey } from "./env";
import { formValues, hoursToMinutes } from "./form";
import { NOTICES, noticeText, weekPlanPath } from "./paths";
import {
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  createNonce,
} from "./security-headers";

function fakeJwt(payload: object): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signatur`;
}

describe("Security-Header", () => {
  it("setzt noindex/nofollow und Clickjacking-Schutz", () => {
    const headers = Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(headers["X-Robots-Tag"]).toContain("noindex");
    expect(headers["X-Robots-Tag"]).toContain("nofollow");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("baut eine strikte CSP mit Nonce", () => {
    const nonce = createNonce();
    const csp = buildContentSecurityPolicy(nonce, false);
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(buildContentSecurityPolicy(nonce, true)).toContain("unsafe-eval");
  });

  it("erzeugt unterschiedliche Nonces", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe("Schlüsselprüfung", () => {
  it("erkennt Secret- und Service-Role-Keys", () => {
    expect(looksLikeSecretKey("sb_secret_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(looksLikeSecretKey(fakeJwt({ role: "service_role" }))).toBe(true);
    expect(looksLikeSecretKey(fakeJwt({ role: "anon" }))).toBe(false);
    expect(looksLikeSecretKey("sb_publishable_abcdefghijklmnopqrstuvwxyz")).toBe(false);
  });

  it("verweigert einen Secret-Key als öffentliche Variable", () => {
    const original = { ...process.env };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_abcdefghijklmnopqrstuvwxyz";
    expect(() => getPublicEnv()).toThrow(/Secret/);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abcdefghijklmnopqrstuvwxyz";
    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    process.env = original;
  });
});

describe("Formularhilfen", () => {
  it("rechnet Stunden in Minuten um", () => {
    expect(hoursToMinutes("20")).toBe(1200);
    expect(hoursToMinutes("17,5")).toBe(1050);
    expect(hoursToMinutes("0.25")).toBe(15);
    expect(hoursToMinutes("zwanzig")).toBeNaN();
    expect(hoursToMinutes("-3")).toBeNaN();
    expect(hoursToMinutes(undefined)).toBeNaN();
  });

  it("gibt Passwörter nie zurück", () => {
    const data = new FormData();
    data.set("email", "demo@tagestakt.test");
    data.set("password", "geheim");
    expect(formValues(data, ["password"])).toEqual({ email: "demo@tagestakt.test" });
  });
});

describe("Anmeldefehler", () => {
  it("unterscheidet nicht zwischen unbekannter E-Mail und falschem Passwort", () => {
    expect(loginErrorMessage({ code: "invalid_credentials", status: 400 })).toBe(
      "E-Mail oder Passwort ist falsch.",
    );
    expect(loginErrorMessage({ code: "user_not_found", status: 400 })).toBe(
      "E-Mail oder Passwort ist falsch.",
    );
  });

  it("meldet Rate-Limits und Ausfälle verständlich", () => {
    expect(loginErrorMessage({ status: 429 })).toContain("Zu viele");
    expect(loginErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toContain(
      "nicht erreichbar",
    );
  });
});

describe("Pfade", () => {
  it("transportiert nur bekannte Hinweise", () => {
    expect(weekPlanPath("2026-10-05", { notice: "veroeffentlicht" })).toBe(
      "/wochenplan?woche=2026-10-05&hinweis=veroeffentlicht",
    );
    expect(noticeText("veroeffentlicht")).toBe(NOTICES.veroeffentlicht);
    expect(noticeText("<script>")).toBeUndefined();
  });
});

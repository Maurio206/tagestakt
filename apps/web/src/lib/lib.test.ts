import { describe, expect, it } from "vitest";

import { loginErrorMessage } from "./auth-messages";
import { getPublicEnv, looksLikeSecretKey } from "./env";
import { formValues } from "./form";
import { NOTICES, evaluationPath, noticeText, parseUndoTimes, weekPlanPath } from "./paths";
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

  it("baut Rückgängig-Parameter und liest sie nur gültig zurück", () => {
    const path = weekPlanPath("2026-10-12", {
      versionId: "v",
      editEntryId: "e",
      notice: "verschoben",
      undo: {
        entryId: "e",
        startAt: "2026-10-12T15:00:00.000Z",
        endAt: "2026-10-12T17:00:00.000Z",
      },
    });
    const params = new URL(path, "http://localhost").searchParams;
    expect(params.get("rueckgaengig")).toBe("e");
    expect(parseUndoTimes(params.get("vorher") ?? undefined)).toEqual({
      startAt: "2026-10-12T15:00:00.000Z",
      endAt: "2026-10-12T17:00:00.000Z",
    });
    expect(parseUndoTimes("kaputt")).toBeUndefined();
    expect(parseUndoTimes("2026-10-12T15:00:00Z_nein")).toBeUndefined();
    expect(parseUndoTimes("a_b_c")).toBeUndefined();
  });

  it("verlinkt die Auswertung mit Korrektur", () => {
    expect(evaluationPath("2026-10-12", { correctId: "abc" })).toBe(
      "/auswertung?woche=2026-10-12&korrigieren=abc",
    );
  });
});

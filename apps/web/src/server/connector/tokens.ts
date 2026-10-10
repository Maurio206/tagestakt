import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Zufallswerte und Hashes für OAuth-Codes, Tokens und Veröffentlichungsbestätigungen.
 *
 * Gespeichert wird ausschließlich der SHA-256-Hash. Bei 256 Bit Zufall ist ein einfacher Hash
 * ausreichend (kein Passwort, kein Wörterbuchangriff möglich). Das Präfix macht die Art des
 * Werts in Fehlerberichten erkennbar, ohne ihn preiszugeben.
 */
export const TOKEN_PREFIXES = {
  code: "tt_ac_",
  access: "tt_at_",
  refresh: "tt_rt_",
  confirmation: "tt_pc_",
} as const;

export type TokenKind = keyof typeof TOKEN_PREFIXES;

const TOKEN_PATTERN = /^tt_(ac|at|rt|pc)_[A-Za-z0-9_-]{43}$/;

export function generateToken(kind: TokenKind): string {
  return `${TOKEN_PREFIXES[kind]}${randomBytes(32).toString("base64url")}`;
}

/** Formal gültig und von der erwarteten Art? Ungültiges wird gar nicht erst nachgeschlagen. */
export function isTokenOfKind(value: unknown, kind: TokenKind): value is string {
  return (
    typeof value === "string" && TOKEN_PATTERN.test(value) && value.startsWith(TOKEN_PREFIXES[kind])
  );
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** PKCE (RFC 7636, nur S256): BASE64URL(SHA256(code_verifier)) == code_challenge. */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) return false;
  const computed = Buffer.from(
    createHash("sha256").update(codeVerifier, "ascii").digest("base64url"),
  );
  const expected = Buffer.from(codeChallenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

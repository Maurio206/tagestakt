#!/usr/bin/env node
/**
 * Einfacher Secret- und Datenschutz-Scan für alle Dateien, die ins Repository
 * gelangen würden (versioniert oder nicht ignoriert). Ersetzt kein vollwertiges
 * Werkzeug wie gitleaks, fängt aber die typischen Fehler dieses Projekts ab.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|ico|webp|ttf|otf|woff2?|hbc)$/i;
const SELF = "scripts/check-secrets.mjs";

/** Offensichtlich erfundene Platzhalter, die in Tests und Beispielen erlaubt sind. */
const FAKE_VALUE = /abcdefghijklmnopqrstuvwxyz|platzhalter|placeholder|beispiel|example|signatur/i;

const PATTERNS = [
  { name: "Supabase Secret Key", regex: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  {
    name: "Supabase Publishable Key (gehört in .env.local, nicht ins Repo)",
    regex: /sb_publishable_[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "JSON Web Token",
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  { name: "Privater Schlüssel", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "GitHub-Token", regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { name: "GitHub Fine-grained Token", regex: /github_pat_[A-Za-z0-9_]{30,}/g },
  { name: "Anthropic API Key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  {
    name: "Secret in öffentlicher Variable",
    regex: /\b(NEXT_PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]*(SECRET|SERVICE_ROLE)[A-Z0-9_]*\s*=/g,
  },
  {
    name: "Postgres-Verbindung mit Passwort",
    regex: /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{6,}@(?!127\.0\.0\.1|localhost)/g,
  },
];

/** Nur neutrale Test-/Beispieladressen dürfen im Repository stehen. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_EMAIL = /@(tagestakt\.test|example\.(com|org|net|test))$|^noreply@anthropic\.com$/i;

const findings = [];

for (const file of files) {
  const normalized = file.replace(/\\/g, "/");
  if (normalized === SELF || SKIP_EXTENSIONS.test(normalized)) continue;

  const base = normalized.split("/").pop() ?? "";
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
    findings.push(`${normalized}: Umgebungsdatei darf nicht ins Repository`);
    continue;
  }
  if (/\.(pem|key|p12|jks|keystore)$/i.test(base) || base === "google-services.json") {
    findings.push(`${normalized}: Schlüssel-/Zertifikatsdatei darf nicht ins Repository`);
    continue;
  }

  let content;
  try {
    if (statSync(file).size > 5_000_000) continue;
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const { name, regex } of PATTERNS) {
    for (const match of content.matchAll(regex)) {
      if (!FAKE_VALUE.test(match[0])) {
        findings.push(`${normalized}: ${name} gefunden (${match[0].slice(0, 12)}…)`);
      }
    }
  }

  if (normalized !== "pnpm-lock.yaml") {
    for (const match of content.matchAll(EMAIL)) {
      const address = match[0];
      // npm-Scopes/Versionen wie "@scope/pkg@1.2.3" sind keine Adressen.
      if (/@\d/.test(address) || ALLOWED_EMAIL.test(address)) continue;
      findings.push(`${normalized}: E-Mail-Adresse „${address}“ – nur Beispieladressen verwenden`);
    }
  }
}

if (findings.length > 0) {
  console.error("Secret-/Datenschutz-Scan fehlgeschlagen:\n");
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error(
    "\nSecrets gehören in .env.local bzw. Supabase/GitHub-Einstellungen, nie ins Repository.",
  );
  process.exit(1);
}

console.log(`Secret-/Datenschutz-Scan: ${files.length} Dateien geprüft, keine Funde.`);

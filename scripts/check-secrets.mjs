#!/usr/bin/env node
/**
 * Einfacher Secret- und Datenschutz-Scan für alle Dateien, die ins Repository
 * gelangen würden (versioniert oder nicht ignoriert). Ersetzt kein vollwertiges
 * Werkzeug wie gitleaks, fängt aber die typischen Fehler dieses Projekts ab –
 * inklusive privater Verknüpfungen, OneNote-Dateien und Notiz-Exporte.
 * Regeln: scripts/secret-rules.mjs (Tests: scripts/secret-rules.test.mjs).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import { SKIP_EXTENSIONS, checkContent, checkPath } from "./secret-rules.mjs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

/** Die Regeldateien enthalten die Muster selbst und werden daher nicht gescannt. */
const SELF = new Set([
  "scripts/check-secrets.mjs",
  "scripts/secret-rules.mjs",
  "scripts/secret-rules.test.mjs",
]);

const findings = [];

for (const file of files) {
  const normalized = file.replace(/\\/g, "/");
  if (SELF.has(normalized)) continue;

  const pathFinding = checkPath(normalized);
  if (pathFinding) {
    findings.push(pathFinding);
    continue;
  }
  if (SKIP_EXTENSIONS.test(normalized)) continue;

  let content;
  try {
    if (statSync(file).size > 5_000_000) continue;
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  findings.push(...checkContent(normalized, content));
}

if (findings.length > 0) {
  console.error("Secret-/Datenschutz-Scan fehlgeschlagen:\n");
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error(
    "\nSecrets gehören in .env.local bzw. Supabase/GitHub-Einstellungen, persönliche Notizen in die Datenbank – nie ins Repository.",
  );
  process.exit(1);
}

console.log(`Secret-/Datenschutz-Scan: ${files.length} Dateien geprüft, keine Funde.`);

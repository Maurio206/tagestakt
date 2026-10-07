/**
 * Regeln des Secret- und Datenschutz-Scans (rein, ohne Dateisystem – dadurch testbar).
 * Funde nennen nur Datei und Regel, nie Inhalte (keine Notiztexte, keine Adressen aus Links).
 */

export const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|ico|webp|ttf|otf|woff2?|hbc)$/i;

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

/**
 * Persönliche Notizen und Verknüpfungen: Internetverknüpfungen (.url/.webloc/.lnk) und
 * OneNote-Dateien sind private Zeiger bzw. Notizbücher – nie importierbares Repo-Material.
 */
const PRIVATE_FILE_RULES = [
  {
    regex: /\.(url|webloc|lnk)$/i,
    message: "Private Verknüpfung (z. B. Internetverknüpfung) darf nicht ins Repository",
  },
  {
    regex: /\.(one|onepkg|onetoc2|onebin)$/i,
    message: "OneNote-Datei darf nicht ins Repository",
  },
  {
    regex: /\.(docx?|mht|mhtml|rtf)$/i,
    message: "Dokumentexport (z. B. aus OneNote oder Word) darf nicht ins Repository",
  },
  {
    regex:
      /(tagesnotiz|notiz-?export|notes?-?export|daily[-_]?notes?[-_]?export|onenote)[^/]*\.(json|jsonl|ndjson|csv|txt|html?|pdf|xlsx?)$/i,
    message: "Notiz-Export darf nicht ins Repository",
  },
];

/** Datenbankzeilen mit Notizinhalt (Export/Dump) – unabhängig vom Dateinamen. */
const NOTE_ROW_RULES = [
  {
    files: /\.(json|jsonl|ndjson)$/i,
    test: (content) =>
      /"note_date"\s*:\s*"\d{4}-\d{2}-\d{2}"/.test(content) && /"content"\s*:\s*"/.test(content),
    message: "Tagesnotiz-Datensätze (JSON) dürfen nicht ins Repository",
  },
  {
    files: /\.csv$/i,
    test: (content) => /^[^\n]*\bnote_date\b[^\n]*\bcontent\b/im.test(content),
    message: "Tagesnotiz-Datensätze (CSV) dürfen nicht ins Repository",
  },
  {
    files: /\.(sql|dump|txt)$/i,
    test: (content) => /^\s*COPY\s+(public\.)?daily_notes\b/im.test(content),
    message: "Datenbank-Dump mit Tagesnotizen darf nicht ins Repository",
  },
  {
    files: /(^|\/)supabase\/seed\.sql$/i,
    test: (content) => /daily_notes/i.test(content),
    message: "Der Seed darf keine Tagesnotizen enthalten",
  },
];

/** Prüft eine Datei allein am Pfad (vor dem Lesen). Liefert eine Meldung oder `null`. */
export function checkPath(path) {
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? "";
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
    return `${normalized}: Umgebungsdatei darf nicht ins Repository`;
  }
  if (/\.(pem|key|p12|jks|keystore)$/i.test(base) || base === "google-services.json") {
    return `${normalized}: Schlüssel-/Zertifikatsdatei darf nicht ins Repository`;
  }
  // Artboards des Design-Artefakts sind Entwürfe mit Beispielinhalten – nur an ihrem Ort.
  if (/^docs\/design\/artifact\/[^/]+\.dc\.html$/i.test(normalized)) return null;
  for (const rule of PRIVATE_FILE_RULES) {
    if (rule.regex.test(base)) return `${normalized}: ${rule.message}`;
  }
  return null;
}

/** Prüft den Inhalt einer Datei. Funde enthalten nie den Inhalt selbst (außer Secret-Präfixen). */
export function checkContent(path, content) {
  const normalized = path.replace(/\\/g, "/");
  const findings = [];

  for (const { name, regex } of PATTERNS) {
    for (const match of content.matchAll(regex)) {
      if (!FAKE_VALUE.test(match[0])) {
        findings.push(`${normalized}: ${name} gefunden (${match[0].slice(0, 12)}…)`);
      }
    }
  }

  for (const rule of NOTE_ROW_RULES) {
    if (rule.files.test(normalized) && rule.test(content)) {
      findings.push(`${normalized}: ${rule.message}`);
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
  return findings;
}

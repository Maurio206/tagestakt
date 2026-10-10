/**
 * Tests der Scan-Regeln (node --test). Alle Werte sind frei erfunden.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkContent, checkPath } from "./secret-rules.mjs";

describe("checkPath", () => {
  it("blockiert private Verknüpfungen, ohne ihr Ziel zu nennen", () => {
    const finding = checkPath("Notizbuch-Link (Beispiel).url");
    assert.match(finding ?? "", /Private Verknüpfung/);
    assert.match(checkPath("docs/Notizen.webloc") ?? "", /Private Verknüpfung/);
    assert.match(checkPath("Verknüpfung.lnk") ?? "", /Private Verknüpfung/);
  });

  it("blockiert OneNote-Dateien und Dokumentexporte", () => {
    for (const file of [
      "a.one",
      "Notizbuch.onepkg",
      "Inhalt.onetoc2",
      "export.docx",
      "seite.mht",
    ]) {
      assert.notEqual(checkPath(file), null, file);
    }
  });

  it("blockiert Notiz-Exporte, nicht aber Quellcode zu Tagesnotizen", () => {
    assert.match(checkPath("private/tagesnotizen-2026.json") ?? "", /Notiz-Export/);
    assert.match(checkPath("onenote-export.html") ?? "", /Notiz-Export/);
    // Die Ausnahme für Design-Artboards gilt nur im Artefakt-Ordner und nur für *.dc.html.
    assert.match(checkPath("tagesnotiz-export.dc.html") ?? "", /Notiz-Export/);
    assert.match(checkPath("docs/tagesnotiz.dc.html") ?? "", /Notiz-Export/);
    for (const file of [
      "packages/schedule-schema/src/daily-notes.ts",
      "apps/web/src/components/daily-note-editor.tsx",
      "supabase/migrations/20261008120000_daily_notes.sql",
      "supabase/tests/06_daily_notes.test.sql",
      "docs/notes-roadmap.md",
      "docs/design/artifact/w15-tagesnotiz.dc.html",
    ]) {
      assert.equal(checkPath(file), null, file);
    }
  });

  it("blockiert weiterhin Umgebungs- und Schlüsseldateien", () => {
    assert.notEqual(checkPath("apps/web/.env.local"), null);
    assert.equal(checkPath("apps/web/.env.example"), null);
    assert.notEqual(checkPath("release.keystore"), null);
  });
});

describe("checkContent", () => {
  const secret = "Geheimer Notizinhalt (Beispiel)";

  it("erkennt Notiz-Datensätze in JSON, ohne den Inhalt auszugeben", () => {
    const json = JSON.stringify([{ note_date: "2026-10-14", content: secret }]);
    const findings = checkContent("dump/rows.json", json);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /Tagesnotiz-Datensätze \(JSON\)/);
    assert.doesNotMatch(findings.join("\n"), /Geheimer/);
  });

  it("erkennt CSV-Exporte und Datenbank-Dumps", () => {
    assert.equal(checkContent("x.csv", `note_date,content\n2026-10-14,"${secret}"`).length, 1);
    assert.equal(
      checkContent("backup.sql", "COPY public.daily_notes (id, content) FROM stdin;\n").length,
      1,
    );
  });

  it("der Seed darf keine Tagesnotizen enthalten", () => {
    assert.equal(checkContent("supabase/seed.sql", "insert into public.daily_notes ...").length, 1);
    assert.equal(
      checkContent("supabase/seed.sql", "insert into public.schedule_weeks ...").length,
      0,
    );
  });

  it("lässt Quellcode und Tests mit Feldnamen unbehelligt", () => {
    assert.deepEqual(
      checkContent(
        "packages/schedule-schema/src/database.types.ts",
        "note_date: string; content: string",
      ),
      [],
    );
    assert.deepEqual(
      checkContent(
        "supabase/tests/06_daily_notes.test.sql",
        "insert into public.daily_notes (note_date, content) values ('2026-10-14', 'Neutral');",
      ),
      [],
    );
  });

  it("meldet Secrets und fremde E-Mail-Adressen weiterhin", () => {
    // Zur Laufzeit zusammengesetzt, damit kein schlüsselähnlicher Text im Repository steht.
    const fakeKey = ["sb", "secret", "0123456789abcdefXYZ"].join("_");
    assert.equal(checkContent("a.ts", `const k = '${fakeKey}';`).length, 1);
    assert.equal(checkContent("a.md", "demo@tagestakt.test").length, 0);
    assert.equal(checkContent("a.md", "jemand@firma.de").length, 1);
  });

  it("meldet Connector-Tokens und Datenbank-Zugangsdaten in öffentlichen Variablen", () => {
    const token = ["tt", "rt", "A".repeat(43)].join("_");
    assert.equal(checkContent("a.ts", `const t = "${token}";`).length, 1);
    assert.equal(checkContent("a.ts", `const t = "tt_rt_kurz";`).length, 0);
    const publicDb = ["NEXT", "PUBLIC", "CONNECTOR", "DATABASE", "URL="].join("_");
    assert.equal(checkContent("a.ts", publicDb).length, 1);
  });
});

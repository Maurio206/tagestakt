# Früheres Konzept: eigener Claude-Agent-Endpunkt (abgelöst)

> **Abgelöst durch den Claude-Connector** ([claude-connector.md](claude-connector.md)): Claude
> arbeitet in der Claude-App über einen Remote-MCP-Server mit OAuth, speichert nur geprüfte
> Entwürfe und veröffentlicht ausschließlich nach ausdrücklicher Bestätigung des Benutzers
> (einmalige Bestätigung über `prepare_week_publish`). Der hier beschriebene eigene Endpunkt mit
> `agent_tokens` wird **nicht** umgesetzt; das Dokument bleibt nur als Entscheidungshistorie.
> Die Grundsätze unten (Entwurf zuerst, kein Service-Role-Key, gleiche Validierung, Idempotenz)
> gelten für den Connector sinngemäß weiter.

In einer späteren Phase soll ein separater Claude-Agent aus einer Unterhaltung einen Wochenplan
erstellen und hochladen. **In dieser Phase existieren dafür weder Endpunkt noch Schlüssel noch
Tabellen.** Vorbereitet sind nur der Entwurfs-Workflow, die Quelle `source = 'agent'` und das
Vertragsschema `agentDraftRequestSchema` in `packages/schedule-schema/src/agent-contract.ts`.

## Grundsätze

1. **Immer Entwurf.** Ein Agent erzeugt ausschließlich einen Entwurf (neue Version der Woche).
2. **Nie veröffentlichen.** Der Vertrag kennt kein Statusfeld (`.strict()` lehnt es ab), und die
   Datenbank lässt neue Wochen ohnehin nur als `draft` zu. Veröffentlichen geschieht nur durch den
   Benutzer im Web-UI (`publish_schedule_week`) nach Prüfung von Inhalt und Überschneidungen.
3. **Serverseitiger, authentifizierter Endpunkt.** Der Agent spricht nie direkt mit Supabase.
4. **Kein Service-Role-Key an Agent oder Client.** Weder im Prompt, noch in Tools, noch in
   Konfigurationen, die der Agent sieht.
5. **Gleiche Validierung.** Der Endpunkt validiert mit denselben Zod-Schemas wie das Web-UI
   (`scheduleEntryInputSchema`, `weekStartSchema`) und zusätzlich mit den DB-Constraints/Triggern.
6. **Idempotenz.** Wiederholte Requests mit gleichem `idempotencyKey` erzeugen keinen zweiten
   Entwurf, sondern liefern das gespeicherte Ergebnis (`replayed: true`).
7. **Nachvollziehbar versioniert.** Jeder Upload erzeugt bzw. ersetzt nur den Entwurf; frühere
   Versionen bleiben unverändert; Einträge tragen `source = 'agent'`.
8. **Rate Limiting und Audit-Log sind Voraussetzung**, bevor der Endpunkt aktiviert wird.
9. **Keine erfasste Zeit.** Ein Agent liest oder schreibt weder `activity_sessions` noch
   Wochenziele oder Erinnerungs-Vorgaben. Tatsächliche Zeit erfasst nur der Benutzer selbst
   („Fokus starten“/„Beenden“, „Zeit korrigieren“). Ein Agent darf Planblöcke für Gewerbe, Sport
   und Laila **vorschlagen** – ob ein Ziel erreicht wurde, entscheidet allein die erfasste Zeit.
10. **Mobile Bearbeitung ist kein Agent-Weg.** Die App nutzt für „Plan bearbeiten“ dieselben
    Entwurfs-RPCs wie das Web; ein Agent-Entwurf und ein manueller Entwurf derselben Woche sind
    derselbe Entwurf (siehe „Verhalten bei vorhandenem Entwurf“).
11. **Keine Tagesnotizen.** Ein Agent liest oder schreibt `daily_notes` nicht. Ein späterer
    Lesezugriff (z. B. „berücksichtige meine Notiz von Mittwoch“) nur nach ausdrücklicher
    Freigabe im Einzelfall, nie automatisch; aus Notizen entstehen höchstens **Entwürfe**
    (siehe [notes-roadmap.md](notes-roadmap.md)).

## Geplanter Ablauf

```
Unterhaltung ──▶ Claude-Agent ──(Tool-Aufruf)──▶ POST /api/agent/v1/drafts  (Next.js, serverseitig)
                                                   │ 1. Agent-Token prüfen (Hash-Vergleich, Scope draft:write)
                                                   │ 2. Rate Limit (z. B. 10 Requests / Stunde)
                                                   │ 3. Idempotenz-Schlüssel prüfen
                                                   │ 4. Zod-Validierung (agentDraftRequestSchema)
                                                   │ 5. Entwurf anlegen/ersetzen (nur draft, source = agent)
                                                   │ 6. Audit-Eintrag schreiben
                                                   ▼
                                     Antwort: Entwurfs-ID, Version, Anzahl Einträge, Überschneidungen
Benutzer ──▶ Web-UI /wochenplan ──▶ prüft Entwurf ──▶ „Entwurf veröffentlichen“
```

## Authentifizierung (Vorschlag)

- Eigene, **widerrufbare Agent-Tokens** (zufällig, ≥ 32 Byte), angezeigt genau einmal, in der DB
  nur als Hash (z. B. SHA-256) mit Scope `draft:write`, Ablaufdatum und `revoked_at`.
- Der Endpunkt ordnet das Token genau dem einen Eigentümer zu und schreibt **mit minimalen
  Rechten**: bevorzugt über eine eng begrenzte Datenbankfunktion im nicht exponierten Schema, die
  ausschließlich Entwürfe dieses Eigentümers anlegen darf. Ein Service-Role-Key – falls
  unvermeidbar – bleibt ausschließlich in der Server-Umgebung des Endpunkts.
- Tokens werden über das Web-UI erzeugt/widerrufen (nur nach Anmeldung).

## Geplante zusätzliche Tabellen (später, per Migration mit RLS)

- `agent_tokens` (owner_id, token_hash, scope, expires_at, revoked_at, last_used_at)
- `agent_requests` (owner_id, idempotency_key **unique pro owner**, payload_hash, schedule_week_id,
  response, created_at) – für Idempotenz
- `audit_log` (owner_id, actor `user|agent`, action, schedule_week_id, details ohne Inhalte, created_at)

## JSON-Vertrag (Version 1, noch nicht exponiert)

**Request** `POST /api/agent/v1/drafts`, Header `Authorization: Bearer <agent-token>`:

```json
{
  "contractVersion": 1,
  "idempotencyKey": "2026-10-12-plan-0001-abcdef",
  "weekStart": "2026-10-12",
  "timezone": "Europe/Berlin",
  "planningNote": "Optionaler Hinweis zur Woche",
  "entries": [
    {
      "title": "Gewerbe-Fokusblock (Beispiel)",
      "category": "business",
      "date": "2026-10-13",
      "startTime": "15:30",
      "endTime": "19:30",
      "endsNextDay": false,
      "location": null,
      "note": null
    },
    {
      "title": "Schlaf (Beispiel)",
      "category": "sleep",
      "date": "2026-10-13",
      "startTime": "22:30",
      "endTime": "06:30",
      "endsNextDay": true
    }
  ]
}
```

Regeln (aus dem Schema):

- `contractVersion` = 1, `timezone` = `Europe/Berlin`, `weekStart` ist ein Montag.
- `idempotencyKey`: 16–128 Zeichen `[A-Za-z0-9_-]`.
- 1–300 Einträge; Kategorien wie im Datenmodell; Zeiten `HH:MM`; Dauer > 0 und ≤ 24 h.
- Jeder Eintrag muss in der angegebenen Woche beginnen.
- Unbekannte Felder (z. B. `status`) führen zur Ablehnung.

**Antwort** `201 Created` (bzw. `200` bei Wiederholung):

```json
{
  "contractVersion": 1,
  "scheduleWeekId": "…uuid…",
  "weekStart": "2026-10-12",
  "version": 3,
  "status": "draft",
  "entryCount": 42,
  "overlapWarnings": 2,
  "replayed": false
}
```

**Fehler:** `400` Validierung (Feldpfade, keine Inhalte zurückspiegeln), `401` Token ungültig,
`403` Scope fehlt/widerrufen, `409` gleicher `idempotencyKey` mit anderem Inhalt,
`429` Rate Limit, `500` ohne interne Details.

## Verhalten bei vorhandenem Entwurf

Empfehlung: Ein Agent-Upload **ersetzt** den aktuellen Entwurf der Woche nur, wenn dieser selbst
ausschließlich `source = 'agent'`-Einträge enthält; andernfalls wird abgelehnt (`409`), damit
manuelle Arbeit nie stillschweigend überschrieben wird. Veröffentlichte Versionen bleiben immer
unberührt.

## Checkliste vor Aktivierung

- [ ] Migration für `agent_tokens`, `agent_requests`, `audit_log` inkl. RLS, Grants, pgTAP-Tests
- [ ] Token-Verwaltung im Web-UI (erzeugen, anzeigen einmalig, widerrufen)
- [ ] Rate Limiting (persistiert, nicht nur im Speicher)
- [ ] Idempotenz inkl. Payload-Hash-Vergleich
- [ ] Audit-Log ohne Termininhalte
- [ ] Tests: Agent kann nicht veröffentlichen, nicht fremde Wochen schreiben, keine veröffentlichte
      Version verändern, kein Statusfeld setzen
- [ ] Sicherheits-Review und Aktualisierung von docs/security.md

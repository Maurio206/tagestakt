# TagesTakt

Private Wochenplanung für **genau einen Benutzer**. Die mobile App zeigt auf dem eigenen
Smartphone, was gerade ansteht, was als Nächstes kommt und wie die Woche aufgebaut ist.
Geplant wird über eine geschützte Verwaltungswebsite.

> Status: MVP plus Designsystem, Fokus-Erfassung (Plan und tatsächliche Zeit für Gewerbe,
> Sport und Laila), Fokusfläche auf der Startseite und Tagesnotiz (reiner Text je Kalendertag;
> Ausbau zu Notizbüchern nur als Konzept: [docs/notes-roadmap.md](docs/notes-roadmap.md)) sowie der
> **Claude-Connector** (Remote-MCP-Server mit OAuth unter `/mcp`): Claude bespricht in der
> Claude-App die kommende Woche, speichert geprüfte Entwürfe und veröffentlicht nur nach
> ausdrücklicher Bestätigung ([docs/claude-connector.md](docs/claude-connector.md)). TagesTakt
> selbst ruft kein Sprachmodell auf und braucht keinen Anthropic-API-Schlüssel.

## Architektur auf einen Blick

```
apps/web     Next.js (App Router) – Verwaltungswebsite: Login, Übersicht mit Fokusfläche
             und Tagesnotiz, Wocheneditor (mit Tagesnotizen), Wiederholungen, Auswertung,
             Einstellungen, Entwurfsprüfung der Wochenplanung.
             Server-seitige Auth + zentrale Data-Access-Schicht; Claude-Connector (MCP + OAuth).
apps/mobile  Expo / React Native (Expo Router) – Jetzt (Fokusfläche), Tag (mit Tagesnotiz),
             Woche, Mehr; Fokus starten/beenden, Zeit korrigieren, Plan bearbeiten (Entwurf),
             Ziele, Wochenbilanz, optionale App-Sperre, lokale Erinnerungen. Session in SecureStore,
             Offline-Cache des zuletzt veröffentlichten Plans (offline nur lesen).
packages/schedule-schema
             Gemeinsame Zod-Schemas, Typen, Konstanten, Zeitlogik (Europe/Berlin),
             Zielberechnung, Erinnerungsplanung, Fokuszustand, Tagesnotiz-Editorlogik.
packages/design-tokens
             Gemeinsames Designsystem (Farben, Typografie, Abstände) für Web und App.
packages/config
             Gemeinsame ESLint- und TypeScript-Basiskonfiguration.
supabase     Versionierte SQL-Migrationen, RLS, Grants, neutrale Seed-Daten, pgTAP-Tests.
docs         Architektur, Sicherheit, Datenmodell, Einrichtung, Claude-Connector.
```

Web und App verwenden denselben Supabase-Auth-Benutzer und denselben gemeinsamen
Wochenplan-Typ (`ScheduleWeekWithEntries`). Zugriff auf Daten wird ausschließlich durch
**Row Level Security + Postgres-Grants** begrenzt – der öffentliche Publishable Key allein
gewährt keinerlei Zugriff.

Details: [docs/architecture.md](docs/architecture.md) · [docs/data-model.md](docs/data-model.md) ·
Design: [docs/design/README.md](docs/design/README.md)

## Voraussetzungen

- Node.js 24 (mindestens 22.12) – siehe `.nvmrc`
- pnpm 11 (`npm i -g pnpm@11` oder `corepack enable pnpm`)
- Docker Desktop (für das lokale Supabase)
- Git
- Für die App: Android-Gerät mit Expo Go oder ein Android-Emulator

## Lokale Installation (Kurzfassung)

```bash
pnpm install
pnpm db:start          # lokales Supabase (Docker) starten
pnpm db:reset          # Migrationen + neutrale Beispieldaten einspielen
cp apps/web/.env.example apps/web/.env.local        # Werte aus `pnpm exec supabase status`
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm dev:web           # http://localhost:3000
pnpm dev:mobile        # Expo Dev Server (QR-Code mit Expo Go scannen)
```

Die vollständige Anleitung – inklusive Anlegen des einen Benutzers, Supabase-Cloud-Projekt
und Android-Gerät – steht in **[docs/setup.md](docs/setup.md)**.

## Produktion

Die Website wird als Docker-Image (Next.js Standalone, `Dockerfile` im Wurzelverzeichnis) mit
Coolify betrieben; Supabase läuft als eigene Ressource. Einstellungen, Variablen und Prüfungen
nach dem Deployment: **[docs/deployment-coolify.md](docs/deployment-coolify.md)**. Neue
Migrationen werden nur gemeinsam mit dem Benutzer nach
**[docs/production-migration-runbook.md](docs/production-migration-runbook.md)** bzw.
[docs/production-migration-20261009.md](docs/production-migration-20261009.md) angewendet;
private App-Builds: **[docs/mobile-preview-build.md](docs/mobile-preview-build.md)**.

## Befehle

| Befehl                                       | Zweck                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev:web`                               | Web-App im Entwicklungsmodus                                                      |
| `pnpm dev:mobile`                            | Expo Dev Server                                                                   |
| `pnpm lint`                                  | ESLint in allen Paketen (Turborepo)                                               |
| `pnpm typecheck`                             | TypeScript (strict) in allen Paketen                                              |
| `pnpm test`                                  | Unit-, Komponenten- und Integrationstests                                         |
| `pnpm check`                                 | lint + typecheck + test                                                           |
| `pnpm build`                                 | Produktions-Build der Web-App (ohne echte Zugangsdaten möglich)                   |
| `pnpm format`                                | Prettier                                                                          |
| `pnpm check:secrets`                         | Secret- und Datenschutz-Scan aller Repo-Dateien                                   |
| `pnpm db:start/stop`                         | Lokales Supabase starten/stoppen                                                  |
| `pnpm db:reset`                              | Lokale DB neu aufsetzen (Migrationen + Seed)                                      |
| `pnpm db:test`                               | pgTAP-Sicherheitstests (RLS, Grants, Constraints)                                 |
| `pnpm db:upgrade-test`                       | Upgrade-Test: neue Migrationen lassen vorhandene Daten unverändert (lokal)        |
| `pnpm db:concurrency-test`                   | Gleichzeitige Wechsel/Starts von Aktivitäten mit zwei echten DB-Sitzungen (lokal) |
| `pnpm connector:e2e`                         | Claude-Connector: alle sieben Tools und OAuth gegen die lokale DB                 |
| `pnpm --filter @tagestakt/mobile run doctor` | Expo Doctor (Abhängigkeiten und Konfiguration der App)                            |
| `pnpm db:lint`                               | Supabase-Datenbank-Lint                                                           |
| `pnpm db:types`                              | TypeScript-Typen aus der lokalen DB generieren                                    |

## Sicherheit

Bitte vor Änderungen lesen: **[docs/security.md](docs/security.md)** und [CLAUDE.md](CLAUDE.md).
Kurz: keine Secrets im Repository, keine öffentliche Registrierung, RLS auf jeder Tabelle,
Service-Role-/Secret-Keys niemals in Web-Client oder App.

## Lizenz

Privates Projekt – keine Lizenz zur Weiterverwendung erteilt.

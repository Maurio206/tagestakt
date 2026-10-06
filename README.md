# TagesTakt

Private Wochenplanung für **genau einen Benutzer**. Die mobile App zeigt auf dem eigenen
Smartphone, was gerade ansteht, was als Nächstes kommt und wie die Woche aufgebaut ist.
Geplant wird über eine geschützte Verwaltungswebsite.

> Status: MVP (Phase 1). Ein späterer Claude-Agent, der Wochenpläne als Entwurf hochlädt, ist
> konzipiert ([docs/agent-integration.md](docs/agent-integration.md)), aber **nicht** implementiert.

## Architektur auf einen Blick

```
apps/web     Next.js (App Router) – Verwaltungswebsite: Login, Übersicht, Wocheneditor,
             Wiederholungen, Einstellungen. Server-seitige Auth + zentrale Data-Access-Schicht.
apps/mobile  Expo / React Native (Expo Router) – „Jetzt“, Tag, Woche, Einstellungen.
             Session in SecureStore, Offline-Cache des zuletzt veröffentlichten Plans.
packages/schedule-schema
             Gemeinsame Zod-Schemas, Typen, Konstanten und Zeitlogik (Europe/Berlin).
packages/config
             Gemeinsame ESLint- und TypeScript-Basiskonfiguration.
supabase     Versionierte SQL-Migrationen, RLS, Grants, neutrale Seed-Daten, pgTAP-Tests.
docs         Architektur, Sicherheit, Datenmodell, Einrichtung, Agent-Konzept.
```

Web und App verwenden denselben Supabase-Auth-Benutzer und denselben gemeinsamen
Wochenplan-Typ (`ScheduleWeekWithEntries`). Zugriff auf Daten wird ausschließlich durch
**Row Level Security + Postgres-Grants** begrenzt – der öffentliche Publishable Key allein
gewährt keinerlei Zugriff.

Details: [docs/architecture.md](docs/architecture.md) · [docs/data-model.md](docs/data-model.md)

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
nach dem Deployment: **[docs/deployment-coolify.md](docs/deployment-coolify.md)**.

## Befehle

| Befehl               | Zweck                                                           |
| -------------------- | --------------------------------------------------------------- |
| `pnpm dev:web`       | Web-App im Entwicklungsmodus                                    |
| `pnpm dev:mobile`    | Expo Dev Server                                                 |
| `pnpm lint`          | ESLint in allen Paketen (Turborepo)                             |
| `pnpm typecheck`     | TypeScript (strict) in allen Paketen                            |
| `pnpm test`          | Unit-, Komponenten- und Integrationstests                       |
| `pnpm check`         | lint + typecheck + test                                         |
| `pnpm build`         | Produktions-Build der Web-App (ohne echte Zugangsdaten möglich) |
| `pnpm format`        | Prettier                                                        |
| `pnpm check:secrets` | Secret- und Datenschutz-Scan aller Repo-Dateien                 |
| `pnpm db:start/stop` | Lokales Supabase starten/stoppen                                |
| `pnpm db:reset`      | Lokale DB neu aufsetzen (Migrationen + Seed)                    |
| `pnpm db:test`       | pgTAP-Sicherheitstests (RLS, Grants, Constraints)               |
| `pnpm db:lint`       | Supabase-Datenbank-Lint                                         |
| `pnpm db:types`      | TypeScript-Typen aus der lokalen DB generieren                  |

## Sicherheit

Bitte vor Änderungen lesen: **[docs/security.md](docs/security.md)** und [CLAUDE.md](CLAUDE.md).
Kurz: keine Secrets im Repository, keine öffentliche Registrierung, RLS auf jeder Tabelle,
Service-Role-/Secret-Keys niemals in Web-Client oder App.

## Lizenz

Privates Projekt – keine Lizenz zur Weiterverwendung erteilt.

# CLAUDE.md – Projektregeln für TagesTakt

Private Wochenplanungs-App für genau einen Benutzer (pnpm-Monorepo: `apps/web` Next.js,
`apps/mobile` Expo, `packages/schedule-schema`, `supabase/`). Details: `README.md`, `docs/`.

## Unverhandelbare Regeln

- **Keine Secrets im Repository.** Nur `.env.example` mit Platzhaltern. Keine Passwörter,
  Tokens, privaten Schlüssel, Service-Role-/Secret-Keys. Ein privates GitHub-Repo ist kein
  Secret-Speicher. Vor jedem Commit: `pnpm check:secrets`.
- **Keine echten persönlichen Daten** im Repo: keine echten Termine, Namen, Orte, E-Mail-Adressen.
  Beispiele nur frei erfunden und als „(Beispiel)“ erkennbar, E-Mails nur `@tagestakt.test`.
  Persönliche Wochenpläne gehören in die Datenbank, nie als JSON-Datei in Git.
- **Service-Role-/Secret-Keys nur serverseitig** – nie in `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`,
  Client-Komponenten oder im App-Bundle. Die Web-App kommt aktuell komplett ohne aus.
- **Keine öffentliche Registrierung**, kein „Registrieren“-Button. Der eine Benutzer wird manuell
  in Supabase angelegt.
- **Tokens in der App nur in Expo SecureStore** (`src/lib/secure-storage.ts`). AsyncStorage
  ausschließlich für den Plan-Cache (`src/lib/plan-cache.ts`) – ESLint erzwingt das.
- **Keine Deployments, keine kostenpflichtigen Aktionen, kein Force-Push** ohne Rückfrage.

## Datenbank

- Änderungen **nur über neue Migrationen** in `supabase/migrations/` – nie manuell im Dashboard.
  Bestehende, bereits angewendete Migrationen nicht nachträglich ändern.
- **Jede neue Tabelle braucht:** `owner_id uuid not null default auth.uid() references auth.users`,
  `alter table … enable row level security`, getrennte Policies für SELECT/INSERT/UPDATE/DELETE
  (`to authenticated`, `(select auth.uid()) = owner_id`), explizite Grants
  (`revoke all … from anon, authenticated` + gezielte `grant … to authenticated`), Index auf
  `owner_id` bzw. Fremdschlüssel, `updated_at`-Trigger.
- **Keine Views** im `public`-Schema, keine `security definer`-Funktionen im `public`-Schema.
- Neue Tabellen in `supabase/tests/01_security_baseline.test.sql` aufnehmen (die Tabellenanzahl
  ist dort bewusst fest) und Negativtests in `02_rls_access.test.sql` ergänzen.
- Nach Schemaänderungen: `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types`.
- Neue Migrationen zusätzlich mit `pnpm db:upgrade-test` prüfen (Altdaten bleiben per
  Fingerabdruck identisch); Produktion nur gemeinsam mit dem Benutzer nach
  `docs/production-migration-runbook.md`.

## Fachlogik und Zeit

- Planungszeitzone ist **`Europe/Berlin`** (`SCHEDULE_TIMEZONE`). Zeitlogik ausschließlich über
  `packages/schedule-schema/src/time.ts` / `schedule.ts` – nicht in Apps nachbauen.
- **Änderungen an Zeitlogik immer mit Tests** (Sommer-/Winterzeit, Mitternacht, Wochenwechsel)
  in `packages/schedule-schema/src/*.test.ts`.
- Eingaben werden in Web, App und später beim Agenten mit **denselben Zod-Schemas** validiert.
- Überschneidungen werden nicht verhindert, sondern gewarnt (`detectOverlaps`).
- Der Claude-Connector plant, ändert und veröffentlicht gültige Pläne selbstständig (Entscheidung
  des Benutzers vom 10.10.2026): `save_week_draft` mit `publish: true` bzw. `publish_week_draft`.
  Der Server prüft jeden Plan vollständig, die vorherige Version wird archiviert, Claude berichtet
  jede Änderung mit Grund (siehe `docs/claude-connector.md`). Abweichungen von Wiederholungen,
  Zeitfenstern und Einzelterminen gelten nur für eine Woche; Wiederholungen und Regeln selbst
  ändert der Connector nie. Kein Anthropic-API-Schlüssel in TagesTakt.

## Web (Next.js)

- Jede geschützte Seite und **jede Server Action** prüft serverseitig über die Data-Access-Schicht
  (`src/server/auth.ts` → `authorizedClient()`); Proxy/Middleware allein reicht nicht.
- `src/components` und `src/lib` importieren nichts aus `src/server` und kein `@supabase/*`.
- Fehlermeldungen an die UI ohne interne Details; Logs nur mit Fehlercodes – nie Passwörter,
  Tokens oder Termininhalte protokollieren.

## UI

- Oberfläche **auf Deutsch**, ruhig, Dark Mode bevorzugt, gute Kontraste, große Touch-Ziele (≥ 44 px).
- Kategorien immer als Text **und** zurückhaltende Farbe. Keine externen Schriften, kein Tracking,
  keine Analyse-/Werbe-SDKs, keine unnötigen Geräteberechtigungen.

## Qualität

- TypeScript strict. Vor dem Commit: `pnpm check` (lint, typecheck, test), `pnpm format:check`,
  `pnpm check:secrets`; bei DB-Änderungen zusätzlich `pnpm db:test`.
- Kleine Commits mit Conventional-Commit-Nachrichten.
- pnpm 11 blockiert Pakete, die jünger als 24 h sind (Supply-Chain-Schutz) – nicht aushebeln,
  sondern eine ältere Version wählen.

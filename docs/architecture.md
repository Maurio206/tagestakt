# Architektur

## Komponenten

```
                ┌────────────────────────────── Supabase ──────────────────────────────┐
                │  Auth (genau 1 Benutzer, keine Registrierung)                          │
                │  Postgres: user_settings · recurring_commitments ·                     │
                │            schedule_weeks · schedule_entries                           │
                │  RLS + Grants: nur owner_id = auth.uid(); anon hat keinerlei Rechte    │
                │  RPC (SECURITY INVOKER): create_schedule_draft, publish_schedule_week, │
                │                          add_schedule_entries                          │
                └───────────▲───────────────────────────────────────▲──────────────────┘
                            │ HTTPS, Publishable Key                │ HTTPS, Publishable Key
                            │ + Benutzer-JWT (Cookie, serverseitig) │ + Benutzer-JWT (SecureStore)
┌───────────────────────────┴──────────────┐        ┌───────────────┴──────────────────────────┐
│ apps/web (Next.js, App Router)            │        │ apps/mobile (Expo / React Native)         │
│  proxy.ts: CSP-Nonce, Session-Refresh,    │        │  Login → Session in SecureStore           │
│            Umleitung zu /login            │        │  TanStack Query lädt veröffentlichte      │
│  src/server: Auth-Prüfung + Data-Access-  │        │  Wochen (Vor-, aktuelle, nächste Woche)   │
│            Schicht + Server Actions       │        │  Cache in AsyncStorage → Offline-Anzeige  │
│  Browser ↔ nur eigener Server (kein       │        │  Ansichten: Jetzt · Tag · Woche ·         │
│            direkter Supabase-Zugriff)     │        │            Einstellungen                  │
└───────────────────────────▲──────────────┘        └───────────────────────────────────────────┘
                            │
               packages/schedule-schema (gemeinsam): Zod-Schemas, Typen, Konstanten,
               Zeitlogik Europe/Berlin, Überschneidungen, Gewerbeminuten, Jetzt/Als Nächstes
```

## Datenfluss

**Planen (Web):**

1. Browser sendet Formulare an Server Actions (gleiche Origin; Next.js prüft Origin/Host).
2. Jede Server Action validiert die Eingabe mit dem gemeinsamen Zod-Schema und ruft die
   Data-Access-Schicht auf (`apps/web/src/server/data/*`).
3. Die Data-Access-Schicht prüft die Anmeldung serverseitig (`supabase.auth.getUser()` +
   optionale Eigentümer-UUID) und schreibt mit dem **Benutzer-JWT** – RLS und Trigger greifen
   vollständig. Es gibt keinen Service-Role-Key in der Web-App.
4. Veröffentlichen ruft `publish_schedule_week` auf: atomar wird die bisher veröffentlichte
   Version archiviert und der Entwurf veröffentlicht.

**Anzeigen (App):**

1. Die App meldet sich mit E-Mail/Passwort direkt bei Supabase Auth an; die Session liegt
   ausschließlich in Expo SecureStore.
2. Sie lädt nur Wochen mit `status = 'published'` (Vorwoche, aktuelle, nächste Woche) plus
   Wochenziel, validiert sie mit `planSnapshotSchema` und speichert den Stand als Cache.
3. „Jetzt“, „Als Nächstes“, Restzeit und Gewerbefortschritt werden lokal aus dem Snapshot
   berechnet – mit derselben Logik wie im Web.

## Warum Web und App dieselbe Auth-Identität verwenden

- Es gibt genau einen Menschen und damit genau einen Supabase-Auth-Benutzer. Alle Zeilen tragen
  dessen `owner_id`; RLS vergleicht mit `auth.uid()`. Dadurch gelten **identische Regeln** für
  Web und App, ohne zweites Rechtemodell.
- Kein „technischer“ Benutzer und kein Service-Role-Key wird benötigt – ein kompromittierter
  Client kann höchstens das, was der angemeldete Benutzer ohnehin darf.
- Web und App halten **getrennte Sessions** (Web: httpOnly-Cookies auf dem Server, App:
  SecureStore). Abmelden im Web beendet die App-Session nicht und umgekehrt.

## Offline-Verhalten (App)

- Nach jedem erfolgreichen Laden wird der Snapshot (nur veröffentlichte Pläne, keine Tokens) in
  AsyncStorage gespeichert.
- Beim Start wird zuerst der Cache angezeigt, parallel wird aktualisiert (Pull-to-Refresh,
  alle 15 Minuten, manuell in den Einstellungen).
- Schlägt das Laden fehl, bleibt der Cache sichtbar mit deutlichem Hinweis
  „Offline – gespeicherter Plan“ und dem Zeitpunkt der letzten erfolgreichen Aktualisierung.
- Ist der Stand älter als 6 Stunden, erscheint „Plan möglicherweise veraltet“.
- Ein beschädigter Cache wird verworfen statt die App abstürzen zu lassen.
- Beim Abmelden werden Session und Cache gelöscht – auch offline.

## Planversionierung

```
           create_schedule_draft            publish_schedule_week
 (leer) ───────────────────────▶ draft ─────────────────────────▶ published ─▶ archived
                                   ▲                                  │   (bei nächster
                                   └── neue Version (Kopie) ◀──────────┘    Veröffentlichung)
```

- Pro Benutzer und Woche gibt es höchstens **einen Entwurf** und **eine veröffentlichte Version**
  (partielle Unique-Indizes). Versionen sind fortlaufend (1, 2, 3 …) und unveränderlich.
- „Als neue Version bearbeiten“ kopiert die veröffentlichte Version in einen neuen Entwurf; die
  veröffentlichte Version bleibt bis zur nächsten Veröffentlichung unverändert in der App sichtbar.
- Inhalte veröffentlichter/archivierter Versionen sind schreibgeschützt (Trigger); nur der
  Erledigt-Status darf sich ändern. Nur Entwürfe dürfen gelöscht werden.
- Neue Wochen können **nur als Entwurf** angelegt werden – auch ein späterer Agent kann also nie
  direkt veröffentlichen.

## Grenze zum späteren Agenten

Der Claude-Agent ist **nicht** Teil dieser Phase. Vorbereitet sind:

- der Entwurfs-Workflow (Agent → Entwurf, Mensch → Veröffentlichen),
- die Quelle `source = 'agent'` in `schedule_entries`,
- das Vertragsschema `agentDraftRequestSchema` in `packages/schedule-schema` (nicht exponiert),
- das Konzept in [agent-integration.md](agent-integration.md).

Es gibt keinen Agent-Endpunkt, keinen Agent-Schlüssel und keine Agent-Tabellen.

## Technologieentscheidungen und Abweichungen

| Thema                            | Entscheidung                               | Begründung                                                                                                         |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Paketmanager                     | pnpm 11 + Turborepo 2.11                   | pnpm 11 ist die stabile, gepflegte Linie mit Release-Alter-Schutz; pnpm 12 war erst wenige Wochen alt.             |
| `nodeLinker: hoisted`            | flaches `node_modules`                     | Offizielle Empfehlung für React Native/Metro in pnpm-Monorepos.                                                    |
| TypeScript 6.0                   | statt 7.0                                  | Expo SDK 57 und typescript-eslint unterstützen 7.0 noch nicht.                                                     |
| ESLint 9                         | statt 10                                   | `eslint-plugin-react` (über Next/Expo-Configs) unterstützt ESLint 10 noch nicht.                                   |
| Next.js 16 `proxy.ts`            | statt `middleware.ts`                      | In Next.js 16 umbenannt.                                                                                           |
| `@supabase/ssr` nur serverseitig | kein Browser-Client                        | Weniger Angriffsfläche; Session-Cookies können `httpOnly` sein.                                                    |
| Zeitlogik ohne Zusatzbibliothek  | `Intl.DateTimeFormat`                      | Klein, testbar, in Node und Hermes identisch; DST-Strategie wie TC39 Temporal „compatible“.                        |
| Expo Router Tabs                 | `expo-router/js-tabs`                      | Der frühere Export `Tabs` aus `expo-router` ist veraltet.                                                          |
| SecureStore-Chunking             | Session in Abschnitten ≤ 1800 Zeichen      | Supabase-Sessions können größer als die SecureStore-Empfehlung sein; keine Eigen-Kryptografie nötig.               |
| Wiederholungen über Mitternacht  | `end_time ≤ start_time` = Folgetag         | Schlaf (z. B. 22:30–06:30) muss als ein Block planbar sein. Für konkrete Einträge gilt strikt `end_at > start_at`. |
| Zeitzone                         | DB-Constraint `timezone = 'Europe/Berlin'` | Die gesamte Logik ist auf diese Zone ausgelegt; eine Erweiterung erfordert bewusst eine Migration.                 |

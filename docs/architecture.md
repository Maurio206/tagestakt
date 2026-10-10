# Architektur

## Komponenten

```
                ┌────────────────────────────── Supabase ──────────────────────────────┐
                │  Auth (genau 1 Benutzer, keine Registrierung)                          │
                │  Postgres: user_settings · recurring_commitments ·                     │
                │            schedule_weeks · schedule_entries · activity_sessions ·     │
                │            daily_notes                                                 │
                │  RLS + Grants: nur owner_id = auth.uid(); anon hat keinerlei Rechte    │
                │  RPC (SECURITY INVOKER): create_schedule_draft, publish_schedule_week, │
                │    add_schedule_entries, start/stop/correct/switch_activity_session,   │
                │    save_daily_note                                                     │
                └───────────▲───────────────────────────────────────▲──────────────────┘
                            │ HTTPS, Publishable Key                │ HTTPS, Publishable Key
                            │ + Benutzer-JWT (Cookie, serverseitig) │ + Benutzer-JWT (SecureStore)
┌───────────────────────────┴──────────────┐        ┌───────────────┴──────────────────────────┐
│ apps/web (Next.js, App Router)            │        │ apps/mobile (Expo / React Native)         │
│  proxy.ts: CSP-Nonce, Session-Refresh,    │        │  Login → Session in SecureStore           │
│            Umleitung zu /login            │        │  TanStack Query lädt veröffentlichte      │
│  src/server: Auth-Prüfung + Data-Access-  │        │  Wochen (Vor-, aktuelle, nächste Woche)   │
│            Schicht + Server Actions       │        │  Cache in AsyncStorage → Offline-Anzeige  │
│  Browser ↔ nur eigener Server (kein       │        │  Ansichten: Jetzt · Tag · Woche · Mehr    │
│            direkter Supabase-Zugriff)     │        │  lokal: App-Sperre, Erinnerungen          │
└───────────────────────────▲──────────────┘        └───────────────────────────────────────────┘
                            │
               packages/schedule-schema (gemeinsam): Zod-Schemas, Typen, Konstanten,
               Zeitlogik Europe/Berlin, Überschneidungen, Ziele (Plan/Ist/Status),
               Erinnerungsplanung, Jetzt/Als Nächstes, Fokuszustand (focus.ts),
               Tagesnotiz-Schema und Editorzustand (daily-notes.ts)
               packages/design-tokens (gemeinsam): Farben, Typografie, Abstände, Kategorie-
               und Statusdarstellung für Web (CSS-Variablen) und App (Theme)
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
3. „Jetzt“, „Als Nächstes“, Restzeit und Zielfortschritt werden lokal aus dem Snapshot
   berechnet – mit derselben Logik wie im Web. Der Snapshot enthält zusätzlich die erfassten
   Aktivitäten dieser Wochen, die Wochenziele und die Erinnerungs-Vorgaben.

**Zeit erfassen (Web und App):**

1. „Fokus starten“ bzw. „Aktivität starten“ ruft `start_activity_session` auf; Beginn und Ende
   setzt immer der Server (`now()`), nie die Geräteuhr. Der Timer zeigt die Differenz zur
   Serverzeit des Beginns und übersteht dadurch Neustarts und Gerätewechsel.
2. „Beenden“ ruft `stop_activity_session` auf; „Zeit korrigieren“ `correct_activity_session`
   (danach als „korrigiert“ gekennzeichnet).
3. „Zu … wechseln“ ruft **eine** Funktion auf: `switch_activity_session` beendet die laufende und
   startet die neue Aktivität in einer Transaktion mit demselben Serverzeitpunkt. Scheitert der
   Start, bleibt die bisherige Aktivität unverändert.
4. Die Datenbank erzwingt höchstens eine laufende Aktivität, keine Überschneidungen und
   höchstens 24 h – auch bei gleichzeitigen Anfragen aus Web und App (Advisory-Sperre pro
   Benutzer, partieller Unique-Index; geprüft mit `pnpm db:concurrency-test`).

**Plan bearbeiten (App):** dieselben RPCs wie im Web (`create_schedule_draft`, Einträge im
Entwurf, `publish_schedule_week`). Entwürfe werden nie lokal gespeichert; ohne Verbindung ist
der Modus gesperrt.

## Warum Web und App dieselbe Auth-Identität verwenden

- Es gibt genau einen Menschen und damit genau einen Supabase-Auth-Benutzer. Alle Zeilen tragen
  dessen `owner_id`; RLS vergleicht mit `auth.uid()`. Dadurch gelten **identische Regeln** für
  Web und App, ohne zweites Rechtemodell.
- Kein „technischer“ Benutzer und kein Service-Role-Key wird benötigt – ein kompromittierter
  Client kann höchstens das, was der angemeldete Benutzer ohnehin darf.
- Web und App halten **getrennte Sessions** (Web: httpOnly-Cookies auf dem Server, App:
  SecureStore). Abmelden im Web beendet die App-Session nicht und umgekehrt.

**Fokusfläche (Web-Übersicht und App „Jetzt“):**

1. `getFocusState` bestimmt aus veröffentlichten Blöcken und laufender Aktivität den Fokus:
   laufende Aktivität vor Planblock, sonst laufender Block (bei Überschneidung der zuletzt
   begonnene), sonst freie Zeit bzw. vor dem ersten / nach dem letzten Block, kein Plan.
2. Der Zustand liefert `nextChangeAt` (nächster Beginn, Ende des laufenden Blocks, Mitternacht,
   Hinweisgrenzen einer Aktivität). Web (`FocusStage`) und App (`NowView`) stellen genau dafür
   einen Timer – der Wechsel passiert ohne Neuladen an der Blockgrenze, dazwischen aktualisieren
   sich nur Zeitwerte (Minutentakt; Timer einer laufenden Aktivität sekündlich).
3. Vorheriger und nächster Block erscheinen klein, unscharf und angeschnitten, ohne
   Bedienelemente und für Screenreader verborgen; „Davor/Danach“ steht als Text im Fokusblock.

**Tagesnotiz (Web und App):**

1. Web: Server Action `saveDailyNoteAction` (Zod-Prüfung) → Data-Access-Schicht → RPC
   `save_daily_note` mit dem zuletzt gelesenen Bearbeitungsstand. App: direkt dieselbe RPC.
2. Gleicher Editorzustand (`noteEditorReducer`) in Web und App: höchstens eine Speicherung
   gleichzeitig, Antworten werden über eine Anfrage-ID zugeordnet, eine ältere Antwort ersetzt nie
   neuere Eingaben. Konflikte (`TT007`) zeigen beide Fassungen zur Wahl.
3. Notizen hängen am Kalendertag, nicht an einer Planversion, und werden in der App nur online
   geladen (kein Offline-Cache, keine Erinnerungen).

## Offline-Verhalten (App)

- Nach jedem erfolgreichen Laden wird der Snapshot (nur veröffentlichte Pläne, keine Tokens,
  keine Notizen oder Planungshinweise) in AsyncStorage gespeichert.
- Beim Start wird zuerst der Cache angezeigt, parallel wird aktualisiert (Pull-to-Refresh,
  alle 15 Minuten, manuell in den Einstellungen).
- Schlägt das Laden fehl, bleibt der Cache sichtbar mit deutlichem Hinweis
  „Offline – gespeicherter Plan“ und dem Zeitpunkt der letzten erfolgreichen Aktualisierung.
- Ist der Stand älter als 6 Stunden, erscheint „Plan möglicherweise veraltet“.
- Ein beschädigter Cache wird verworfen statt die App abstürzen zu lassen.
- **Offline wird nichts geschrieben und nichts vorgemerkt** (keine Warteschlange): Starten,
  Beenden, Korrigieren, Erledigt-Status, Ziele und Bearbeiten sind ohne Verbindung gesperrt und
  erklären warum. Ein laufender Timer läuft offline sichtbar weiter, weil er nur aus dem
  gespeicherten Beginn rechnet. Eine robuste Offline-Warteschlange wäre ein eigenes Vorhaben
  (Konflikte mit Web-Änderungen, Serverzeit).
- **Tagesnotizen** sind offline nicht verfügbar: Die App erklärt das („Ohne Verbindung nicht
  verfügbar“) und zeigt keine gespeicherte oder vorgetäuschte Notiz.
- Beim Abmelden werden Session, Cache, Geräteeinstellungen und geplante Erinnerungen gelöscht –
  auch offline.

## Gerätelokale Funktionen (App)

- **App-Sperre** (`src/lib/app-lock.ts`, `src/components/app-lock.tsx`): Standard aus; sperrt
  beim Kaltstart und nach der eingestellten Hintergrundzeit. Zustandslogik als reine Funktion
  (`nextLockState`). Im Hintergrund verdeckt eine neutrale Schutzfläche alle Inhalte; bei
  eingeschalteter Sperre bleibt die Vorschau im App-Umschalter leer (`src/lib/screen-privacy.ts`,
  `FLAG_SECURE` – sperrt dann auch Screenshots).
- **Erinnerungen** (`src/lib/notifications.ts`, `src/hooks/use-reminder-sync.ts`): werden nach
  jedem neuen Planstand, bei Rückkehr in die App und nach Änderungen vollständig neu geplant
  (`planReminders` aus `packages/schedule-schema`). Erinnerungen an „nicht gestartet“ entfallen,
  sobald Zeit für den Block erfasst wird.
- Beide Einstellungen gelten nur für dieses Gerät und liegen in SecureStore
  (`src/lib/device-settings.ts`). Die Erinnerungs-**Vorgaben** (Vorlauf, Umfang) liegen dagegen
  in `user_settings` und gelten für Web und App.

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
- Neue Wochen können **nur als Entwurf** angelegt werden. Veröffentlicht wird nur über
  `publish_schedule_week` bzw. `publish_reviewed_schedule_week` – durch den Benutzer in Web/App
  oder selbstständig über den Claude-Connector (nur gültige Pläne).

## Claude-Connector (Remote MCP)

Claude plant in der Claude-App bzw. in Claude Cowork; TagesTakt ruft selbst kein Sprachmodell
auf. Die Website stellt unter `/mcp` einen Remote-MCP-Server (Streamable HTTP, zustandslos) mit
eigenem OAuth-2.1-Autorisierungsserver bereit (`apps/web/src/server/connector`):

```
Claude-App ──HTTPS, OAuth──▶ /mcp (Next.js) ──Rolle tagestakt_connector──▶ Postgres (RLS als Owner)
                                                                          │
                       Website, Android-App, Widget lesen nur veröffentlichte Wochen ◀┘
```

- Sechs feste Tools: Kontext lesen, prüfen, Entwurf speichern (optional direkt veröffentlichen),
  lesen, verwerfen und veröffentlichen.
- Planbar sind die laufende Woche (ab jetzt; Begonnenes bleibt unverändert) und die nächsten
  vier Wochen. Abweichungen von Wiederholungen und Regeln gelten nur für eine Woche und werden
  ausdrücklich mit Grund genannt; die Wiederholungen selbst bleiben unverändert.
- Regeln und Prüfung kommen aus `packages/schedule-schema/src/planner.ts` – dieselben wie in der
  Website. Claude erhält nur Zeiten und neutrale Arten.
- OAuth-Daten liegen als Hashes im nicht exponierten Schema `connector`; Planungsdaten nur über
  RLS mit den Claims des Owners.

Details und Bedrohungsanalyse: [claude-connector.md](claude-connector.md). Das ältere Konzept
eines eigenen Agent-Endpunkts ([agent-integration.md](agent-integration.md)) ist dadurch abgelöst.

## Technologieentscheidungen und Abweichungen

| Thema                            | Entscheidung                                   | Begründung                                                                                                         |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Paketmanager                     | pnpm 11 + Turborepo 2.11                       | pnpm 11 ist die stabile, gepflegte Linie mit Release-Alter-Schutz; pnpm 12 war erst wenige Wochen alt.             |
| `nodeLinker: hoisted`            | flaches `node_modules`                         | Offizielle Empfehlung für React Native/Metro in pnpm-Monorepos.                                                    |
| TypeScript 6.0                   | statt 7.0                                      | Expo SDK 57 und typescript-eslint unterstützen 7.0 noch nicht.                                                     |
| ESLint 9                         | statt 10                                       | `eslint-plugin-react` (über Next/Expo-Configs) unterstützt ESLint 10 noch nicht.                                   |
| Next.js 16 `proxy.ts`            | statt `middleware.ts`                          | In Next.js 16 umbenannt.                                                                                           |
| `@supabase/ssr` nur serverseitig | kein Browser-Client                            | Weniger Angriffsfläche; Session-Cookies können `httpOnly` sein.                                                    |
| Zeitlogik ohne Zusatzbibliothek  | `Intl.DateTimeFormat`                          | Klein, testbar, in Node und Hermes identisch; DST-Strategie wie TC39 Temporal „compatible“.                        |
| Expo Router Tabs                 | `expo-router/js-tabs`                          | Der frühere Export `Tabs` aus `expo-router` ist veraltet.                                                          |
| SecureStore-Chunking             | Session in Abschnitten ≤ 1800 Zeichen          | Supabase-Sessions können größer als die SecureStore-Empfehlung sein; keine Eigen-Kryptografie nötig.               |
| Wiederholungen über Mitternacht  | `end_time ≤ start_time` = Folgetag             | Schlaf (z. B. 22:30–06:30) muss als ein Block planbar sein. Für konkrete Einträge gilt strikt `end_at > start_at`. |
| Zeitzone                         | DB-Constraint `timezone = 'Europe/Berlin'`     | Die gesamte Logik ist auf diese Zone ausgelegt; eine Erweiterung erfordert bewusst eine Migration.                 |
| Plan und Ist getrennt            | eigene Tabelle `activity_sessions`             | `completion_status` bleibt Planstatus; Ziele zählen nur tatsächlich erfasste Zeit.                                 |
| Symbole                          | Lucide (`lucide-react`, `lucide-react-native`) | Einheitlich in Web und App, als Komponenten gebündelt (keine externen Ressourcen, CSP bleibt streng).              |
| Erinnerungen                     | `expo-notifications`, nur lokal                | Kein Push-Dienst nötig; keine Exact-Alarm-Berechtigung (dafür nicht minutengenau).                                 |
| Tagesnotiz                       | eigene Tabelle `daily_notes`, eigene Migration | Unabhängig von Planversionen; additive Migration mit eigenem Rollback statt Änderung der Aktivitäts-Migration.     |
| Wochenplanung mit Claude         | Remote-MCP-Connector statt API-Aufruf          | Claude plant im Gespräch in der Claude-App; kein API-Schlüssel und keine Modellkosten im Server, gleiche Prüfung.  |
| Unschärfe der Nachbarblöcke      | CSS `filter: blur` bzw. RN `filter` (Android)  | iOS unterstützt `blur` in React Native nicht – dort nur blass und angeschnitten.                                   |

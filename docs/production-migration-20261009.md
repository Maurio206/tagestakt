# Runbook: Wochenplanung und Claude-Connector in Produktion (20261009120000)

Betrifft genau eine Migration – `supabase/migrations/20261009120000_planning_rules.sql` – und das
anschließende Deployment der Website mit dem Claude-Connector
([claude-connector.md](claude-connector.md)).

> **Nur gemeinsam mit dem Benutzer ausführen** – nach frischem Backup, Vorprüfung und
> ausdrücklicher Freigabe. Immer nur ein Schritt, danach wird das Ergebnis abgewartet. Passwörter
> und Verbindungsadressen gibt nur der Benutzer selbst ein (Coolify-Terminal bzw. Coolify-Secret);
> sie erscheinen nie in Chat, Tickets, Dateien oder dem Repository. Die SQL-Dateien enthalten nur
> Struktur und Prüfungen, keine Daten.

## Was die Migration tut

Rein **additiv** – keine bestehende Tabelle, Spalte oder Zeile wird geändert:

- Tabellen `planning_preferences` (Gewerbe-Regeln, Pausen) und `planning_goal_slots`
  (Zeitfenster für Training und Beziehungszeit), jeweils mit `owner_id default auth.uid()`, RLS,
  vier Policies, Grants (`anon` nichts), Index und `updated_at`-Trigger,
- RPCs `schedule_week_fingerprint`, `save_generated_schedule_draft` (idempotent, ersetzt nur
  nicht-manuelle Einträge des Entwurfs), `publish_reviewed_schedule_week` und
  `discard_reviewed_schedule_draft` (SECURITY INVOKER, leerer `search_path`, nicht für `anon`),
- Rolle `tagestakt_connector` (**NOLOGIN**, NOINHERIT, nur Mitglied von `authenticated`) und das
  nicht über die API erreichbare Schema `connector` (OAuth-Freigaben, Token- und
  Bestätigungs-Hashes) mit RLS, Rechten nur für diese Rolle und Kaskaden.

Die **bisherige Website** läuft mit der migrierten Datenbank unverändert. Die **neue Website**
braucht die Migration für `/planen`, die Planungsregeln und den Connector. Die Android-App und
das Widget brauchen **keinen** neuen Build – sie lesen weiter nur veröffentlichte Pläne.

## Gesamtreihenfolge

| Nr. | Schritt                                                          | wo                             |
| --- | ---------------------------------------------------------------- | ------------------------------ |
| 0   | lokale Prüfungen, Feature-Branch gepusht                         | lokal                          |
| 1   | Backup                                                           | Coolify                        |
| 2   | Vorprüfung, Fingerabdruck, Migration, Fingerabdruck, Nachprüfung | Studio-SQL-Editor              |
| 3   | Passwort für `tagestakt_connector` setzen, LOGIN erlauben        | Coolify-Terminal `supabase-db` |
| 4   | Netzwerk Web-Container → Datenbank prüfen                        | Coolify                        |
| 5   | Variablen der Website setzen                                     | Coolify                        |
| 6   | `main` per Fast-Forward pushen → Deployment                      | lokal / Coolify                |
| 7   | Prüfungen nach dem Deployment                                    | Browser                        |
| 8   | Planungsregeln über die Oberfläche eintragen                     | Website `/einstellungen`       |
| 9   | Connector in Claude verbinden, erster Test                       | Claude-App                     |
| 10  | Sonntags-Aufgabe anlegen                                         | Claude-App / Cowork            |

Schritte 3–5 ändern nichts an Fachdaten; ohne sie bleibt der Connector abgeschaltet (404), die
Website läuft trotzdem.

## 0. Lokal (ohne Produktionszugriff)

```bash
pnpm db:reset
pnpm db:test
pnpm db:upgrade-test
pnpm db:concurrency-test
pnpm connector:e2e
```

`db:upgrade-test` prüft im Szenario „produktion“ genau die Lage in Produktion (Objekte gehören
`supabase_admin`, kein Migrationsverlauf): Vorprüfung „bereit“, Migration, Fingerabdruck der
Altdaten unverändert, Nachprüfung, Planungsabläufe auf Altdaten und Rückfall (inklusive Schema
`connector` und Rolle). `connector:e2e` prüft alle sieben Tools und OAuth gegen die lokale
Datenbank.

**Prüfsummen** (SHA-256, Stand dieses Runbooks; Dateien im Repository mit LF). Vor dem Kopieren
lokal vergleichen, z. B. `Get-FileHash <datei> -Algorithm SHA256` – bei Abweichung nicht
fortfahren:

| Datei                                                   | SHA-256                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `supabase/migrations/20261009120000_planning_rules.sql` | `d9726c9ed4bf03843d138cf54272cbd1a38dd124f617e2a9bafd03f9c8f83af4` |
| `scripts/db/production-precheck-20261009120000.sql`     | `9ada4ace2370c2815a0062b72c0853b4e3aa64616b137e31d81f6be959fcfa9d` |
| `scripts/db/data-fingerprint.sql`                       | `9b818dced4e58c7d45bb7f549d9451cda8dee4c438b30ff5b3ab796f7f74ad43` |
| `scripts/db/production-postcheck-20261009120000.sql`    | `25c5aaaab4b7c0fa03969ce141adb6ae9be2117322828c7a51e1157e7c44b9cf` |
| `scripts/db/rollback-20261009120000.sql`                | `382ee37b2810ba569d0a345249327a4174a62d936a9e721eadf211425bc6974c` |

## 1. Backup

In Coolify für die Supabase-Ressource **„Backup Now“**; Erfolg lokal **und** auf S3 sowie das
Inhaltsverzeichnis (`pg_restore -l`) prüfen. Ohne frisches, geprüftes Backup nicht fortfahren.

## 2. Studio-SQL-Editor als `supabase_admin`

Wie bei den vorigen Migrationen (siehe
[production-migration-runbook.md](production-migration-runbook.md), Abschnitt 4): jede Datei als
**eigene** Query vollständig ausführen; ein Run ist eine Transaktion.

1. `select current_user, session_user;` → beide `supabase_admin`.
2. **Vorprüfung:** Inhalt von `scripts/db/production-precheck-20261009120000.sql` ausführen.

   | Ausgabe                            | erwartet                                             |
   | ---------------------------------- | ---------------------------------------------------- |
   | `postgres_version`                 | 15 oder neuer                                        |
   | `ausfuehrende_rolle`               | `supabase_admin`                                     |
   | `vorherige_migrationen_angewendet` | `true` (20261007120000 und 20261008120000)           |
   | `basisfunktionen`                  | `4/4`                                                |
   | `planungsregeln_vorhanden`         | `false` (sonst ist die Migration schon da)           |
   | `neue_funktionen_vorhanden`        | `0`                                                  |
   | `connector_schema_vorhanden`       | `false`                                              |
   | `connector_rolle_vorhanden`        | `false`                                              |
   | `migrationsverlauf_vorhanden`      | `false` (wie bisher in Produktion)                   |
   | `fehlende_rechte`                  | leer                                                 |
   | `bereit_fuer_20261009120000`       | `true` – sonst **nicht** migrieren, gemeinsam klären |

3. **Fingerabdruck vorher:** `set transaction read only;` gefolgt vom Inhalt von
   `scripts/db/data-fingerprint.sql`. Ausgabe (nur Zeilenzahlen und Prüfsummen) festhalten.
4. **Freigabe des Benutzers einholen.** Dann den Inhalt von
   `supabase/migrations/20261009120000_planning_rules.sql` genau **einmal** ausführen →
   „Success. No rows returned“. Bei einem Fehler wird alles zurückgerollt: nicht
   improvisieren, Meldung sichern, gemeinsam analysieren.
5. **Fingerabdruck nachher** wie in Schritt 3 – muss **identisch** sein.
6. **Nachprüfung:** Inhalt von `scripts/db/production-postcheck-20261009120000.sql` →
   „Nachprüfung 20261009120000 erfolgreich“.

## 3. Passwort der Connector-Rolle setzen (Coolify-Terminal)

Die Migration legt `tagestakt_connector` ohne Passwort und ohne LOGIN an. Das Passwort entsteht
nur beim Benutzer und wird mit `\password` gesetzt: `psql` berechnet den SCRAM-Hash lokal, der
Klartext erreicht weder Server-Logs noch den Studio-Verlauf.

1. Passwort erzeugen (z. B. im Passwortmanager): **nur Buchstaben und Ziffern**, mindestens 40
   Zeichen – dann ist es ohne Kodierung in einer Verbindungsadresse verwendbar.
2. Coolify → Supabase-Ressource → Container `supabase-db` → **Terminal**:
   `psql -U supabase_admin -d postgres`
3. `\password tagestakt_connector` → Passwort zweimal einfügen.
4. `alter role tagestakt_connector login;`
5. Kontrolle ohne Inhalte:
   `select rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolbypassrls from pg_roles where rolname = 'tagestakt_connector';`
   → `t | f | f | f | f`. Dann `\q`.

## 4. Netzwerk: Web-Container → Datenbank

Der Connector verbindet sich **direkt** mit Postgres als `tagestakt_connector` (kein Pooler –
die Rolle muss exakt so heißen; keine öffentliche Datenbank-Freigabe). Der Container der Website
muss den Datenbank-Container im internen Docker-Netz erreichen:

1. Coolify → Supabase-Ressource: Name des Datenbank-Containers ablesen (Muster
   `supabase-db-<id>`) und prüfen, ob **„Connect To Predefined Network“** aktiv ist. Ist es aus,
   muss es aktiviert und die Supabase-Ressource neu gestartet werden – kurze Unterbrechung von
   Website und App, daher nur nach Freigabe.
2. Erreichbarkeit ohne Zugangsdaten prüfen – Coolify → Website → Terminal:
   `node -e "require('net').connect(5432,'supabase-db-<id>').on('connect',()=>{console.log('erreichbar');process.exit(0)}).on('error',(e)=>{console.log(e.code);process.exit(1)})"`
   → `erreichbar`.

## 5. Variablen der Website (Coolify → Website → Environment Variables)

| Variable                 | Wert                                                                                           | Build    | Laufzeit | Secret |
| ------------------------ | ---------------------------------------------------------------------------------------------- | -------- | -------- | ------ |
| `TAGESTAKT_PUBLIC_URL`   | `https://plan.north-frame.de`                                                                  | **nein** | **ja**   | nein   |
| `CONNECTOR_DATABASE_URL` | `postgres://tagestakt_connector:…@supabase-db-<id>:5432/postgres` (Passwort an der Stelle „…“) | **nein** | **ja**   | **ja** |

- Den Wert von `CONNECTOR_DATABASE_URL` tippt bzw. fügt **nur der Benutzer** ein.
- Bestehende Variablen bleiben: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `TAGESTAKT_OWNER_USER_ID`.
- **Nicht** anlegen bzw. falls vorhanden löschen: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (werden
  nicht mehr verwendet). Niemals `NEXT_PUBLIC_…` mit Datenbank- oder Connector-Bezug – die Website
  verweigert dann den Start.

## 6. Deployment

Coolify deployt aus `main`. Erst **nach** den Schritten 1–5:

1. Lokal den geprüften Stand von `feat/design-and-focus-tracking` per **Fast-Forward** nach
   `main` übernehmen und `main` pushen (kein Force-Push, keine Umschreibung).
2. Coolify-Deployment beobachten: `✓ Ready`, kein `Konfigurationsfehler`, keine Zeile
   `Claude-Connector deaktiviert: …` (sonst nennt sie den Grund, ohne Werte).

## 7. Prüfungen nach dem Deployment

| Prüfung                                                                          | Erwartung                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/health`                                                                    | 200                                                                                                                                        |
| `/wochenplan`, `/planen` ohne Anmeldung                                          | Weiterleitung auf `/login`                                                                                                                 |
| `/.well-known/oauth-protected-resource/mcp`                                      | JSON mit `"resource":"https://plan.north-frame.de/mcp"` und den drei Scopes                                                                |
| `/.well-known/oauth-authorization-server`                                        | JSON mit `authorization_endpoint` `…/oauth/authorize`, `token_endpoint` `…/api/oauth/token`, `code_challenge_methods_supported` `["S256"]` |
| `POST /mcp` ohne Token (z. B. `curl -i -X POST https://plan.north-frame.de/mcp`) | `401` mit `WWW-Authenticate: Bearer resource_metadata=…`                                                                                   |
| Website → Einstellungen → „Claude-Connector“                                     | Connector-URL `https://plan.north-frame.de/mcp`, „Derzeit ist Claude nicht verbunden.“                                                     |
| Wochenplan, App, Widget                                                          | unverändert der bisher veröffentlichte Plan                                                                                                |
| Browser-Bundle (`/_next/static`)                                                 | kein `sk-ant-`, kein `ANTHROPIC`, kein `tagestakt_connector`, kein `postgres://`                                                           |
| Coolify-Logs                                                                     | keine Tokens, Passwörter, Verbindungsadressen oder Planinhalte                                                                             |

## 8. Planungsregeln eintragen

Die persönlichen Regeln (Dienst als Wiederholung, Training, Beziehungszeit, Gewerbe-Rahmen,
Gewerbe-Minimum, Pausen) trägt der Benutzer selbst unter `/einstellungen` bzw. `/planen` ein. Sie
liegen nur in der Datenbank, nie im Repository. `/planen` zeigt danach keine fehlenden Angaben
mehr.

## 9. Connector in Claude verbinden und erster Test

1. Claude (claude.ai oder App) → **Customize → Connectors** → **Add custom connector**: Name
   `TagesTakt`, URL exakt `https://plan.north-frame.de/mcp` (ohne Schrägstrich am Ende – sie
   muss der Ressource in den Metadaten entsprechen). Falls der Dialog Einstellungen anbietet:
   Authentication **„Sign in now“**, OAuth client **„Use Claude's published identity“**.
   **Nicht** „Register automatically“ (dynamische Registrierung bietet TagesTakt bewusst nicht
   an) und keine eigene Client-ID bzw. kein Secret. Diese Einstellungen lassen sich später nicht
   ändern – sonst Connector entfernen und neu anlegen.
2. „Connect“ → Browser öffnet die TagesTakt-Freigabeseite → ggf. anmelden → Client
   (claude.ai) und Rechte prüfen → **„Zugriff erlauben“**. Meldet die Seite „Dieser Client ist
   für TagesTakt nicht zugelassen“, kommt das Client-Dokument nicht von claude.ai/claude.com:
   abbrechen und gemeinsam klären (nichts freigeben).
3. Tool-Berechtigungen unter **Customize → Connectors → TagesTakt**: Lese-Tools dürfen
   „Always allow“; `publish_week_draft` und `discard_week_draft` **nicht** auf „Always allow“
   stellen, damit Claude vor jedem Aufruf eine Bestätigung verlangt.
4. Website → Einstellungen → „Claude-Connector“ zeigt die Verbindung (Client, Rechte, „zuletzt
   genutzt“).
5. Erster Test im Chat: „Lies mit TagesTakt den Planungskontext der kommenden Woche und nenne mir
   nur, was fehlt und welche Entwurfsversion existiert.“ → Claude ruft nur
   `get_planning_context` auf; nichts wird gespeichert.
6. Erster Entwurf mit der Sonntags-Prompt (siehe [claude-connector.md](claude-connector.md)):
   Entwurf prüfen, erst nach „Wochenplan veröffentlichen“ veröffentlichen lassen. Danach müssen
   Website (`/wochenplan`), App (nach Synchronisierung) und Widget dieselbe neue Version zeigen.

## 10. Sonntags-Aufgabe

Claude-App bzw. Cowork → geplante Aufgabe, wöchentlich sonntags, Connector „TagesTakt“ aktiv,
Prompt aus [claude-connector.md](claude-connector.md#sonntags-aufgabe-in-claude).

## Rückfall

- **Connector abschalten** (häufigster Fall): Freigabe in den Einstellungen widerrufen und/oder
  `CONNECTOR_DATABASE_URL` in Coolify leeren und neu deployen. Optional im Coolify-Terminal
  `alter role tagestakt_connector nologin;`.
- **Website zurück:** vorherige Version erneut deployen – die additive Migration stört sie nicht.
- **Nur wenn die Datenbankänderung selbst zurück muss:** zuerst Website zurückrollen bzw.
  `CONNECTOR_DATABASE_URL` entfernen. Dann Inhalt von `scripts/db/rollback-20261009120000.sql`
  **ohne** die Zeilen `begin;` und `commit;` als eine Query ausführen. Entfernt Schema
  `connector` (Claude muss danach neu verbunden werden), Rolle `tagestakt_connector`, die vier
  RPCs und die beiden Regel-Tabellen. Sind bereits Planungsregeln gespeichert, bricht das Skript
  ohne Änderung ab; nur nach Backup und ausdrücklicher Entscheidung des Benutzers in derselben
  Query als erste Zeile `set local tagestakt.rollback_discard_planning_rules = 'ja';` voranstellen.
  Über den Connector gespeicherte Entwürfe und veröffentlichte Pläne bleiben erhalten (normale
  Wochenpläne). Danach Fingerabdruck wie in Schritt 2.3 vergleichen.

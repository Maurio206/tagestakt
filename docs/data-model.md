# Datenmodell

Quelle der Wahrheit: `supabase/migrations/*.sql`. Generierte Typen:
`packages/schedule-schema/src/database.types.ts` (`pnpm db:types`). Zod-Schemas:
`packages/schedule-schema/src/schemas.ts`.

Alle fachlichen Tabellen liegen im Schema `public`, besitzen `owner_id → auth.users(id)
on delete cascade` (Standard `auth.uid()`), aktivierte RLS, getrennte Policies für
SELECT/INSERT/UPDATE/DELETE und einen `updated_at`-Trigger.

## Tabellen

### `user_settings` (1 Zeile pro Benutzer)

| Spalte                             | Typ                | Standard / Regel                               |
| ---------------------------------- | ------------------ | ---------------------------------------------- |
| owner_id                           | uuid, PK           | `auth.uid()`                                   |
| timezone                           | text               | `Europe/Berlin` (MVP: nur dieser Wert erlaubt) |
| locale                             | text               | `de-DE`, Format `xx-XX`                        |
| weekly_business_target_minutes     | integer            | `1200` (= 20 h), 0 … 10080; 0 = kein Ziel      |
| weekly_sport_target_minutes        | integer, optional  | `NULL` = kein Ziel, sonst 1 … 10080            |
| weekly_relationship_target_minutes | integer, optional  | `NULL` = kein Ziel (Laila), sonst 1 … 10080    |
| reminder_minutes_before            | smallint, optional | `10`; `NULL` = keine Vorab-Erinnerung, 1 … 240 |
| remind_at_start                    | boolean            | `true`                                         |
| remind_if_not_started              | boolean            | `false`                                        |
| reminder_scope                     | text               | `important` · `goals` · `all`                  |
| created_at / updated_at            | timestamptz        | automatisch                                    |

Fehlt die Zeile, verwenden Web und App die Standardwerte; gespeichert wird per Upsert.
Die Ziel- und Erinnerungsspalten kamen mit `20261007120000_focus_tracking_and_goals.sql`
(rein additiv). Ein Ziel von 0 bzw. `NULL` zählt **nie** als „erreicht“.

Welche Erinnerungen ein Gerät tatsächlich zeigt, entscheidet zusätzlich eine **nur lokal**
gespeicherte Geräteeinstellung (Ein/Aus, „Titel zeigen“, Standard: aus) – siehe
[security.md](security.md).

### `recurring_commitments` (Vorlagen)

| Spalte                | Typ            | Regel                                                 |
| --------------------- | -------------- | ----------------------------------------------------- |
| id                    | uuid, PK       |                                                       |
| owner_id              | uuid           |                                                       |
| title                 | text           | 1–120 Zeichen (ohne Leerraum am Rand)                 |
| category              | text           | eine der 12 Kategorien                                |
| weekday               | smallint       | ISO 1 = Montag … 7 = Sonntag                          |
| start_time / end_time | time           | ungleich; `end_time ≤ start_time` = endet am Folgetag |
| location              | text, optional | ≤ 120 Zeichen                                         |
| note                  | text, optional | ≤ 1000 Zeichen                                        |
| active                | boolean        | Standard `true`                                       |

Index: `(owner_id, weekday, start_time)`.

### `schedule_weeks` (versionierte Wochenpläne)

| Spalte        | Typ            | Regel                                                           |
| ------------- | -------------- | --------------------------------------------------------------- |
| id            | uuid, PK       | zusätzlich `unique (id, owner_id)` als Ziel des Fremdschlüssels |
| owner_id      | uuid           | unveränderlich                                                  |
| week_start    | date           | muss ein Montag sein; unveränderlich                            |
| version       | integer        | > 0; unveränderlich; `unique (owner_id, week_start, version)`   |
| status        | text           | `draft` · `published` · `archived`                              |
| planning_note | text, optional | ≤ 2000 Zeichen                                                  |
| published_at  | timestamptz    | wird beim Veröffentlichen vom Trigger gesetzt                   |

Partielle Unique-Indizes: höchstens ein `draft` und ein `published` pro `(owner_id, week_start)`.

### `schedule_entries` (Zeitblöcke)

| Spalte            | Typ            | Regel                                                                                  |
| ----------------- | -------------- | -------------------------------------------------------------------------------------- |
| id                | uuid, PK       |                                                                                        |
| owner_id          | uuid           |                                                                                        |
| schedule_week_id  | uuid           | **zusammengesetzter FK** `(schedule_week_id, owner_id) → schedule_weeks(id, owner_id)` |
| title             | text           | 1–120 Zeichen                                                                          |
| category          | text           | eine der 12 Kategorien                                                                 |
| start_at / end_at | timestamptz    | `end_at > start_at`, Dauer ≤ 24 h, Beginn innerhalb der Woche (Europe/Berlin)          |
| location / note   | text, optional | ≤ 120 / ≤ 1000 Zeichen                                                                 |
| source            | text           | `manual` · `recurring` · `agent`                                                       |
| completion_status | text           | `planned` · `completed` · `skipped`                                                    |

Indizes: `(schedule_week_id, owner_id)` (Fremdschlüssel) und `(owner_id, start_at)`.

Zusätzlich `unique (id, owner_id)` als Ziel des Fremdschlüssels aus `activity_sessions`.

**Überschneidungen** sind in der Datenbank erlaubt; sie werden in der gemeinsamen Logik erkannt
(`detectOverlaps`) und in Web und App gewarnt.

### `activity_sessions` (tatsächlich erfasste Zeit)

Plan (`schedule_entries`) und Ist (`activity_sessions`) sind getrennt. Nur erfasste Zeit zählt
für die Wochenziele; `completion_status` bleibt ein reiner Planstatus.

| Spalte            | Typ                   | Regel                                                                                                                               |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| id                | uuid, PK              |                                                                                                                                     |
| owner_id          | uuid                  | `auth.uid()`; unveränderlich                                                                                                        |
| schedule_entry_id | uuid, optional        | **zusammengesetzter FK** `(schedule_entry_id, owner_id) → schedule_entries(id, owner_id)`, `on delete set null (schedule_entry_id)` |
| goal_category     | text                  | `business` · `sport` · `relationship`                                                                                               |
| title             | text                  | 1–120 Zeichen (ohne Planblock: Zielname)                                                                                            |
| started_at        | timestamptz           | Standard `now()` (Serverzeit), nicht in der Zukunft                                                                                 |
| ended_at          | timestamptz, optional | `NULL` = läuft; `> started_at`; Dauer ≤ 24 h                                                                                        |
| corrected_at      | timestamptz, optional | vom Trigger gesetzt, wenn Zeiten nachgetragen oder geändert wurden                                                                  |

Indizes: partieller Unique-Index `(owner_id) where ended_at is null` (höchstens **eine** laufende
Aktivität), `(owner_id, started_at)`, `(schedule_entry_id, owner_id)`.

Trigger `private.guard_activity_session`: Eigentümer unveränderlich, keine Zeiten in der Zukunft
(1 min Toleranz), laufend höchstens 24 h, Planblock nur aus einer **veröffentlichten** Version und
mit passendem Ziel, keine Überschneidung mit anderen erfassten Aktivitäten (per
`pg_advisory_xact_lock` serialisiert), `corrected_at` automatisch.

`on delete set null (schedule_entry_id)` erfordert **PostgreSQL ≥ 15** (lokal: 17). Wird ein
Planblock gelöscht, bleibt die erfasste Zeit erhalten und verliert nur den Bezug.

### `daily_notes` (Tagesnotiz, eine pro Benutzer und Kalendertag)

Seit Migration `20261008120000_daily_notes.sql`. Die Notiz gehört zum **Kalendertag**, nicht zu
einer Planversion: Sie ist weder Teil von Wiederholungen noch von `schedule_weeks`, bleibt beim
Anlegen eines Entwurfs und beim Veröffentlichen unverändert und wird nicht in den Offline-Cache der
App übernommen.

| Spalte     | Typ         | Regel                                                                                   |
| ---------- | ----------- | --------------------------------------------------------------------------------------- |
| id         | uuid, PK    |                                                                                         |
| owner_id   | uuid        | `auth.uid()`, `→ auth.users on delete cascade`; unveränderlich                          |
| note_date  | date        | Kalendertag in Europe/Berlin, 2000-01-01 bis 2099-12-31; unveränderlich                 |
| content    | text        | reiner Text, 1–10 000 Zeichen, nicht nur Leerraum (leerer Inhalt = Notiz wird gelöscht) |
| revision   | integer     | beginnt bei 1, bei jeder Änderung +1 (Bearbeitungsstand für Konflikterkennung)          |
| created_at | timestamptz | Serverzeit, unveränderlich                                                              |
| updated_at | timestamptz | Serverzeit, vom Trigger gesetzt                                                         |

Eindeutigkeit `(owner_id, note_date)` (dient zugleich als Index auf `owner_id`). Trigger
`private.guard_daily_note` setzt `revision`, `created_at` und `updated_at` serverseitig und
verhindert Änderungen an `id`, `owner_id` und `note_date`. Geschrieben wird über die RPC
`save_daily_note` (siehe unten); direkte Schreibrechte bestehen ebenfalls nur über RLS für den
Eigentümer. Ordner, Seiten, Notizbücher oder Anhänge gibt es bewusst **nicht** – siehe
[notes-roadmap.md](notes-roadmap.md).

### `planning_preferences` (Planungsregeln Gewerbe, 1 Zeile pro Benutzer)

`owner_id` (PK, `default auth.uid()`), `business_earliest_start`/`business_latest_end`
(Rahmen am selben Tag), `business_min_block_minutes` (15–480), `business_max_block_minutes`
(≥ Mindestdauer, ≤ 720), `business_max_daily_minutes` (Mo–Fr), `business_saturday_max_minutes`
und `business_sunday_max_minutes` (0 = kein Gewerbe oder ≥ eine Blocklänge), `buffer_minutes`
(0–120). RLS, vier Policies, Grants, `updated_at`-Trigger. Keine Standardwerte: Was nicht
gespeichert ist, gilt als „nicht festgelegt“.

### `planning_goal_slots` (Zeitfenster für Training und Laila)

Je Benutzer, Ziel (`sport` | `relationship`) und Wochentag höchstens ein Fenster
(`planning_goal_slots_owner_goal_weekday_key`): `requirement` (`required` | `optional`),
`title` (sichtbar im Plan, geht nie an Claude), `duration_minutes`, `window_start`/`window_end`
(Fenster ≥ Dauer, am selben Tag). RLS, vier Policies, Grants, Index, `updated_at`-Trigger.

### Schema `connector` (Claude-Connector, nicht über die API erreichbar)

Nur für die Rolle `tagestakt_connector` (Mitglied von `authenticated`, NOINHERIT); `anon`,
`authenticated` und `service_role` haben keine Rechte. Gespeichert werden ausschließlich
SHA-256-Hashes (64 Hex-Zeichen), nie Klartext-Codes oder -Tokens. Jede Tabelle hat RLS, vier
Policies (nur `tagestakt_connector`), Indizes und `updated_at`-Trigger; die Bindung an den
Eigentümer prüft der Server. Alles hängt per Kaskade am Benutzer.

| Tabelle                     | Inhalt                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `oauth_grants`              | eine Freigabe je Eigentümer und Client: Client-ID/-Name, Scopes, Ressource, zuletzt genutzt, Widerruf |
| `oauth_authorization_codes` | Code-Hash, Redirect-URI, PKCE-Challenge, Scopes, Ressource, Ablauf (5 min), Einlösung                 |
| `oauth_tokens`              | Token-Hash, Art (`access`/`refresh`), Ablauf, Rotation                                                |
| `publish_confirmations`     | Bestätigungs-Hash, Freigabe, Woche, Prüfstand, Ablauf (10 min), Einlösung                             |

Details: [claude-connector.md](claude-connector.md).

## Kategorien

`duty` Dienst · `business` Gewerbe · `relationship` Laila · `sport` Sport ·
`shopping` Einkaufen · `meal` Essen · `hygiene` Körperpflege & Routine · `commute` Fahrt ·
`leisure` Freizeit · `sleep` Schlaf · `appointment` Termin · `other` Sonstiges

## Trigger (Schema `private`, nicht über die API erreichbar)

- `set_updated_at` – setzt `updated_at` bei jeder Änderung.
- `guard_schedule_week` – neue Wochen nur als Entwurf; erlaubte Statuswechsel
  `draft → published → archived`; Eigentümer/Woche/Version unveränderlich; nur Entwürfe löschbar
  (Kaskade beim Löschen des Benutzers ausgenommen).
- `guard_schedule_entry` – Wochenplan muss für den Aufrufer sichtbar sein und demselben Eigentümer
  gehören; Beginn innerhalb der Woche; Inhalte nur in Entwürfen änderbar, in veröffentlichten
  Plänen nur `completion_status`; Einträge nicht in andere Wochen verschiebbar.
- `guard_daily_note` – Tagesnotiz: Revision, `created_at`/`updated_at` serverseitig; Eigentümer,
  ID und Datum unveränderlich.

## RPC-Funktionen (SECURITY INVOKER – RLS gilt)

| Funktion                                                                                                                                         | Zweck                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_schedule_draft(p_week_start date)`                                                                                                       | Liefert den Entwurf der Woche oder legt die nächste Version an (Kopie der veröffentlichten). Idempotent.                                                                                                                                                                                                                                                                                                           |
| `publish_schedule_week(p_week_id uuid)`                                                                                                          | Archiviert die bisherige Veröffentlichung und veröffentlicht den Entwurf – atomar.                                                                                                                                                                                                                                                                                                                                 |
| `add_schedule_entries(p_week_id uuid, p_entries jsonb, p_replace_existing boolean)`                                                              | Fügt mehrere Einträge atomar in einen Entwurf ein (optional nach Leeren).                                                                                                                                                                                                                                                                                                                                          |
| `start_activity_session(p_goal_category text, p_title text, p_schedule_entry_id uuid)`                                                           | Startet mit Serverzeit; optional verknüpft mit einem veröffentlichten Planblock.                                                                                                                                                                                                                                                                                                                                   |
| `stop_activity_session(p_session_id uuid)`                                                                                                       | Beendet mit Serverzeit (ohne ID: die laufende). Über 24 h nur per Korrektur.                                                                                                                                                                                                                                                                                                                                       |
| `correct_activity_session(p_session_id uuid, p_started_at timestamptz, p_ended_at timestamptz)`                                                  | „Zeit korrigieren“; ohne Ende läuft die Aktivität weiter.                                                                                                                                                                                                                                                                                                                                                          |
| `switch_activity_session(p_session_id uuid, p_goal_category text, p_title text, p_schedule_entry_id uuid)`                                       | Atomarer Wechsel: beendet die laufende Aktivität `p_session_id` und startet die neue mit demselben Serverzeitpunkt in einer Transaktion (gleiche Advisory-Sperre wie Start/Trigger). Scheitert der Start (TT005/22023), bleibt die alte Aktivität unverändert; veralteter Stand → TT002.                                                                                                                           |
| `save_daily_note(p_note_date date, p_content text, p_expected_id uuid, p_expected_revision integer)`                                             | Tagesnotiz anlegen, ändern oder (bei leerem Inhalt) löschen – atomar unter einer Advisory-Sperre je Benutzer und Tag. Geschrieben wird nur, wenn der übergebene Bearbeitungsstand (ID + Revision bzw. „noch keine Notiz“) dem gespeicherten entspricht; sonst `TT007`. Liefert die gespeicherte Zeile (bzw. keine Zeile nach dem Löschen).                                                                         |
| `schedule_week_fingerprint(p_week_id uuid)`                                                                                                      | Prüfstand einer Version: SHA-256 über Woche, Version und alle Einträge (ohne Status). Ändert sich bei jeder inhaltlichen Änderung.                                                                                                                                                                                                                                                                                 |
| `save_generated_schedule_draft(p_week_start date, p_expected_draft_id uuid, p_expected_fingerprint text, p_entries jsonb, p_planning_note text)` | Wochenplanung (Website und Claude-Connector): legt den Entwurf an (Kopie der veröffentlichten Version) bzw. ersetzt im erwarteten eigenen Entwurf alle nicht-manuellen Einträge; manuelle Einträge (Einzeltermine) bleiben. Idempotent: gleicher Vorschlag → Entwurf unverändert. Atomar unter einer Sperre je Benutzer und Woche; nur Herkunft `recurring`/`agent`, 1–300 Einträge; abweichender Stand → `TT008`. |
| `publish_reviewed_schedule_week(p_week_id uuid, p_expected_fingerprint text)`                                                                    | Veröffentlicht genau den geprüften Stand (sonst `TT008`); bereits veröffentlicht → unverändert zurück (Doppelklick).                                                                                                                                                                                                                                                                                               |
| `discard_reviewed_schedule_draft(p_week_id uuid, p_expected_fingerprint text)`                                                                   | Verwirft den eigenen Entwurf nur im geprüften Stand (sonst `TT008`); veröffentlichte Versionen → Fehler. Liefert `true`.                                                                                                                                                                                                                                                                                           |

Ausführungsrechte: nur `authenticated` (und `service_role`), nicht `anon`/`PUBLIC`.

Fachliche Fehler der Aktivitäts-Funktionen tragen eigene SQLSTATE-Codes, die Web und App in
deutsche Meldungen übersetzen (`ACTIVITY_ERROR_MESSAGES`):

| Code    | Bedeutung                                              |
| ------- | ------------------------------------------------------ |
| `TT001` | Es läuft bereits eine Aktivität                        |
| `TT002` | Es läuft keine Aktivität                               |
| `TT003` | Läuft seit über 24 h – nur per Korrektur beendbar      |
| `TT004` | Überschneidung mit einer anderen Aktivität             |
| `TT005` | Planblock ungültig (nicht veröffentlicht/anderes Ziel) |
| `TT006` | Ungültige Zeitangabe                                   |
| `TT007` | Tagesnotiz inzwischen an anderer Stelle geändert       |
| `TT008` | Entwurf seit Anzeige/Planung geändert (Wochenplanung)  |

## Fachliche Berechnungen (`packages/schedule-schema`)

| Funktion                      | Bedeutung                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `getWeekStart`                | Montag der Woche in Europe/Berlin (auch für Zeitpunkte kurz nach Mitternacht)                  |
| `isEntryWithinWeek`           | Beginn in `[Mo 00:00, nächster Mo 00:00)`, Dauer ≤ 24 h                                        |
| `detectOverlaps`              | alle sich überschneidenden Paare; aneinandergrenzende Blöcke zählen nicht                      |
| `plannedBusinessMinutes`      | Gewerbe-Blöcke außer „ausgelassen“, überlappende Zeit nur einmal                               |
| `completedBusinessMinutes`    | nur als „erledigt“ markierte Gewerbe-Blöcke                                                    |
| `getCurrentEntry`             | läuft gerade; bei Überschneidung der zuletzt begonnene                                         |
| `getNextEntry`                | nächster Beginn nach jetzt (auch über den Wochenwechsel)                                       |
| `getTrackedMinutes`           | erfasste Minuten eines Ziels in der Woche (laufende bis jetzt, an Wochengrenzen geschnitten)   |
| `getPlannedMinutes`           | geplante Minuten eines Ziels (ohne „ausgelassen“, Überlappung einmal)                          |
| `getGoalStatus`               | `unset` · `on_track` · `at_risk` · `reached` · `over` · `below` (siehe unten)                  |
| `planReminders`               | lokale Erinnerungen (vorher / Beginn / nicht gestartet), Europe/Berlin                         |
| `trackedEntryIdsFromSessions` | Planblöcke, zu denen bereits Zeit erfasst wird                                                 |
| `getFocusState`               | Fokus der Startseite: laufende Aktivität vor Planblock, Davor/Danach, nächste Zustandsänderung |
| `msUntilFocusChange`          | Wartezeit bis zur nächsten Blockgrenze (für den Wechsel ohne Neuladen)                         |
| `normalizeNoteContent`        | Tagesnotiz normalisieren: CRLF → LF, NFC, Steuerzeichen raus, Ränder trimmen                   |
| `noteEditorReducer`           | Editorzustand (geändert/speichert/gespeichert/Fehler/Konflikt) für Web und App                 |

### Zielstatus

Ohne Ziel (`NULL`/0): `unset` – nur erfasste Zeit, keine Bewertung. Sonst:

1. `over`, wenn erfasst ≥ Ziel + max(60 min, 10 % des Ziels),
2. `reached`, wenn erfasst ≥ Ziel,
3. `below`, wenn die Woche vorbei ist,
4. `on_track`, wenn erfasst + noch eingeplant ≥ Ziel,
5. sonst `at_risk`.

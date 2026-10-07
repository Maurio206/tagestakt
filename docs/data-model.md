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

## RPC-Funktionen (SECURITY INVOKER – RLS gilt)

| Funktion                                                                            | Zweck                                                                                                    |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `create_schedule_draft(p_week_start date)`                                          | Liefert den Entwurf der Woche oder legt die nächste Version an (Kopie der veröffentlichten). Idempotent. |
| `publish_schedule_week(p_week_id uuid)`                                             | Archiviert die bisherige Veröffentlichung und veröffentlicht den Entwurf – atomar.                       |
| `add_schedule_entries(p_week_id uuid, p_entries jsonb, p_replace_existing boolean)` | Fügt mehrere Einträge atomar in einen Entwurf ein (optional nach Leeren).                                |

| `start_activity_session(p_goal_category text, p_title text, p_schedule_entry_id uuid)` | Startet mit Serverzeit; optional verknüpft mit einem veröffentlichten Planblock. |
| `stop_activity_session(p_session_id uuid)` | Beendet mit Serverzeit (ohne ID: die laufende). Über 24 h nur per Korrektur. |
| `correct_activity_session(p_session_id uuid, p_started_at timestamptz, p_ended_at timestamptz)` | „Zeit korrigieren“; ohne Ende läuft die Aktivität weiter. |

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

## Fachliche Berechnungen (`packages/schedule-schema`)

| Funktion                      | Bedeutung                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `getWeekStart`                | Montag der Woche in Europe/Berlin (auch für Zeitpunkte kurz nach Mitternacht)                |
| `isEntryWithinWeek`           | Beginn in `[Mo 00:00, nächster Mo 00:00)`, Dauer ≤ 24 h                                      |
| `detectOverlaps`              | alle sich überschneidenden Paare; aneinandergrenzende Blöcke zählen nicht                    |
| `plannedBusinessMinutes`      | Gewerbe-Blöcke außer „ausgelassen“, überlappende Zeit nur einmal                             |
| `completedBusinessMinutes`    | nur als „erledigt“ markierte Gewerbe-Blöcke                                                  |
| `getCurrentEntry`             | läuft gerade; bei Überschneidung der zuletzt begonnene                                       |
| `getNextEntry`                | nächster Beginn nach jetzt (auch über den Wochenwechsel)                                     |
| `getTrackedMinutes`           | erfasste Minuten eines Ziels in der Woche (laufende bis jetzt, an Wochengrenzen geschnitten) |
| `getPlannedMinutes`           | geplante Minuten eines Ziels (ohne „ausgelassen“, Überlappung einmal)                        |
| `getGoalStatus`               | `unset` · `on_track` · `at_risk` · `reached` · `over` · `below` (siehe unten)                |
| `planReminders`               | lokale Erinnerungen (vorher / Beginn / nicht gestartet), Europe/Berlin                       |
| `trackedEntryIdsFromSessions` | Planblöcke, zu denen bereits Zeit erfasst wird                                               |

### Zielstatus

Ohne Ziel (`NULL`/0): `unset` – nur erfasste Zeit, keine Bewertung. Sonst:

1. `over`, wenn erfasst ≥ Ziel + max(60 min, 10 % des Ziels),
2. `reached`, wenn erfasst ≥ Ziel,
3. `below`, wenn die Woche vorbei ist,
4. `on_track`, wenn erfasst + noch eingeplant ≥ Ziel,
5. sonst `at_risk`.

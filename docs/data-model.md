# Datenmodell

Quelle der Wahrheit: `supabase/migrations/*.sql`. Generierte Typen:
`packages/schedule-schema/src/database.types.ts` (`pnpm db:types`). Zod-Schemas:
`packages/schedule-schema/src/schemas.ts`.

Alle fachlichen Tabellen liegen im Schema `public`, besitzen `owner_id → auth.users(id)
on delete cascade` (Standard `auth.uid()`), aktivierte RLS, getrennte Policies für
SELECT/INSERT/UPDATE/DELETE und einen `updated_at`-Trigger.

## Tabellen

### `user_settings` (1 Zeile pro Benutzer)

| Spalte                         | Typ         | Standard / Regel                               |
| ------------------------------ | ----------- | ---------------------------------------------- |
| owner_id                       | uuid, PK    | `auth.uid()`                                   |
| timezone                       | text        | `Europe/Berlin` (MVP: nur dieser Wert erlaubt) |
| locale                         | text        | `de-DE`, Format `xx-XX`                        |
| weekly_business_target_minutes | integer     | `1200` (= 20 h), 0 … 10080                     |
| created_at / updated_at        | timestamptz | automatisch                                    |

Fehlt die Zeile, verwenden Web und App die Standardwerte; gespeichert wird per Upsert.

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

**Überschneidungen** sind in der Datenbank erlaubt; sie werden in der gemeinsamen Logik erkannt
(`detectOverlaps`) und im Web-UI gewarnt.

## Kategorien

`duty` Dienst · `business` Gewerbe · `relationship` Zweisamkeit · `sport` Sport ·
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

Ausführungsrechte: nur `authenticated` (und `service_role`), nicht `anon`/`PUBLIC`.

## Fachliche Berechnungen (`packages/schedule-schema`)

| Funktion                   | Bedeutung                                                                     |
| -------------------------- | ----------------------------------------------------------------------------- |
| `getWeekStart`             | Montag der Woche in Europe/Berlin (auch für Zeitpunkte kurz nach Mitternacht) |
| `isEntryWithinWeek`        | Beginn in `[Mo 00:00, nächster Mo 00:00)`, Dauer ≤ 24 h                       |
| `detectOverlaps`           | alle sich überschneidenden Paare; aneinandergrenzende Blöcke zählen nicht     |
| `plannedBusinessMinutes`   | Gewerbe-Blöcke außer „ausgelassen“, überlappende Zeit nur einmal              |
| `completedBusinessMinutes` | nur als „erledigt“ markierte Gewerbe-Blöcke                                   |
| `getCurrentEntry`          | läuft gerade; bei Überschneidung der zuletzt begonnene                        |
| `getNextEntry`             | nächster Beginn nach jetzt (auch über den Wochenwechsel)                      |

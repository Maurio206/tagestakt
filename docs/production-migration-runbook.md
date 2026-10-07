# Runbook: Produktionsmigration „Fokus-Erfassung und Ziele“

Betrifft `supabase/migrations/20261007120000_focus_tracking_and_goals.sql`.

> **Nur gemeinsam mit dem Benutzer ausführen.** Dieses Dokument beschreibt den Ablauf; es wurde
> **nicht** gegen die produktive Datenbank ausgeführt. Zugangsdaten (Datenbank-URL, Passwort)
> werden nie ins Repository, in Tickets oder in einen Chat kopiert, sondern nur in der eigenen
> Terminal-Sitzung aus dem Passwortmanager gesetzt.

## Was die Migration tut

Rein **additiv** – bestehende Zeilen werden weder gelöscht noch umgeschrieben:

- `user_settings`: sechs neue Spalten (Ziele Sport/Laila, Erinnerungs-Vorgaben) mit `NULL` bzw.
  Standardwerten und Prüfregeln. Das Gewerbeziel (`weekly_business_target_minutes`) bleibt.
- `schedule_entries`: zusätzlicher Unique-Constraint `(id, owner_id)` (`id` ist bereits
  Primärschlüssel – kann nicht scheitern).
- neue Tabelle `activity_sessions` mit RLS, vier Policies, Grants, Indizes, Trigger
  `private.guard_activity_session`.
- neue RPCs `start_activity_session`, `stop_activity_session`, `correct_activity_session`
  (SECURITY INVOKER, nur `authenticated`).

Die **bisherige Website** funktioniert mit der migrierten Datenbank unverändert. Die **neue
Website** benötigt die Migration. Reihenfolge daher: Migration → Prüfung → Website-Deployment →
App-Build.

Voraussetzung: **PostgreSQL ≥ 15** (`on delete set null (schedule_entry_id)`). Die Vorprüfung
bricht bei älteren Versionen ab.

## 0. Vorbereitung (lokal, ohne Produktionszugriff)

```bash
git switch feat/design-and-focus-tracking
pnpm install --frozen-lockfile
pnpm db:reset
pnpm db:test
pnpm db:upgrade-test
```

`db:upgrade-test` spielt einen Stand wie in Produktion (nur Initialmigration) mit Beispieldaten
ein, wendet die Migration an, vergleicht den Fingerabdruck der Altdaten, führt die
Vor-/Nachprüfungen dieses Runbooks aus und testet das Rückfall-Skript. Alle Schritte müssen grün
sein.

## 1. Zugang zur Produktionsdatenbank

Supabase läuft als eigene Coolify-Ressource. Zwei Wege – je nachdem, was eingerichtet ist:

- **A – Terminal im Datenbank-Container** (Coolify → Supabase-Ressource → Container `supabase-db`
  → Terminal): dort steht `psql` zur Verfügung (`psql -U postgres -d postgres`). Die SQL-Dateien
  werden per Kopieren/Einfügen oder per `docker cp` auf den Server gebracht.
- **B – lokales `psql` über eine gesicherte Verbindung** (z. B. SSH-Tunnel). Die Verbindungs-URL
  nur als Umgebungsvariable der laufenden Sitzung setzen, nie in eine Datei im Repository.

Für alle folgenden Befehle gilt: `psql … -v ON_ERROR_STOP=1`, damit jeder Fehler sofort abbricht.

## 2. Sicherung

1. Vollständige Sicherung **vor** jeder Änderung, z. B. `pg_dump -Fc` der Datenbank `postgres`
   bzw. das Backup-Werkzeug von Coolify für die Supabase-Ressource.
2. Prüfen, dass die Sicherung lesbar ist (`pg_restore -l <datei> | head`).
3. Die Datei **außerhalb** des Repositorys verschlüsselt aufbewahren (enthält alle Termine).

## 3. Vorprüfung (nur lesend)

```bash
psql -v ON_ERROR_STOP=1 -f scripts/db/production-precheck.sql
psql -v ON_ERROR_STOP=1 -At -f scripts/db/data-fingerprint.sql > fingerprint-vorher.txt
```

Erwartung der Vorprüfung:

| Ausgabe                       | erwartet                                             |
| ----------------------------- | ---------------------------------------------------- |
| `postgres_version`            | 15 oder neuer (sonst Abbruch)                        |
| `activity_sessions_vorhanden` | `false` (sonst ist die Migration schon angewendet)   |
| `neue_user_settings_spalten`  | `0`                                                  |
| `migrationsverlauf_vorhanden` | `true` oder `false` – entscheidet den Weg in 4.      |
| `eingetragene_versionen`      | z. B. `20261006120000` oder „kein Migrationsverlauf“ |

Der Fingerabdruck enthält je Tabelle nur Zeilenzahl und MD5-Prüfsumme – **keine Inhalte**. Die
Datei `fingerprint-vorher.txt` trotzdem außerhalb des Repositorys ablegen.

## 4. Migration anwenden

**Fall 1 – Migrationsverlauf vorhanden** (`supabase_migrations.schema_migrations` enthält
`20261006120000`): mit der Supabase-CLI und der Datenbank-URL aus dem Passwortmanager:

```bash
pnpm exec supabase db push --db-url "$TT_PROD_DB_URL" --dry-run
pnpm exec supabase db push --db-url "$TT_PROD_DB_URL"
```

`--dry-run` muss **genau** `20261007120000_focus_tracking_and_goals.sql` auflisten. Niemals
`--include-seed` verwenden.

**Fall 2 – kein Migrationsverlauf** (Initialmigration wurde z. B. im SQL-Editor eingespielt):
die Datei in **einer** Transaktion anwenden:

```bash
psql -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20261007120000_focus_tracking_and_goals.sql
```

Bei einem Fehler wird die gesamte Transaktion zurückgerollt; die Datenbank bleibt im
Ausgangszustand. Dann **nicht** improvisieren, sondern Fehlermeldung sichern und gemeinsam
analysieren.

## 5. Nachprüfung (nur lesend)

```bash
psql -v ON_ERROR_STOP=1 -At -f scripts/db/data-fingerprint.sql > fingerprint-nachher.txt
diff fingerprint-vorher.txt fingerprint-nachher.txt
psql -v ON_ERROR_STOP=1 -f scripts/db/production-postcheck.sql
```

- `diff` darf **keine** Ausgabe liefern (Altdaten unverändert).
- Die Nachprüfung meldet „Nachprüfung erfolgreich“ (RLS aktiv, vier Policies, `anon` ohne Rechte,
  Funktionen als SECURITY INVOKER und nicht für `anon` ausführbar, neue Spalten vorhanden,
  keine Views im Schema `public`).
- Falls Supabase Studio „Advisors“ anbietet: Security Advisor ohne neue Warnungen.

## 6. Website deployen und prüfen

1. In Coolify die Website aus diesem Stand deployen (siehe
   [deployment-coolify.md](deployment-coolify.md)) – **erst nach** Schritt 5.
2. Prüfungen aus deployment-coolify.md, Abschnitt 5 (Health, Login, Header, keine Secrets).
3. Fachlich (als Benutzer): Übersicht zeigt Ziele; „Fokus starten“ → Timer läuft →
   „Beenden“; in der Auswertung erscheint die Zeit; „Zeit korrigieren“ funktioniert. Eine
   Test-Aktivität kann anschließend in der App über „Zeit korrigieren → Aktivität verwerfen“
   wieder entfernt werden.
4. Unter Einstellungen die gewünschten Ziele für Sport und Laila setzen (Standard: kein Ziel).

## 7. Rückfall

**Normalfall:** Da die Migration additiv ist, genügt bei Problemen der Website ein erneutes
Deployment der **vorherigen Website-Version** – die Datenbank bleibt, wie sie ist.

**Nur wenn die Datenbankänderung selbst zurückgenommen werden muss:**

```bash
psql -v ON_ERROR_STOP=1 -f scripts/db/rollback-20261007120000.sql
```

- Entfernt ausschließlich die Objekte dieser Migration und den Eintrag im Migrationsverlauf.
  Wochenpläne, Einträge, Wiederholungen und das Gewerbeziel bleiben (per Fingerabdruck prüfen).
- **Erfasste Aktivitäten, Sport-/Laila-Ziele und Erinnerungs-Vorgaben gehen verloren.** Sind
  bereits Aktivitäten erfasst, bricht das Skript ab. Erst nach Sicherung und ausdrücklicher
  Entscheidung des Benutzers in derselben Sitzung vorher ausführen:
  `set tagestakt.rollback_discard_sessions = 'ja';`
- Danach Fingerabdruck erneut erstellen und mit `fingerprint-vorher.txt` vergleichen.
- Letzte Möglichkeit: Wiederherstellung aus der Sicherung aus Schritt 2.

Das Rückfall-Skript wird in `pnpm db:upgrade-test` lokal mitgetestet.

## 8. Danach

- App: privaten Build nach [mobile-preview-build.md](mobile-preview-build.md) erstellen und auf
  dem eigenen Gerät testen.
- Sicherungs- und Fingerabdruck-Dateien gemäß eigener Aufbewahrungsregel löschen bzw. sicher
  verwahren.

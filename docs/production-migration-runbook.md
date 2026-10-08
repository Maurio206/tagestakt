# Runbook: Produktionsmigration „Fokus-Erfassung, Ziele und Tagesnotizen“

Betrifft **zwei** Migrationen, die in dieser Reihenfolge angewendet werden:

1. `supabase/migrations/20261007120000_focus_tracking_and_goals.sql`
2. `supabase/migrations/20261008120000_daily_notes.sql`

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
- neue RPCs `start_activity_session`, `stop_activity_session`, `correct_activity_session` und
  `switch_activity_session` (atomarer Wechsel) – SECURITY INVOKER, leerer `search_path`, nur
  `authenticated` (und `service_role`), nicht `anon`.
- **Zweite Migration** (`20261008120000`): neue Tabelle `daily_notes` (eine Tagesnotiz je Tag,
  reiner Text ≤ 10 000 Zeichen) mit RLS, vier Policies, Grants, Eindeutigkeit
  `(owner_id, note_date)`, Trigger `private.guard_daily_note` und RPC `save_daily_note`
  (SECURITY INVOKER, leerer `search_path`, nicht für `anon`). Berührt keine bestehende Tabelle.

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
ein, prüft die Vorprüfung in allen drei Fällen des Migrationsverlaufs (siehe Abschnitt 4) und die
Rechteprüfung (auch mit einer Rolle ohne Rechte), wendet beide Migrationen **einzeln** wie in
Weg A an, vergleicht nach jeder den Fingerabdruck der Altdaten, führt die Nachprüfungen dieses
Runbooks aus (inklusive Tagesnotiz anlegen, ändern, Konflikt, löschen) und testet beide
Rückfall-Skripte in der richtigen Reihenfolge. Alle Schritte müssen grün sein. Zusätzlich prüft
`pnpm db:concurrency-test` gleichzeitige Wechsel, Starts und Notiz-Speicherungen mit zwei echten
Datenbanksitzungen.

## 1. Zugang zur Produktionsdatenbank

Supabase läuft als eigene Coolify-Ressource. Zwei Wege – je nachdem, was eingerichtet ist.
**Festgelegt (08.10.2026): nur Weg A.** Der Datenbankzugang bleibt im Coolify-Terminal des
Benutzers; Claude gibt jeweils genau einen Befehl vor und wartet auf dessen Ausgabe.

- **A – Terminal im Datenbank-Container** (Coolify → Supabase-Ressource → Container `supabase-db`
  → Terminal): dort steht `psql` zur Verfügung. Die SQL-Dateien werden per Kopieren/Einfügen oder
  per `docker cp` auf den Server gebracht. Verbindung: `psql -U postgres -d postgres …`.
- **B – lokales `psql` über eine gesicherte Verbindung** (z. B. SSH-Tunnel). Die Verbindungs-URL
  nur als Umgebungsvariable der laufenden Terminal-Sitzung setzen (hier `TT_PROD_DB_URL`), nie in
  eine Datei im Repository. Verbindung: `psql "$TT_PROD_DB_URL" …`.

Für die Supabase-CLI (`--db-url`) muss die URL prozentkodiert sein (Sonderzeichen im Passwort).
Die Befehle unten sind für Weg B geschrieben; bei Weg A `"$TT_PROD_DB_URL"` durch
`-U postgres -d postgres` ersetzen. Immer mit `-v ON_ERROR_STOP=1`, damit jeder Fehler sofort
abbricht.

**Dateien in den Container bringen (Weg A):** benötigt werden die beiden Migrationen,
`production-precheck.sql`, `data-fingerprint.sql`, `production-postcheck-20261007120000.sql`,
`production-postcheck.sql` und die beiden Rückfall-Skripte, z. B. nach
`/tmp/tagestakt-migration/`. Am robustesten als ein Paket (`tar.gz`, base64-kodiert) per
Einfügen ins Terminal. Danach **immer** `sha256sum` im Container mit den lokal berechneten
Prüfsummen derselben Git-Stände vergleichen – bei jeder Abweichung nicht fortfahren. Die
Dateien enthalten nur SQL, keine Daten oder Zugangsdaten; nach Abschluss `/tmp/tagestakt-migration`
löschen.

## 2. Sicherung

1. Vollständige Sicherung **vor** jeder Änderung, z. B. `pg_dump -Fc` der Datenbank `postgres`
   bzw. das Backup-Werkzeug von Coolify für die Supabase-Ressource – lokal **und** auf S3,
   jeweils mit Zeitpunkt und Größe nachgewiesen.
2. Prüfen, dass die Sicherung lesbar ist (`pg_restore -l <datei> | head`).
3. Die Datei **außerhalb** des Repositorys verschlüsselt aufbewahren (enthält alle Termine).

## 3. Vorprüfung (nur lesend)

```bash
psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 -At -f scripts/db/production-precheck.sql
psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 -At -f scripts/db/data-fingerprint.sql > fingerprint-vorher.txt
```

Erwartung der Vorprüfung:

| Ausgabe                            | erwartet                                                     |
| ---------------------------------- | ------------------------------------------------------------ |
| `postgres_version`                 | 15 oder neuer (sonst Abbruch)                                |
| `activity_sessions_vorhanden`      | `false` (sonst ist die Migration schon angewendet)           |
| `daily_notes_vorhanden`            | `false` (sonst ist die zweite Migration schon angewendet)    |
| `neue_user_settings_spalten`       | `0`                                                          |
| `migrationsverlauf_vorhanden`      | `true` oder `false`                                          |
| `migrationsverlauf_fall`           | `1-…`, `2-…` oder `3-…` – entscheidet den Weg in Abschnitt 4 |
| `eingetragene_versionen` (Hinweis) | z. B. `20261006120000` oder „kein Migrationsverlauf“         |
| `migrationsverlauf_spalten`        | enthält `version` und `name` (Fall 2/3)                      |
| `ausfuehrende_rolle`               | `postgres`                                                   |
| `eigentuemer_bestehender_tabellen` | Hinweis, z. B. `postgres`                                    |
| `fehlende_rechte`                  | leer                                                         |
| `rechte_fuer_migration`            | `true` (sonst nicht migrieren, sondern gemeinsam klären)     |

Der Fingerabdruck enthält je Tabelle nur Zeilenzahl und MD5-Prüfsumme – **keine Inhalte**. Die
Datei `fingerprint-vorher.txt` trotzdem außerhalb des Repositorys ablegen.

## 4. Migration anwenden

**Tatsächlicher Weg in Produktion (09.10.2026): Studio-SQL-Editor als `supabase_admin`.** Die
Vorprüfung im Coolify-Terminal ergab PostgreSQL 15.8, Fall `1-tabelle-fehlt` und
`eigentuemer_bestehender_tabellen=supabase_admin`. Der Rolle `postgres` fehlten
`create_private`, `eigentuemer_schedule_entries`, `eigentuemer_user_settings` und
`execute_set_updated_at`, und sie darf nicht zu `supabase_admin` wechseln. Die Initialmigration
war also über den SQL-Editor von Studio eingespielt worden. Eigentümer, Rollen und Rechte werden
**nicht** geändert; stattdessen laufen die Migrationen dort, wo die Initialmigration lief:

1. In Studio prüfen: `select current_user, session_user;` muss `supabase_admin` liefern (die
   Rollenauswahl unten im Editor bleibt auf dem Standard).
2. „Backup Now“ in Coolify, Erfolg lokal und auf S3, Inhaltsverzeichnis per `pg_restore -l`.
3. Fingerabdruck vorher (`data-fingerprint.sql` mit vorangestelltem `set transaction read only;`).
4. Jede Datei als **eigene** Query, vollständig und ohne Markierung ausführen. Ein Run ist eine
   Transaktion (mehrere Anweisungen in einem Aufruf): Scheitert eine Anweisung, wird der ganze
   Run zurückgerollt. Reihenfolge: Migration 1 → Zwischenprüfung → Migration 2 → Nachprüfung.
5. Die Prüfungen laufen in Studio-Form: `set transaction read only;` als erste Anweisung, ohne
   eigenes `begin`/`commit`, mit eingebautem Vergleich gegen die Fingerabdruck-Werte von vorher;
   die letzte Anweisung liefert die Erfolgszeile. Jede Abweichung bricht mit Meldung ab.

**Ergebnis 09.10.2026:** frisches Backup (Success, 245 KB, S3 hochgeladen, alle fünf
Fachtabellen im Inhaltsverzeichnis), beide Migrationen „Success“, Zwischen- und Nachprüfung
erfolgreich, Fingerabdruck der Altdaten unverändert.

Lokal abgedeckt durch `pnpm db:upgrade-test`, Szenario „produktion“: Die Initialmigration wird
als `supabase_admin` eingespielt, die Vorprüfung muss genau den obigen Befund liefern, dann wird
als `supabase_admin` einzeln migriert, geprüft und zurückgefallen.

Die Vorprüfung meldet in `migrationsverlauf_fall` genau einen von drei Fällen. **Nur den
passenden Weg** gehen; niemals `--include-seed` oder `--include-all` verwenden.

**Weg A (Coolify-Terminal, festgelegt): Migrationen einzeln.** Je Migration genau ein Befehl;
Datei und Eintrag im Migrationsverlauf laufen in **einer** Transaktion – scheitert etwas, bleibt
die Datenbank unverändert. Nach jeder Migration Fingerabdruck und Prüfung (Abschnitt 5), erst
dann die nächste. In Fall 2 und 3 mit `-c` (Eintrag im Verlauf), in Fall 1 ohne:

```bash
cd /tmp/tagestakt-migration
psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -f 20261007120000_focus_tracking_and_goals.sql -c "insert into supabase_migrations.schema_migrations (version, name) values ('20261007120000', 'focus_tracking_and_goals')"
# Prüfen (Abschnitt 5, Zwischenprüfung), dann:
psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -f 20261008120000_daily_notes.sql -c "insert into supabase_migrations.schema_migrations (version, name) values ('20261008120000', 'daily_notes')"
```

Genau dieser Ablauf (inklusive Eintrag im Verlauf, nach dem die Supabase-CLI nichts mehr
anzuwenden hat) wird in `pnpm db:upgrade-test` lokal geprüft.

**Weg B (nicht gewählt)** – die bisherigen Befehle für ein lokales `psql` bzw. die Supabase-CLI:

**Fall 3 – `3-initialmigration-eingetragen`** (Initialmigration wurde mit der Supabase-CLI
eingespielt):

```bash
pnpm exec supabase db push --db-url "$TT_PROD_DB_URL" --dry-run
pnpm exec supabase db push --db-url "$TT_PROD_DB_URL"
```

`--dry-run` muss **genau** `20261007120000_focus_tracking_and_goals.sql` und
`20261008120000_daily_notes.sql` (in dieser Reihenfolge) auflisten – sonst abbrechen.

**Fall 2 – `2-initialmigration-nicht-eingetragen`** (Verlaufstabelle existiert, die
Initialmigration wurde aber z. B. im SQL-Editor ausgeführt): `supabase db push` würde die
Initialmigration **erneut ausführen** wollen. Daher **kein** `db push`, sondern beide neuen
Migrationen direkt in **einer** gemeinsamen Transaktion anwenden (psql führt die Dateien
nacheinander aus; scheitert eine, wird beides zurückgerollt):

```bash
psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20261007120000_focus_tracking_and_goals.sql -f supabase/migrations/20261008120000_daily_notes.sql
```

Optional – nur nach gemeinsamer Entscheidung und **nach** erfolgreicher Nachprüfung
(Abschnitt 5) – den Verlauf angleichen, damit spätere `db push` funktionieren.
`migration repair` schreibt nur in die Verlaufstabelle und führt **kein** SQL der Migrationen
aus:

```bash
pnpm exec supabase migration repair 20261006120000 20261007120000 20261008120000 --status applied --db-url "$TT_PROD_DB_URL"
```

**Fall 1 – `1-tabelle-fehlt`** (kein Migrationsverlauf): wie Fall 2 – beide Migrationen mit
`psql` in einer Transaktion anwenden, **kein** `db push`. Das spätere Angleichen per `migration repair`
ist auch hier optional.

In allen Fällen gilt: Bei einem Fehler wird die gesamte Transaktion zurückgerollt; die Datenbank
bleibt im Ausgangszustand. Dann **nicht** improvisieren, sondern Fehlermeldung sichern und
gemeinsam analysieren.

## 5. Nachprüfung (nur lesend)

Bei Weg A nach der **ersten** Migration (Zwischenstand, Tagesnotizen noch nicht vorhanden):

```bash
psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f data-fingerprint.sql > fingerprint-nach-1.txt
diff fingerprint-vorher.txt fingerprint-nach-1.txt
psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -f production-postcheck-20261007120000.sql
```

Erwartung: `diff` ohne Ausgabe, „Zwischenprüfung nach 20261007120000 erfolgreich“. Nach der
**zweiten** Migration wie folgt (Weg B gezeigt; bei Weg A `"$TT_PROD_DB_URL"` durch
`-U postgres -d postgres` und `scripts/db/` durch die Dateien in `/tmp/tagestakt-migration` ersetzen):

```bash
psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 -At -f scripts/db/data-fingerprint.sql > fingerprint-nachher.txt
diff fingerprint-vorher.txt fingerprint-nachher.txt
psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 -At -f scripts/db/production-postcheck.sql
```

- `diff` darf **keine** Ausgabe liefern (Altdaten unverändert).
- Die Nachprüfung meldet „Nachprüfung erfolgreich“ (RLS aktiv auf `activity_sessions` und
  `daily_notes`, je vier Policies, `anon` ohne Rechte, kein `truncate`, alle fünf Funktionen
  inklusive `save_daily_note` als SECURITY INVOKER mit leerem `search_path` und nicht für `anon`
  ausführbar, neue Spalten, Eindeutigkeit und Trigger der Tagesnotizen vorhanden, keine Views im
  Schema `public`).
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
5. Tagesnotiz: auf der Übersicht „Tagesnotiz · heute“ aufklappen, einen neutralen Testtext
   speichern („Gespeichert um …“), im Wochenplan unter „Tagesnotiz“ wiederfinden, dann leeren
   und speichern („Notiz entfernt.“). Keine echten Inhalte für den Test verwenden.

## 7. Rückfall

**Normalfall:** Da die Migration additiv ist, genügt bei Problemen der Website ein erneutes
Deployment der **vorherigen Website-Version** – die Datenbank bleibt, wie sie ist.

**Nur wenn die Datenbankänderung selbst zurückgenommen werden muss** – immer in **umgekehrter**
Reihenfolge, zuerst die Tagesnotizen:

```bash
psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/db/rollback-20261008120000.sql
psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/db/rollback-20261007120000.sql
```

- Soll nur die Tagesnotiz-Migration zurückgenommen werden, genügt der erste Befehl.
- **Gespeicherte Tagesnotizen gehen verloren.** Sind bereits Notizen vorhanden, bricht
  `rollback-20261008120000.sql` ab, ohne etwas zu ändern. Nur nach Sicherung und ausdrücklicher
  Entscheidung des Benutzers – Bestätigung in derselben Sitzung:
  `psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 -c "set tagestakt.rollback_discard_notes = 'ja'" -f scripts/db/rollback-20261008120000.sql`
- `rollback-20261007120000.sql` entfernt ausschließlich die Objekte der ersten Migration und
  deren Eintrag im Migrationsverlauf.
  Wochenpläne, Einträge, Wiederholungen und das Gewerbeziel bleiben (per Fingerabdruck prüfen).
- **Erfasste Aktivitäten, Sport-/Laila-Ziele und Erinnerungs-Vorgaben gehen verloren.** Sind
  bereits Aktivitäten erfasst, bricht das Skript ab, ohne etwas zu ändern. Nur nach Sicherung und
  ausdrücklicher Entscheidung des Benutzers – mit Bestätigung in **derselben** Sitzung (psql führt
  `-c` und `-f` nacheinander in einer Sitzung aus):
  `psql "$TT_PROD_DB_URL" -v ON_ERROR_STOP=1 -c "set tagestakt.rollback_discard_sessions = 'ja'" -f scripts/db/rollback-20261007120000.sql`
- Ist der Migrationsverlauf vorhanden, entfernen die Skripte dort auch die Einträge
  `20261008120000` bzw. `20261007120000`.
- Danach Fingerabdruck erneut erstellen und mit `fingerprint-vorher.txt` vergleichen.
- Letzte Möglichkeit: Wiederherstellung aus der Sicherung aus Schritt 2.

Beide Rückfall-Skripte (inklusive des Abbruchs bei vorhandenen Notizen) werden in
`pnpm db:upgrade-test` lokal mitgetestet.

## 8. Danach

- App: privaten Build nach [mobile-preview-build.md](mobile-preview-build.md) erstellen und auf
  dem eigenen Gerät testen.
- Sicherungs- und Fingerabdruck-Dateien gemäß eigener Aufbewahrungsregel löschen bzw. sicher
  verwahren.

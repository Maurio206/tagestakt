# Runbook: Produktionsmigration „Wochenplaner“ (20261009120000)

Betrifft genau eine Migration: `supabase/migrations/20261009120000_planning_rules.sql`.

> **Nur gemeinsam mit dem Benutzer ausführen** – nach frischem Backup, Vorprüfung und
> ausdrücklicher Freigabe. Zugangsdaten werden nie in Chat, Tickets oder das Repository kopiert.
> Die SQL-Dateien enthalten nur Struktur und Prüfungen, keine Daten.

## Was die Migration tut

Rein **additiv** – keine bestehende Tabelle, Spalte oder Zeile wird geändert:

- neue Tabellen `planning_preferences` (Gewerbe-Regeln) und `planning_goal_slots` (Zeitfenster
  für Training und Laila), jeweils mit `owner_id default auth.uid()`, RLS, vier Policies,
  Grants (`anon` nichts), Index und `updated_at`-Trigger,
- neue RPCs `schedule_week_fingerprint`, `save_generated_schedule_draft` und
  `publish_reviewed_schedule_week` (SECURITY INVOKER, leerer `search_path`, nicht für `anon`);
  sie nutzen die vorhandenen `create_schedule_draft`, `add_schedule_entries` und
  `publish_schedule_week`.

Die **bisherige Website** läuft mit der migrierten Datenbank unverändert. Die **neue Website**
braucht die Migration für `/planen` und die Planungsregeln. Reihenfolge daher: Backup →
Vorprüfung → Migration → Nachprüfung → Website-Deployment. Die Android-App braucht **keinen**
neuen Build.

## 0. Lokal (ohne Produktionszugriff)

```bash
pnpm db:reset
pnpm db:test
pnpm db:upgrade-test
pnpm db:concurrency-test
```

`db:upgrade-test` prüft im Szenario „produktion“ genau die Lage in Produktion (Objekte gehören
`supabase_admin`, kein Migrationsverlauf): Vorprüfung als `supabase_admin` „bereit“ und als
`postgres` mit fehlenden Rechten, Migration, Fingerabdruck der Altdaten unverändert, Nachprüfung,
Planer-Abläufe auf Altdaten und Rückfall (Abbruch bei vorhandenen Planungsregeln).

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

## 3. Website deployen und prüfen

1. `ANTHROPIC_API_KEY` trägt der Benutzer selbst als Secret in Coolify ein (siehe
   [deployment-coolify.md](deployment-coolify.md)), danach Deployment aus dem geprüften Stand.
2. `/api/health` → 200; `/planen` ohne Anmeldung → `/login`; angemeldet: Voraussetzungen bzw.
   „Woche mit Claude planen“, keine Meldung „nicht eingerichtet“.
3. Erste Planung nur gemeinsam: fehlende Angaben über die Oberfläche ergänzen, genau einen
   Entwurf erzeugen, Prüfübersicht ansehen, veröffentlichen erst nach ausdrücklicher Freigabe.

## 4. Rückfall

**Normalfall:** vorherige Website-Version erneut deployen – die additive Migration stört sie nicht.

**Nur wenn die Datenbankänderung selbst zurück muss:** Inhalt von
`scripts/db/rollback-20261009120000.sql` **ohne** die Zeilen `begin;` und `commit;` als eine
Query ausführen. Sind bereits Planungsregeln gespeichert, bricht das Skript ohne Änderung ab.
Nur nach Backup und ausdrücklicher Entscheidung des Benutzers in derselben Query als erste Zeile
`set local tagestakt.rollback_discard_planning_rules = 'ja';` voranstellen. Vom Planer erzeugte
Entwürfe und veröffentlichte Pläne bleiben erhalten (normale Wochenpläne). Danach Fingerabdruck
wie in Schritt 3 vergleichen.

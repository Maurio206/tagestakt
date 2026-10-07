# Notizen – Roadmap (Konzept)

**Status:** Konzept. Umgesetzt ist ausschließlich die **Tagesnotiz** (eine Notiz je Kalendertag,
siehe [data-model.md](data-model.md#daily_notes-tagesnotiz-eine-pro-benutzer-und-kalendertag)).
Für Notizbücher, Abschnitte, Unterordner, Seiten oder Anhänge gibt es **keine** Tabellen, keine
Migrationen und keinen Code. Dieses Dokument beschreibt, wie ein späterer Ausbau aussehen soll,
ohne ihn vorwegzunehmen.

## 1. Ausgangslage: Tagesnotiz (umgesetzt)

- Tabelle `daily_notes`: eine Notiz je Benutzer und Kalendertag (Europe/Berlin), reiner Text,
  höchstens 10 000 Zeichen, leerer Inhalt löscht die Notiz.
- Schreiben nur über `save_daily_note` mit Bearbeitungsstand (`revision`) – keine stillen
  Überschreibungen zwischen Web und App.
- Web: Übersicht (kompakt) und Wochenplan (Tagesauswahl + ein Editor). App: Tag (Vorschau) und
  eigener Editor; nur online, nie im Offline-Cache, nie in Erinnerungen.

## 2. Grundsatz: strikte Trennung von Wochenplan und Notizen

| Regel                                   | Bedeutung                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Eigene Tabellen, eigene RLS             | Notizen liegen nie in `schedule_weeks`/`schedule_entries` (auch nicht in `note`/`planning_note`).                  |
| Kein Kaskadieren zwischen den Bereichen | Löschen, Archivieren oder Veröffentlichen eines Plans ändert keine Notiz – und umgekehrt.                          |
| Keine Planversionen in Notizen          | Notizen sind nicht versioniert wie Pläne und nie Teil von Wiederholungen oder Agent-Entwürfen.                     |
| Verknüpfungen sind lose                 | Eine Notiz kann später auf ein Datum, eine Woche oder einen Block _verweisen_, aber nie davon abhängen.            |
| Getrennte Wege in der App               | Notizen nie im Plan-Cache, nie in Erinnerungen (per ESLint und Test abgesichert, siehe security.md).               |
| Getrennte Zugriffe für einen Agenten    | Ein späterer Agent liest Notizen nur nach ausdrücklicher Freigabe; er schreibt nie Notizen und veröffentlicht nie. |

## 3. Zielbild: Hierarchie

```
Notizbuch                     z. B. „Gewerbe“, „Privat“, „Tagebuch“
 └─ Abschnitt                 z. B. „Kundenprojekte“
     └─ Unterordner (optional, höchstens 2 Ebenen tief)
         └─ Seite             Titel, Inhalt, Erstellt/Geändert, Position
```

Skizze für eine **spätere** Migration (bewusst noch nicht angelegt), jeweils mit `owner_id`, RLS
mit vier Policies, expliziten Grants, Index auf `owner_id` und Fremdschlüsseln sowie
`updated_at`-Trigger nach den Projektregeln:

| Tabelle (Entwurf)  | Wichtige Spalten                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `notebooks`        | `title`, `position`, `archived_at`                                                                                  |
| `note_sections`    | `notebook_id`, `parent_id` (Unterordner, Tiefe per Trigger begrenzt), `title`, `position`                           |
| `note_pages`       | `section_id`, `title`, `body` (siehe 4.1), `body_text` (für Suche), `kind` (`page`/`daily`), `position`, `revision` |
| `note_links`       | `page_id`, `target_type` (`date`/`week`/`entry`), `target_date`, `target_week`, `target_entry_id`                   |
| `note_attachments` | `page_id`, `storage_path`, `mime_type`, `size_bytes`, `sha256`                                                      |

Sortierung über eine `position` (Bruchzahl oder Lexorank), damit Verschieben nur eine Zeile
ändert. Gleichzeitiges Bearbeiten wie bei der Tagesnotiz über `revision` (Konflikt statt
Überschreiben).

## 4. Spätere Funktionen

1. **Formatierter Text:** strukturiertes JSON (Absätze, Überschriften, Listen, Fett/Kursiv,
   Links) statt rohem HTML; daraus wird `body_text` für die Suche abgeleitet. HTML wird beim
   Import und beim Anzeigen nie ungeprüft übernommen (Allowlist, keine Skripte, keine Styles).
2. **Checklisten:** eigener Blocktyp mit „erledigt“-Kennzeichen; lösen keine Erinnerungen aus und
   erzeugen keine Planblöcke.
3. **Suche:** Postgres-Volltextsuche (Konfiguration `german`) auf `body_text` und Titel, mit RLS;
   kein externer Suchdienst. Treffer zeigen nur kurze Ausschnitte.
4. **Sortierung:** manuell (Position), nach Änderungsdatum oder Titel; Tagesnotizen nach Datum.
5. **Verknüpfung mit Datum, Planblock, Woche:** Datum und Woche als Werte. Planblöcke werden je
   Version kopiert – ein Verweis speichert deshalb Block-ID **und** Woche/Datum/Uhrzeit, damit er
   auch nach einer neuen Version auflösbar bleibt („Block aus Version 2“). Kein Fremdschlüssel mit
   Kaskade.
6. **Bilder und Anhänge:** privater Supabase-Storage-Bucket, Pfad `owner_id/…`, RLS auf
   `storage.objects`, Größen- und MIME-Grenzen, Metadaten (EXIF) entfernen, nur kurzlebige
   signierte URLs, keine öffentlichen Links. Speicher kostet ggf. Geld – nur nach Rücksprache.
7. **Vorlagen:** einfache Seitenvorlagen (z. B. „Wochenrückblick“), vom Benutzer gepflegt, ohne KI.

## 5. Migration der Tagesnotizen in spätere Seiten

Zwei Wege, Entscheidung beim Ausbau:

- **A – Tagesnotizen bleiben eigenständig** und erscheinen in einem virtuellen Notizbuch
  „Tagebuch“ (keine Datenmigration, geringstes Risiko).
- **B – Überführung in `note_pages` mit `kind = 'daily'`** und Eindeutigkeit je Datum:
  1. additive Migration legt die neuen Tabellen an (alte bleibt unverändert),
  2. Kopie per SQL in einer Transaktion; Anzahl und Prüfsumme (z. B. `md5` über Datum + Inhalt)
     vorher/nachher vergleichen – wie beim Fingerabdruck in `pnpm db:upgrade-test`,
  3. Übergangszeit: `daily_notes` nur noch lesbar, Web und App lesen aus `note_pages`,
  4. Entfernen der alten Tabelle erst nach Prüfung, mit eigenem Rollback-Skript,
  5. Inhalt verlustfrei: Zeilenumbrüche werden zu Absätzen, sonst keine Umformung.

Produktion in beiden Fällen nur gemeinsam mit dem Benutzer nach
[production-migration-runbook.md](production-migration-runbook.md).

## 6. Datenschutz und Speicherung

- Notizen liegen in der Supabase-Datenbank des Projekts (Region wie beim Anlegen des Projekts
  gewählt), vom Anbieter verschlüsselt gespeichert, aber **ohne Ende-zu-Ende-Verschlüsselung**.
  Eine clientseitige Verschlüsselung würde Suche, Export und Agent-Zugriff erschweren und ist eine
  offene Entscheidung.
- Keine Inhalte in Logs, Fehlermeldungen, Telemetrie oder Benachrichtigungen. Keine KI-Auswertung
  ohne ausdrückliche, jeweils einzelne Zustimmung.
- App: derzeit keine Notizen auf dem Gerät. Offline-Notizen würden einen verschlüsselten lokalen
  Speicher und eine Konfliktstrategie erfordern – bewusst zurückgestellt.
- Im Repository nie echte Notizen: Seed, Tests, Screenshots und Doku nur mit erfundenen Texten;
  `pnpm check:secrets` und `.gitignore` blockieren Verknüpfungen, OneNote-Dateien und Exporte.

## 7. Sicherung und Export

- **Export (später):** vom Benutzer ausgelöster Download aller Notizen als Markdown (ZIP) oder
  JSON, serverseitig je Anfrage erzeugt und nicht gespeichert. Exporte gehören nie ins Repository.
- **Sicherung:** im kostenlosen Plan regelmäßig selbst sichern (z. B. `supabase db dump
--data-only`), verschlüsselt außerhalb des Repositorys ablegen und die Wiederherstellung testen;
  im bezahlten Plan tägliche Backups von Supabase (kostenpflichtig – nur nach Rücksprache).

## 8. OneNote-Import (Strategie)

> **Wichtig:** Die Datei **`Tagesablauf.url` ist lediglich eine Internetverknüpfung** (ein Link,
> vermutlich auf ein OneNote-Notizbuch) und enthält keine Notizinhalte. Sie wurde **nicht** als
> Dokument behandelt, **nicht** gelesen, **nicht** ins Repository kopiert, und es wurde **nichts
> importiert**. Für einen Import wird ein **echter Export** benötigt – z. B. **PDF**, ein
> **OneNote-Paket** (`.onepkg`), **HTML/MHT** oder **Word** (`.docx`).

**Eingabeformate (Eignung):**

| Format                        | Eignung  | Bemerkung                                                                                       |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Word (`.docx`) je Abschnitt   | gut      | Überschriften, Listen, Tabellen, Bilder strukturiert auslesbar                                  |
| HTML / MHT je Seite           | gut      | strukturiert; HTML nur über Allowlist, Skripte/Styles werden verworfen                          |
| PDF                           | mittel   | nur Text und Reihenfolge, Layout und Checklisten gehen verloren                                 |
| OneNote-Paket (`.onepkg`)     | schlecht | proprietäres Archiv aus `.one`-Dateien, kein verlässlicher offener Parser – zunächst nicht      |
| Microsoft Graph (OneNote-API) | später   | erfordert Anmeldung beim Microsoft-Konto und Berechtigungen – nur mit ausdrücklicher Zustimmung |

**Ablauf:**

1. Der Benutzer wählt einen Export bewusst aus (kein automatisches Durchsuchen von Ordnern).
2. Verarbeitung als **nicht vertrauenswürdige Eingabe**: Größen- und Seitenlimits, Schutz vor
   ZIP-Bomben, kein Ausführen eingebetteter Inhalte, temporäre Dateien werden gelöscht.
3. **Importvorschau:** Liste der erkannten Seiten mit Titel, Datum, Umfang, Anhängen und
   Duplikat-Hinweis; nichts wird ohne Bestätigung gespeichert.
4. Import in ein eigenes Notizbuch „Import“ als normale Seiten; die **Originale werden nie
   verändert, verschoben oder gelöscht**.
5. **Duplikaterkennung:** SHA-256 über normalisierten Titel + Text (+ Quell-Seiten-ID, falls
   vorhanden); bereits importierte Seiten werden in der Vorschau markiert und standardmäßig
   übersprungen. Ein erneuter Import ist dadurch wiederholbar ohne Doppelungen.
6. **Keine automatische Interpretation:** Aus importierten Notizen entstehen ohne ausdrückliche
   Zustimmung weder Termine noch Planblöcke, Ziele, Kategorien oder Zusammenfassungen. Ein
   späterer Agent darf daraus höchstens einen **Entwurf** vorschlagen (siehe
   [agent-integration.md](agent-integration.md)).

## 9. Offene Entscheidungen

1. Format für formatierten Text (eigenes JSON-Schema vs. etabliertes Dokumentmodell).
2. Ende-zu-Ende-Verschlüsselung ja/nein (Abwägung gegen Suche, Export, Agent).
3. Offline-Notizen in der App (verschlüsselter lokaler Speicher, Konflikte).
4. Speicherkosten für Anhänge und ob Microsoft Graph angebunden werden soll.
5. Weg A oder B für die Tagesnotizen (Abschnitt 5).

## 10. Ausdrücklich nicht umgesetzt

Keine Tabellen, Policies oder Migrationen für Notizbücher, Abschnitte, Unterordner, Seiten,
Verknüpfungen oder Anhänge; kein Import-, Export- oder Suchcode; keine Storage-Buckets; keine
Anbindung an Microsoft-Dienste.

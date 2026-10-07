# UI-Spezifikation

Verbindliche Beschreibung der Bildschirme, Komponenten, Zustände und Texte. Visuelle Grundlage:
das Design-Artefakt ([design-artifact.md](design-artifact.md)). Werte: [design-system.md](design-system.md).

## Begriffe (verbindlich)

| Begriff in der UI          | Bedeutung                                                            | Nicht verwenden         |
| -------------------------- | -------------------------------------------------------------------- | ----------------------- |
| **Fokus starten**          | tatsächliche Zeit für einen Planblock (Gewerbe, Sport, Laila) messen | einloggen, einstempeln  |
| **Aktivität starten**      | spontan ohne Planblock messen                                        | Check-in                |
| **Beenden**                | laufende Aktivität stoppen (Serverzeit)                              | ausloggen, ausstempeln  |
| **Abbrechen**              | versehentlich gestartete Aktivität verwerfen (wird gelöscht)         | –                       |
| **Zeit korrigieren**       | Beginn/Ende einer Aktivität nachträglich ändern                      | bearbeiten (mehrdeutig) |
| **Zeit nachtragen**        | vergangene Aktivität ohne Timer erfassen                             | –                       |
| **geplant / erfasst**      | Planblöcke vs. aufgezeichnete Aktivitäten – nie vermischt            | erledigt = erfasst      |
| **Erledigt / Ausgelassen** | Planstatus eines Blocks (`completion_status`), kein Zeitnachweis     | –                       |
| **Plan bearbeiten**        | ausdrücklicher Bearbeitungsmodus, wirkt nur auf einen Entwurf        | –                       |
| **Veröffentlichen**        | Entwurf wird neue sichtbare Version; vorherige wird archiviert       | speichern               |

Pausieren wird nicht angeboten: Eine Aktivität ist ein durchgehender Zeitraum. Unterbrechungen
werden durch Beenden und erneutes Starten abgebildet.

## Ziele

- Drei Ziele: **Gewerbe** (`business`), **Sport** (`sport`), **Laila** (`relationship`).
- Wochenziel in Minuten; Gewerbe Standard 1200 (20 h). Sport und Laila starten **ohne Ziel** (`null`).
- „Kein Ziel“ (null oder 0) erzeugt nie „erreicht“; die Zeile zeigt „Ziel noch festlegen“.
- Werte je Ziel und Woche: **Ziel**, **geplant** (Planblöcke außer „ausgelassen“, Überlappung
  einmal gezählt), **erfasst** (Aktivitäten, laufende bis jetzt), **Differenz** (erfasst − Ziel),
  **noch eingeplant** (Planzeit ab jetzt).
- Status (laufende Woche): `unset` → kein Ziel · `reached` → erfasst ≥ Ziel · `over` → erfasst ≥
  Ziel + max(60 min, 10 %) · `on_track` → erfasst + noch eingeplant ≥ Ziel · sonst `at_risk`.
  Abgeschlossene Woche: `reached`/`over`/`below`.
- Texte (sachlich, ohne Wertung):
  - „Dir fehlen noch 3 h Gewerbe.“ (+ „Eingeplant sind noch 2 h.“ bzw. „Dafür ist noch nichts eingeplant.“)
  - „Sport ist für diese Woche ausreichend eingeplant.“
  - „Für Laila ist noch kein Wochenziel festgelegt.“
  - „Gewerbe-Ziel erreicht.“ / „Sport liegt 1,5 h über dem Wochenziel.“
  - abgeschlossen: „Gewerbe: 17,5 h von 20 h erfasst.“

## Mobile App

Navigation: vier Tabs unten – **Jetzt · Tag · Woche · Mehr** (Icon + Text, aktiver Tab mit
Indikator-Pille). Weitere Ziele über Stapel-Navigation: **Ziele** (aus Jetzt/Woche), **Plan
bearbeiten** (aus Woche/Tag), **Wochenbilanz** (aus Ziele). Die **Timer-Leiste** erscheint über der
Tab-Leiste auf allen Tabs außer „Jetzt“, solange eine Aktivität läuft.

| Bildschirm           | Inhalt (Reihenfolge)                                                                                                                                      | Zustände                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| App-Sperre           | Zeichen, „TagesTakt ist gesperrt“, Erklärung, „Entsperren“, „Abmelden und mit Passwort anmelden“                                                          | abgebrochen, keine Gerätesperre eingerichtet                          |
| Login                | Überzeile, „Anmelden“, Hinweis ohne Registrierung, E-Mail, Passwort, Fehler oben                                                                          | Laden, Fehler                                                         |
| Jetzt                | Datum/KW/Uhrzeit · Offline-Banner · **Jetzt-Fläche** · Als Nächstes · Diese Woche (drei Ziele, Link „Ziele“)                                              | Block mit/ohne Ziel, Aktivität läuft, freie Zeit, kein Plan, offline  |
| Tag                  | Datum, 7-Tage-Leiste · Zeitstrahl (Zeit, Schiene, Block), Jetzt-Linie, freie Lücken, „erfasst“-Chips · Erfasst heute                                      | vergangen/aktuell/kommend, leer, offline                              |
| Woche                | „Diese / Nächste Woche“, Version · Ziele kompakt · sieben Tage gestapelt (max. 4 Einträge + „weitere“) · „Bearbeiten“                                     | kein Plan veröffentlicht                                              |
| Plan bearbeiten      | Entwurfs-Banner, Woche, Liste je Tag, Block-Sheet, „Eintrag“, „Veröffentlichen“                                                                           | kein Entwurf → „Neue Version anlegen“ (Bestätigung), offline gesperrt |
| Ziele                | Legende · je Ziel: Status, Ziel/geplant/erfasst, Balken, Satz · Erfasst diese Woche (Korrigieren)                                                         | ohne Ziel                                                             |
| Wochenbilanz         | Woche wählen · Kernsatz · Tabelle Ziel/geplant/erfasst/Differenz · Status je Ziel                                                                         | abgeschlossen vs. laufend                                             |
| Mehr (Einstellungen) | Wochenziele · Erinnerungen (Gerät, Berechtigung, Vorlauf, Beginn, nicht gestartet, Umfang, Details) · App-Sperre · Synchronisierung · Konto · Datenschutz | Berechtigung verweigert/unbekannt, Biometrie nicht verfügbar          |

### Jetzt-Fläche (Kernkomponente)

1. **Aktivität läuft:** Ziel-Chip + „Läuft“, Titel, Laufzeit (Mono 56), „seit 17:04 · Plan bis
   20:00“, Bezug zum Planblock, **Beenden** (Primär, 56 dp), darunter „Zeit korrigieren“ und
   „Abbrechen“. Ab 12 h Laufzeit Hinweis „Vermutlich vergessen – Ende korrigieren“.
2. **Zielblock läuft, keine Aktivität:** Ziel-Chip + „Jetzt · 17:00–20:00“, Titel, Restzeit (Mono 36),
   Fortschrittslinie, „Noch nicht erfasst“, **Fokus starten**, darunter „Erledigt“ / „Ausgelassen“.
3. **Anderer Block (z. B. Dienst):** wie 2., aber ohne Fokus-Knopf; Status-Aktionen bleiben.
4. **Freie Zeit:** „Gerade nichts geplant“, nächster Block, **Aktivität starten** mit Wahl
   Gewerbe/Sport/Laila (Sheet).
5. **Offline:** Schreibende Aktionen deaktiviert mit sichtbarer Begründung; Laufzeit zählt lokal weiter.

### Dialoge

- **Wechsel:** „Gewerbe läuft noch“ – Vorher/Nachher-Vergleich – „Gewerbe beenden, Sport starten“
  (primär), „Nur Gewerbe beenden“, „Abbrechen – Gewerbe läuft weiter“.
- **Abbrechen:** „Aktivität verwerfen? Die erfasste Zeit (12 Min.) wird gelöscht.“
- **Neue Version:** „Version 1 ist veröffentlicht. Zum Ändern wird Version 2 als Entwurf angelegt;
  die App zeigt weiter Version 1, bis du veröffentlichst.“
- **Veröffentlichen:** nennt Version und Anzahl Überschneidungen.
- **Löschen eines Blocks:** nennt den Titel.

### Erinnerungen (lokal)

- Berechtigung erst beim Einschalten in „Mehr“ anfragen (vorher Erklärung mit Beispieltext).
- Texte ohne Details (Standard): Titel „Gewerbe in 10 Min.“, Text „Beginnt um 17:00.“ –
  „Sport beginnt jetzt.“ – „Gewerbe noch nicht gestartet“ / „Geplant seit 17:00.“
- Mit „Titel auf dem Sperrbildschirm“: „Kundenprojekt · Gewerbe in 10 Min.“; Notizen nie.

## Website

Navigation: Seitenleiste ab 1024 px (Übersicht, Wochenplan, Wiederholungen, Auswertung,
Einstellungen; laufende Aktivität unten als kompakte Karte), darunter Kopfzeile mit Marke,
Timer-Chip und aufklappbarem „Menü“ (`<details>`, ohne JavaScript bedienbar).

| Seite            | Inhalt                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login            | schmale Spalte, Zeichen, „Anmelden“, E-Mail, Passwort, Fehler am Feld, Hinweis ohne Registrierung                                                                                                            |
| Übersicht        | Jetzt (laufende Aktivität oder aktueller Block mit Start) · Als Nächstes (3) · Wochenziele-Tabelle · Planung (aktuelle/nächste KW)                                                                           |
| Wochenplan       | Kopf mit Wochenwechsel + Datumsfeld (synchron zur URL) · Versions-Chips · Entwurfs-/Veröffentlicht-Banner · Überschneidungen · **Zeitraster** (≥ 1100 px) bzw. **Tagesliste** (schmal) · Bearbeitungsbereich |
| Block bearbeiten | Seitenbereich bzw. unter der Liste: Titel, Kategorie, Tag, Beginn, Ende, Folgetag, Ort, Notiz; „Verschieben ±15/±30“, „Dauer ±15/±30“, Speichern, Löschen (Bestätigung); Rückgängig nach Verschieben         |
| Wiederholungen   | Wochenstruktur (7 Spalten) · neue Wiederholung mit Mehrfach-Wochentagen („Werktage“) · Übernahme in Entwurf · Liste mit sichtbaren Aktionen inkl. Duplizieren                                                |
| Auswertung       | Woche wählen · Bilanz je Ziel (Ziel/geplant/erfasst/Differenz/Status) · letzte vier Wochen · erfasste Aktivitäten mit Korrigieren/Löschen · Zeit nachtragen                                                  |
| Einstellungen    | Wochenziele (Stunden, leer = kein Ziel) · Erinnerungen · Zeit und Sprache · Sicherheit und Datenschutz (Biometrie = Gerät) · Konto                                                                           |

Drag-and-drop wird **nicht** angeboten: Verschieben erfolgt über Schaltflächen und Formular
(tastatur- und touch-tauglich, ohne JavaScript nutzbar, testbar). Nach einem Verschieben erscheint
ein Hinweis mit „Rückgängig“.

## Zustände (beide Plattformen)

| Zustand  | Muster                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Leer     | Linienzeichnung, ein Satz, eine Hauptaktion („Entwurf anlegen“ / „Wiederholungen übernehmen“)                      |
| Offline  | Warn-Banner mit Stand („zuletzt aktualisiert heute, 14:02 Uhr“) und Folge („Starten … erst wieder mit Verbindung“) |
| Fehler   | Fehlerfläche mit Ursache in Alltagssprache, „Erneut versuchen“, neutraler Fehlercode                               |
| Veraltet | Hinweis ab 6 h ohne erfolgreiche Synchronisierung                                                                  |
| Laden    | kurzer Indikator mit Beschriftung, keine Skelett-Flut                                                              |

## Barrierefreiheit

- Web: semantisches HTML, `nav`/`main`/Überschriftenhierarchie, `aria-current`, sichtbarer Fokus,
  Fehler mit `aria-invalid` + `aria-describedby`, Live-Regionen für Statusmeldungen, Timer mit
  `role="timer"` und Minuten-genauer `aria-label` (keine Sekunden-Ansagen).
- Mobile: `accessibilityRole`, `accessibilityLabel`/`Hint`/`State`, Tabs mit Text, Dialoge als
  Modal mit Fokus, Textskalierung ohne abgeschnittene Inhalte, Mindestgröße 48 dp.
- Status nie nur über Farbe: Wort + Symbol + Muster (gestrichelt = geplant, gefüllt = erfasst).

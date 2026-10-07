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
| **Freie Zeit**             | gerade läuft kein Block; Countdown zum nächsten, nichts startet      | Pause, Leerlauf         |
| **Tagesnotiz**             | reiner Text zu einem Kalendertag, unabhängig von Planversionen       | Notiz des Blocks        |

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
| Jetzt                | Datum/KW/Uhrzeit · Offline-Banner · **Fokusfläche** · Tagesnotiz (eine Zeile) · Als Nächstes · Diese Woche (drei Ziele, Link „Ziele“)                     | alle Fokus-Zustände (siehe unten), offline                            |
| Tag                  | Datum, 7-Tage-Leiste · **Tagesnotiz** (Vorschau, „Notiz bearbeiten“) · Zeitstrahl, Jetzt-Linie, freie Lücken, „erfasst“-Chips · Erfasst heute             | vergangen/aktuell/kommend, leer, offline (Notiz nicht verfügbar)      |
| Tagesnotiz           | „Zurück“ · Titel + Datum · Zähler · Textfeld (füllt den Platz über der Tastatur) · Status · „Speichern“                                                   | leer, geändert, speichert, gespeichert, Fehler, Konflikt, offline     |
| Woche                | „Diese / Nächste Woche“, Version · Ziele kompakt · sieben Tage gestapelt (max. 4 Einträge + „weitere“) · „Bearbeiten“                                     | kein Plan veröffentlicht                                              |
| Plan bearbeiten      | Entwurfs-Banner, Woche, Liste je Tag, Block-Sheet, „Eintrag“, „Veröffentlichen“                                                                           | kein Entwurf → „Neue Version anlegen“ (Bestätigung), offline gesperrt |
| Ziele                | Legende · je Ziel: Status, Ziel/geplant/erfasst, Balken, Satz · Erfasst diese Woche (Korrigieren)                                                         | ohne Ziel                                                             |
| Wochenbilanz         | Woche wählen · Kernsatz · Tabelle Ziel/geplant/erfasst/Differenz · Status je Ziel                                                                         | abgeschlossen vs. laufend                                             |
| Mehr (Einstellungen) | Wochenziele · Erinnerungen (Gerät, Berechtigung, Vorlauf, Beginn, nicht gestartet, Umfang, Details) · App-Sperre · Synchronisierung · Konto · Datenschutz | Berechtigung verweigert/unbekannt, Biometrie nicht verfügbar          |

### Fokusfläche (Kernkomponente, Web-Übersicht und App „Jetzt“)

Ganz oben, ruhig und kalenderartig: Der relevante Block steht **groß und scharf in der Mitte**
(Kategorie als Text + Farbe, Titel, Beginn–Ende, Rest- bzw. Laufzeit, Ort, Hauptaktion). Der
vorherige Block liegt klein, unscharf und angeschnitten darüber, der nächste darunter – ohne
Bedienelemente, für Screenreader verborgen. „Davor: … / Danach: …“ steht zusätzlich als Text im
Fokusblock. Logik: `getFocusState` (gemeinsam für Web und App).

1. **Aktivität läuft** (Vorrang vor dem Plan): Ziel-Chip + „Läuft“, Titel, Laufzeit (Mono),
   „seit 17:04 · Plan bis 20:00“, Bezug zum Planblock, **Beenden**, „Zeit korrigieren“,
   „Abbrechen“; ab 12 h „Vermutlich vergessen“, ab 24 h nur noch „Zeit korrigieren“. Läuft
   gleichzeitig ein anderer Zielblock: Wechsel-Angebot.
2. **Zielblock (Fokusblock):** Ziel-Chip, „Jetzt · 17:00–20:00“, Titel, Restzeit groß
   („1:55 Std. übrig · endet um 20:00“), Fortschrittslinie, Ort, „Noch nicht erfasst“,
   **Fokus starten**, „Erledigt“ / „Ausgelassen“.
3. **Anderer Block (z. B. Dienst):** wie 2., ohne Fokus-Knopf; Status-Aktionen und „Aktivität
   starten“ bleiben.
4. **Überschneidung:** Fokus auf dem zuletzt begonnenen Block; Warnzeile „Überschneidung:
   gleichzeitig „…“ (17:00–20:00)“; für gleichzeitig laufende Zielblöcke zusätzlich „Fokus für
   „…“ starten“. Überschneidungen werden nie verhindert.
5. **Freie Zeit:** Überschrift „Freie Zeit“, Countdown „20 Min. bis zum nächsten Block“, „Als
   Nächstes: 17:00 Kundenprojekt“, **Aktivität starten** (Gewerbe/Sport/Laila). Es startet nie
   etwas automatisch.
6. **Vor dem ersten Block:** „Noch frei bis 07:00“ mit Countdown; **nach dem letzten Block:**
   „Heute ist nichts mehr geplant.“ mit dem nächsten Block (z. B. „morgen 07:00“).
7. **Kein Plan:** „Für diese Woche ist (noch) kein Plan veröffentlicht.“, Weg zum Wochenplan
   (Web), spontanes Erfassen bleibt möglich; keine Nachbarn.
8. **Fehler (Web):** „Der Plan konnte nicht geladen werden.“, „Erneut versuchen“, Fehlercode
   `PLAN_LOAD`; Ziele und Notizen bleiben nutzbar.
9. **Offline (App):** Plan aus dem Cache, schreibende Aktionen deaktiviert mit Begründung; Laufzeit
   zählt lokal weiter.

**Wechsel:** genau an der Blockgrenze ohne Neuladen (Timer auf `nextChangeAt`, Europe/Berlin
inkl. Zeitumstellung; keine sekündliche Neuberechnung). Kurzer, ruhiger Übergang (≈ 250 ms
Einblenden, 6 px Versatz); bei „Bewegung reduzieren“ **ohne** Bewegung und Einblendung. Der neue
Fokus wird höflich angesagt („Jetzt im Fokus: …“). Unschärfe: Web per CSS, App unter Android per
`filter: blur`; iOS kennt das in React Native nicht – dort nur blass und angeschnitten.

### Tagesnotiz (Web und App)

- Eine Notiz je Kalendertag, **reiner Text**, mehrzeilig, höchstens 10 000 Zeichen (Zähler
  „142 / 10.000“). Leeren und Speichern entfernt die Notiz. Unabhängig von Planversionen und
  Wiederholungen.
- Ausdrückliches Speichern („Speichern“, Web zusätzlich Strg + S). Status sichtbar und für
  Screenreader angesagt: „Noch keine Notiz für diesen Tag.“ · „Nicht gespeicherte Änderungen“ ·
  „Wird gespeichert …“ · „Gespeichert um 08:12 Uhr“ · Fehler („Nicht gespeichert. Bitte erneut
  versuchen – dein Text bleibt hier erhalten.“, Knopf „Erneut speichern“) · Konflikt („Diese
  Notiz wurde inzwischen an anderer Stelle geändert. …“; darunter die **andere gespeicherte
  Fassung** bzw. „Die Notiz wurde andernorts entfernt.“, dann „Meine Fassung speichern“ /
  „Gespeicherte Fassung laden“). Steht auf dem Server bereits genau der eigene Text (z. B.
  Antwort ging verloren), gilt das als gespeichert, nicht als Konflikt.
- Der Text bleibt bei Fehlern und Konflikten immer erhalten; eine ältere Serverantwort oder
  ältere Fassung ersetzt nie neuere Eingaben. Verlassen mit ungespeicherten Änderungen fragt nach
  (Web: Links, Absenden anderer Formulare und Schließen des Tabs; App: „Zurück“ und
  Android-Zurück-Taste, Wischgeste aus). **Grenze (Web):** Die Zurück-Taste des Browsers
  innerhalb der Website lässt sich in Next.js nicht zuverlässig abfangen.
- Wechselt auf der Übersicht um Mitternacht der Tag, während ungespeicherter Text besteht,
  bleibt der Editor beim bisherigen Tag („Tagesnotiz · Mittwoch, 14. Oktober“); erst danach folgt
  er dem neuen Tag – Text wird nie einem anderen Tag zugeordnet.
- **Web:** Übersicht – aufklappbare Zeile „Tagesnotiz · heute“ mit erster Zeile; Wochenplan –
  Abschnitt „Tagesnotiz“ mit Tagesauswahl (Links, `aria-current="date"`) und **einem** Editor;
  Markierung „Notiz“ im Zeitraster und „Notiz“/„Notiz schreiben“ in der Tagesliste.
- **App:** „Tag“ zeigt Vorschau (4 Zeilen) und „Notiz bearbeiten“ bzw. „Notiz schreiben“;
  „Jetzt“ nur eine Zeile. Der Editor ist ein eigener Bildschirm, der Inhalt rückt über die
  Tastatur. **Offline:** „Ohne Verbindung nicht verfügbar – Tagesnotizen werden nicht auf dem
  Gerät gespeichert …“ mit „Erneut versuchen“; es wird nie eine Notiz vorgetäuscht.
- Notizen erscheinen nie in Erinnerungen, Logs oder Fehlermeldungen. Keine KI-Auswertung.

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

| Seite            | Inhalt                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login            | schmale Spalte, Zeichen, „Anmelden“, E-Mail, Passwort, Fehler am Feld, Hinweis ohne Registrierung                                                                                                                                                                      |
| Übersicht        | **Fokusfläche** (siehe oben) · Tagesnotiz heute (aufklappbar) · Als Nächstes (3) · Diese Woche (Ziele) · Planung (aktuelle/nächste KW)                                                                                                                                 |
| Wochenplan       | Kopf mit Wochenwechsel + Datumsfeld (synchron zur URL) · Versions-Chips · Entwurfs-/Veröffentlicht-Banner · Überschneidungen · **Zeitraster** (≥ 1100 px) bzw. **Tagesliste** (schmal) · Bearbeitungsbereich · Ziele · **Tagesnotiz** (`?notiz=JJJJ-MM-TT#tagesnotiz`) |
| Block bearbeiten | Seitenbereich bzw. unter der Liste: Titel, Kategorie, Tag, Beginn, Ende, Folgetag, Ort, Notiz; „Verschieben ±15/±30“, „Dauer ±15/±30“, Speichern, Löschen (Bestätigung); Rückgängig nach Verschieben                                                                   |
| Wiederholungen   | Wochenstruktur (7 Spalten) · neue Wiederholung mit Mehrfach-Wochentagen („Werktage“) · Übernahme in Entwurf · Liste mit sichtbaren Aktionen inkl. Duplizieren                                                                                                          |
| Auswertung       | Woche wählen · Bilanz je Ziel (Ziel/geplant/erfasst/Differenz/Status) · letzte vier Wochen · erfasste Aktivitäten mit Korrigieren/Löschen · Zeit nachtragen                                                                                                            |
| Einstellungen    | Wochenziele (Stunden, leer = kein Ziel) · Erinnerungen · Zeit und Sprache · Sicherheit und Datenschutz (Biometrie = Gerät) · Konto                                                                                                                                     |

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
- Fokusfläche: Nachbarblöcke sind Dekoration (`aria-hidden` + `inert` bzw.
  `importantForAccessibility="no-hide-descendants"`), ihr Inhalt steht als Text im Fokusblock;
  Fokuswechsel per Live-Region bzw. `announceForAccessibility`; „Bewegung reduzieren“ entfernt
  jede Übergangsbewegung.
- Tagesnotiz: beschriftetes Textfeld, Status per `role="status"`/`alert` bzw.
  `accessibilityLiveRegion`, sichtbarer Fokus, Zähler mit vorlesbarer Beschriftung.

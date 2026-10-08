# Visuelle Prüfung (Visual QA)

Stand: 07.10.2026, Branch `feat/design-and-focus-tracking`. Geprüft wurde die Umsetzung gegen das
[Design-Artefakt](design-artifact.md) und die [UI-Spezifikation](ui-spec.md).

## Vorgehen

| Bereich  | Methode                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website  | Lokale Website (`pnpm dev:web`) gegen lokales Supabase mit den frei erfundenen Seed-Daten („(Beispiel)“). Automatisierte Bildschirmfotos mit einem lokal gestarteten Microsoft Edge (headless, Chrome DevTools Protocol) in **1440 px, 1024 px und 390 px**, dunkel und hell. Pro Seite gemessen: horizontales Scrollen, Seitenhöhe, Bedienelemente kleiner als 44 × 44 px. |
| Ablauf   | Fokus starten → Wochenplan mit laufender Aktivität → Beenden; Ergebnis zusätzlich in der lokalen Datenbank geprüft (Serverzeiten, nicht als „korrigiert“ markiert).                                                                                                                                                                                                         |
| Kontrast | Berechnung aller Farbpaare aus `packages/design-tokens` (WCAG-Formel); als Test abgesichert.                                                                                                                                                                                                                                                                                |
| App      | **Keine** visuelle Prüfung auf Gerät oder Emulator möglich (in dieser Umgebung gibt es weder Android-Emulator noch Gerät). Stattdessen: Komponententests (React Native Testing Library), Prüfung der Stile gegen die Tokens, Durchsicht aller Bildschirme im Code gegen M01–M15.                                                                                            |

Die Bildschirmfotos enthalten nur Beispieldaten, werden aber gemäß Projektregel **nicht** im
Repository abgelegt; das Skript dafür ist ein lokales Hilfsmittel und ebenfalls nicht Teil des
Repositorys.

## Ergebnisse Website

| Seite           | 1440 px | 1024 px | 390 px | Hell | Horizontales Scrollen | Ziele < 44 px (nach Korrektur) |
| --------------- | ------- | ------- | ------ | ---- | --------------------- | ------------------------------ |
| Login           | –       | –       | ✓      | –    | nein                  | keine                          |
| Übersicht       | ✓       | ✓       | ✓      | –    | nein                  | keine                          |
| Wochenplan      | ✓       | ✓       | ✓      | –    | nein                  | keine                          |
| Entwurf + Block | ✓       | –       | ✓      | –    | nein                  | keine                          |
| Wiederholungen  | ✓       | ✓       | –      | ✓    | nein                  | keine                          |
| Auswertung      | ✓       | –       | ✓      | ✓    | nein                  | keine                          |
| Einstellungen   | ✓       | –       | ✓      | –    | nein                  | keine                          |
| Menü (schmal)   | –       | –       | ✓      | –    | nein                  | keine                          |

### Gefunden und behoben

| Befund (erster Durchlauf)                                                                                | Korrektur                                                                        |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Textlinks „Zur Auswertung“, „Ziele ändern“ und die KW-Links der Auswertung nur ca. 20 px hoch            | Links als Schaltflächen-Links mit Mindesthöhe 44 px                              |
| „Zum Inhalt springen“ 43 px hoch                                                                         | Mindesthöhe 44 px                                                                |
| Veröffentlichter Wochenplan bei 1440 px über 7 000 px lang (Zeitraster plus vollständige Liste darunter) | Liste durch einen ausklappbaren Detailbereich ersetzt – Seite jetzt ca. 2 200 px |
| Restzeit-Angaben uneinheitlich formatiert                                                                | einheitlich „noch 2 Std. 30 Min.“ bzw. große Ziffern mit Einheit                 |
| Spontane Aktivität hieß nur „Aktivität“                                                                  | Titel = Zielname („Gewerbe“, „Sport“, „Laila“)                                   |
| Satz „0 von 1 Wochenzielen …“                                                                            | eigener Satz für genau ein Ziel („Das Wochenziel ist noch nicht erreicht.“)      |

### Bekannte Beobachtungen (nicht geändert)

- ~~Unter 1100 px zeigt der Wochenplan statt des Zeitrasters eine **Tagesliste**; mit vielen
  Blöcken wird die Seite sehr lang (390 px ca. 10 000 px).~~ **Erledigt:** Auch schmal zeigt der
  Wochenplan jetzt das Zeitraster in einem eigenen Scrollbereich mit „Vollbild“ – siehe
  [Wochenplan schmal](#wochenplan-schmal-zeitraster-scrollbereich-und-vollbild).
- Das helle Erscheinungsbild wurde für Auswertung und Wiederholungen fotografiert, die übrigen
  Seiten nur dunkel; die Farben stammen in beiden Fällen aus denselben geprüften Tokens.

## Kontrast (aus den Tokens berechnet)

| Paar                                 | Dunkel    | Hell      |
| ------------------------------------ | --------- | --------- |
| `text` auf `bg`                      | 16,5 : 1  | 16,3 : 1  |
| `textMuted` auf `bg`                 | 9,4 : 1   | 8,5 : 1   |
| `textSubtle` auf `bg` / `surface3`   | 6,0 / 4,6 | 5,8 / 4,9 |
| Zieltöne auf `bg` (kleinster Wert)   | 7,1 : 1   | 5,2 : 1   |
| `lineStrong` auf `bg` (Bedienränder) | 3,9 : 1   | 3,7 : 1   |
| Primärknopf (`onInverse`/`inverse`)  | 16,2 : 1  | 16,3 : 1  |

Kategorien und Zielstatus stehen immer zusätzlich als Text (bzw. Symbol + Text) – Farbe ist nie
der einzige Träger einer Information.

## Erweiterung: Fokusfläche und Tagesnotiz (W11–W18, M16–M20)

Stand: 07.10.2026 abends, gleiches Verfahren (lokale Website, lokales Supabase mit Seed-Daten,
Edge headless über CDP). **Kontrollierte Testzeit:** Die Browser-Uhr wurde je Aufnahme auf 12:10,
16:30 bzw. 19:35 Uhr (Europe/Berlin) gestellt – die Fokusfläche übernimmt nach dem Laden die
Geräteuhr, der Server blieb unverändert. Der Zustand „Aktivität läuft“ wurde mit echter Zeit über
„Fokus starten“ erzeugt. Notizen nur mit erfundenem Text („Testnotiz (Beispiel)“); Testdaten
wurden danach per `pnpm db:reset` entfernt. Bildschirmfotos liegen nur lokal, nicht im Repository.

| Ansicht (Zustand)                           | 1440 | 1024 | 390 | 720 (≈ 200 % Zoom) | Hell | Horiz. Scrollen | Fokus ohne Scrollen sichtbar | Nachbarn verborgen + `inert` |
| ------------------------------------------- | ---- | ---- | --- | ------------------ | ---- | --------------- | ---------------------------- | ---------------------------- |
| Übersicht – Fokusblock (16:30)              | ✓    | ✓    | ✓   | ✓                  | ✓    | nein            | ja                           | ja                           |
| Übersicht – freie Zeit (19:35)              | ✓    | –    | ✓   | –                  | ✓    | nein            | ja                           | ja                           |
| Übersicht – Überschneidung (12:10)          | ✓    | –    | –   | –                  | –    | nein            | ja                           | ja                           |
| Übersicht – Aktivität läuft                 | ✓    | –    | ✓   | –                  | ✓    | nein            | ja                           | ja                           |
| Übersicht – „Bewegung reduzieren“           | ✓    | –    | –   | –                  | –    | nein            | ja (`data-motion=reduced`)   | ja                           |
| Übersicht – Tagesnotiz aufgeklappt/geändert | –    | –    | ✓   | –                  | ✓    | nein            | ja                           | ja                           |
| Wochenplan – Tagesnotiz gespeichert         | ✓    | ✓    | ✓   | –                  | ✓    | nein            | –                            | –                            |
| Wochenplan – anderer Tag ohne Notiz         | –    | –    | ✓   | –                  | ✓    | nein            | –                            | –                            |
| Wochenplan – Markierung „Notiz“ im Raster   | ✓    | –    | –   | –                  | –    | nein            | –                            | –                            |

In allen Aufnahmen: keine Konsolenfehler oder Hydration-Warnungen, keine Bedienelemente unter
44 px, genau ein Notiz-Editor je Seite.

**Gefunden und behoben**

| Befund                                                                                                        | Korrektur                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Wochenplan bei 390 px horizontal scrollbar (waagerechte Tagesauswahl verbreiterte die Grid-Spalte)            | `.daynotes` mit `minmax(0, 1fr)` und `min-width: 0` für die Kinder                                    |
| Tagesauswahl: Links unterstrichen, bei 390 px dreizeilig umbrochen („Mi 07.10. · heute“)                      | ohne Unterstreichung, einzeilig (`white-space: nowrap`) in der waagerechten Liste                     |
| Code-Review vor der Prüfung: Übernahme der Geräteuhr hing am Grenz-Timer und hätte sich ständig neu ausgelöst | getrennte Effekte: Uhr nur beim Laden/Tabwechsel, Grenz-Timer je Fokuszustand                         |
| Unabhängige Code-Review: Markierung „Notiz“ im Zeitraster nur ca. 36 px Trefferfläche                         | `min-height: 44px` mit negativem Rand (optisch klein); Nachmessung ohne Ausnahme: keine Ziele < 44 px |

**Nicht geprüft / Abweichungen:** Die App (M16–M20) konnte mangels Emulator/Gerät nicht visuell
geprüft werden – abgedeckt durch Komponententests (Nachbarn verborgen, automatischer Wechsel,
„Bewegung reduzieren“, Tastatur-Abstand, offline, Konflikt). Unschärfe der Nachbarn in der App nur
unter Android (React Native `filter: blur`); iOS zeigt sie nur blass und angeschnitten. Große
Systemschrift, TalkBack und Tastaturverhalten auf dem Gerät stehen in der Checkliste von
[../mobile-preview-build.md](../mobile-preview-build.md).

## Feinschliff: Fokusblock in der Kategoriefarbe des Wochenplans

Stand: 07.10.2026 abends, gleiches Verfahren (Edge headless, lokale Website und lokales Supabase,
Browser-Uhr auf 09:00, 12:10, 16:30, 19:35, 20:00 bzw. 21:15 Uhr gestellt). „Aktivität läuft“
wurde über „Aktivität Laila starten“ erzeugt und danach über „Abbrechen“ wieder verworfen.
Gemessen wurden die tatsächlich gerenderten Farben (`getComputedStyle`).

| Prüfung                                        | Ergebnis                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Fläche/Rand Fokusblock = `.wb` im Wochenraster | identisch für alle sechs Töne, dunkel und hell (z. B. Gewerbe `#3a311f` bzw. `#ece5d6`) |
| Geprüfte Zustände                              | Gewerbe (erledigt), Sport, Dienst, Termin (Überschneidung), Essen, Laila läuft, frei    |
| Laufend                                        | gleiche Fläche wie geplant, Rand im vollen Ton (1 px, keine Statusfarbe)                |
| Neutral (frei)                                 | `surface1`, gestrichelter Rand `lineStrong` – unverändert                               |
| Nachbarn                                       | eigener Ton je Block (z. B. Essen neutral davor, Sport danach)                          |
| 1440 px und 390 px, hell und dunkel            | kein horizontales Scrollen, keine Konsolenfehler                                        |
| Fokusring (per Tab)                            | 2 px `text`, ≥ 11,2 : 1 (dunkel) bzw. ≥ 13,9 : 1 (hell) zur getönten Fläche             |

Kontraste auf der Fokusfläche (kleinster Wert über alle sechs Töne, berechnet aus den Tokens;
die Browser-Messung bestätigt die Werte):

| Element                          | vorher dunkel | jetzt dunkel | vorher hell | jetzt hell |
| -------------------------------- | ------------- | ------------ | ----------- | ---------- |
| Titel, Ziffern, Fokusring        | 12,96         | 11,18        | 15,47       | 13,89      |
| Nebentext (`textMuted`)          | 7,38          | 6,37         | 8,04        | 7,22       |
| Zeile „Jetzt · …“                | 4,69          | 6,37         | 5,50        | 7,22       |
| Ziel-Chip                        | 4,52          | 6,61         | **4,17**    | 5,69       |
| Tag „Erledigt“                   | 7,49          | 8,86         | 4,97        | 5,69       |
| Rand sekundärer Knöpfe (≥ 3 : 1) | 3,07          | 4,05         | 3,51        | 4,94       |

Die kräftigere Fläche (16 % statt 9 %) senkt den Kontrast von Haupt- und Nebentext leicht, beide
bleiben deutlich über 4,5 : 1. Werte, die sonst unter ihre Schwelle gefallen wären (Zeile
„Jetzt · …“ in `textSubtle`, Chip-Text auf getöntem Chip, Knopfrand `lineStrong`), werden auf der
getönten Fläche eine Stufe kräftiger dargestellt; der Ziel-Chip im hellen Modus lag vorher bereits
unter 4,5 : 1 und erfüllt den Wert jetzt. Die App (M16/M20) nutzt dieselben Werte; mangels Gerät
nur durch Komponententests abgedeckt.

## Wochenplan schmal: Zeitraster, Scrollbereich und Vollbild

Stand: 08.10.2026, Branch `feat/design-and-focus-tracking`, Artefakt W03 (Version 33). Die
Tagesliste unter 1100 px wurde durch dasselbe Zeitraster ersetzt (Verhalten:
[UI-Spezifikation](ui-spec.md#wochenplan-auf-schmalen-bildschirmen--1100-px)).

**Automatisiert** (Edge headless über CDP, lokale Website und lokales Supabase mit Seed-Daten,
echte Mausklicks und Mausrad, keine Browser-Uhr verstellt):

| Ansicht           | Horiz. Scrollen (Seite) | Antippen: Sprung / Hash | Details danach | Vollbild füllt Fenster | Seite unter Vollbild | Uhrzeiten/Tagesköpfe fest | Beenden: Knopf / Esc / Block |
| ----------------- | ----------------------- | ----------------------- | -------------- | ---------------------- | -------------------- | ------------------------- | ---------------------------- |
| 390 × 844 dunkel  | nein                    | nein / nein             | 75 px          | ja                     | bewegt sich nicht    | ja                        | ✓ / ✓ / ✓                    |
| 390 × 844 hell    | nein                    | nein / nein             | 75 px          | ja                     | bewegt sich nicht    | ja                        | ✓ / ✓ / ✓                    |
| 844 × 390 (quer)  | nein                    | nein / nein             | 72 px          | ja, alle 7 Tage        | bewegt sich nicht    | ja                        | ✓ / ✓ / ✓                    |
| 768 × 1024 hell   | nein                    | nein / nein             | 102 px         | ja                     | bewegt sich nicht    | ja                        | ✓ / ✓ / ✓                    |
| 1440 × 900 dunkel | nein                    | nein / nein             | 24 px          | – (kein Schalter)      | –                    | –                         | –                            |

„Details danach“ = Abstand der Oberkante des Detailbereichs zum oberen Fensterrand nach dem
Antippen (schmal unterhalb der 60 px hohen Kopfzeile, bei 1440 px der rechte Seitenbereich).
Erneutes Antippen und Antippen im Vollbild landen ebenso im Blick (72–190 px). In keiner Ansicht
Konsolenfehler. Ab 1100 px bleibt das Raster unverändert; einzige Änderung dort: Statt an den
Seitenanfang zu springen, scrollt die Seite nach dem Antippen sanft zum Seitenbereich.

**Gefunden und behoben:** Bei 768 px lief die Seite um 6 px waagerecht über (Mindestspalte
92 px) – Mindestspalte auf 90 px gesenkt; danach in allen Breiten ohne Überlauf.

**Auf dem Gerät** (Android-Smartphone, Chrome, per USB mit `adb reverse` gegen die lokale Website
und das lokale Supabase; keine Produktionsverbindung): vom Benutzer bestätigt –

| Prüfung                                                                       | Ergebnis |
| ----------------------------------------------------------------------------- | -------- |
| Zeitraster statt Tagesliste, Wischen im Raster, Uhrzeiten/Tagesköpfe fest     | passt    |
| Antippen eines Blocks: kein Sprung an den Seitenanfang, Details im Blick      | passt    |
| Erneutes Antippen desselben Blocks: kein unerwarteter Sprung                  | passt    |
| Vollbild: Wischen in beide Richtungen, Seite dahinter bleibt stehen           | passt    |
| Vollbild beim Drehen zwischen Hoch- und Querformat                            | passt    |
| Beenden mit „Vollbild beenden“ und mit Android-Zurück (Seite bleibt geöffnet) | passt    |
| Block im Vollbild antippen: Vollbild endet, Details werden gezeigt            | passt    |
| Hell und Dunkel                                                               | passt    |

Bedienbarkeit des schmalen Rasters ohne Vollbild: vom Benutzer als „akzeptabel“ bewertet. Offen
(Designfrage 3 im Artefakt): beim Öffnen automatisch zum heutigen Tag bzw. zur aktuellen Uhrzeit
scrollen. Die native App (Expo) ist davon nicht betroffen; ihr Gerätetest folgt mit einem
Development Build.

## App: Abgleich mit dem Artefakt (M01–M15)

| Ansicht | Umsetzung                                                | Abweichung / Hinweis                                                                                     |
| ------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| M01     | `components/app-lock.tsx`                                | –                                                                                                        |
| M02     | `components/login-view.tsx`                              | –                                                                                                        |
| M03/M04 | `components/now-view.tsx`, `focus-timer.tsx`             | –                                                                                                        |
| M05     | `app/(tabs)/tag.tsx`, `timeline.tsx`, `session-list.tsx` | Liste „Erfasst heute“ zusätzlich unter dem Zeitstrahl (für „Zeit korrigieren“)                           |
| M06     | `app/(tabs)/woche.tsx`                                   | höchstens vier Blöcke je Tag, danach „+ n weitere“; Tippen öffnet den Tag                                |
| M07     | `app/bearbeiten.tsx`, `entry-form.tsx`                   | Uhrzeiten als Eingabefelder (HH:MM) statt ±15-Schritten – genauer und mit dem gemeinsamen Schema geprüft |
| M08     | `app/ziele.tsx`                                          | –                                                                                                        |
| M09     | `app/wochenbilanz.tsx`                                   | diese und letzte Woche; Tabelle als Kacheln (Ziel/Geplant/Erfasst/Differenz)                             |
| M10     | `app/(tabs)/einstellungen.tsx`                           | –                                                                                                        |
| M11     | `status-banner.tsx`, gesperrte Aktionen                  | –                                                                                                        |
| M12/M13 | `ui.tsx` (`Notice`), `plan-error.tsx`                    | –                                                                                                        |
| M14     | `now-view.tsx` (`SwitchSheet`)                           | –                                                                                                        |
| M15     | `app/korrigieren.tsx`                                    | Schrittweite wählbar (5 oder 15 Min.), zusätzlich „Aktivität verwerfen“                                  |

Geprüft im Code: Touch-Ziele ≥ 48 dp (Primäraktionen 56 dp), Tab-Leiste mit Symbol **und** Text,
Screenreader-Beschriftungen für alle reinen Symbolknöpfe, Rollen (`button`, `tab`, `radio`,
`timer`, `alert`), „Bewegung reduzieren“ schaltet die Sheet-Animation ab, Dunkel/Hell folgt dem
System.

**Noch manuell auf einem Gerät zu prüfen** (Checkliste in
[../mobile-preview-build.md](../mobile-preview-build.md)): tatsächliche Darstellung auf kleinen
und großen Bildschirmen, Schriftgrößen-Skalierung des Systems, TalkBack-Reihenfolge,
Gestennavigation/Safe Areas, Sperrbildschirm, neutrale Schutzfläche bzw. leere Vorschau im
App-Umschalter, Erinnerungen auf dem Sperrbildschirm.

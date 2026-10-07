# Design-Artefakt

Das Design-Artefakt wurde **vor** der Umsetzung mit der Design-Artefakt-Funktion (Artefakttyp
„Design“, Canvas mit Artboards) erstellt und ist die visuelle Grundlage dieser Phase.

- **Artefakt-Kennung:** `UAsFJjkwRVdc5qiQSAGyHg` (privat, nur für den Kontoinhaber sichtbar;
  es wurde kein Freigabelink erstellt)
- **Quelltext im Repository:** [`docs/design/artifact/`](artifact/) – identische Kopie der Artboards
  (`*.dc.html`), des gemeinsamen Stylesheets `tagestakt.css` und des Index `canvas.json`. Die
  Dateien sind nur Dokumentation; sie werden weder gebaut noch ausgeliefert.
- **Beispieldaten:** frei erfunden nach Vorgabe (Dienst Bundeswehr, Gewerbe: Kundenprojekt, Sport:
  Krafttraining, Laila: Gemeinsamer Abend, Einkaufen, Abendessen, Duschen, Freizeit) in KW 42
  (12.–18.10.2026). Das Sport-Ziel von 3 h ist **nur illustrativ**, um die Zustände zu zeigen; im
  Code startet Sport ohne Ziel. Keine Produktionsdaten, keine echten Adressen.

## Erstellte Ansichten

**Designsystem (1):** Farben, Zielfarben mit Symbolen, Status, Typografie, Abstände/Radien/Motion/
Ebenen, Aktionen, Zielzeile, Plan-vs-Ist, Timer-Leiste, Offline-Banner, helles Erscheinungsbild.

**Mobile (15, 412 × 915 dp – Samsung Galaxy S26 Ultra):**

| Nr. | Ansicht                                   | Nr. | Ansicht                                     |
| --- | ----------------------------------------- | --- | ------------------------------------------- |
| M01 | App-Sperre / biometrisches Entsperren     | M09 | Wochenbilanz (abgeschlossene KW 41)         |
| M02 | Login (mit Fehlermeldung)                 | M10 | Mehr: Ziele, Erinnerungen, App-Sperre       |
| M03 | Jetzt ohne laufende Aktivität             | M11 | Offline (laufender Timer, Beenden gesperrt) |
| M04 | Jetzt mit laufendem Timer                 | M12 | Leerer Wochenplan                           |
| M05 | Tag mit Zeitstrahl, Jetzt-Linie, Ist-Chip | M13 | Fehlerzustand ohne Cache                    |
| M06 | Woche (Ziele kompakt + sieben Tage)       | M14 | Bestätigung beim Wechseln der Aktivität     |
| M07 | Plan bearbeiten – Block-Sheet im Entwurf  | M15 | Zeit korrigieren (vergessene Aktivität)     |
| M08 | Ziele Gewerbe / Sport / Laila             |     |                                             |

**Web (10):** W01 Übersicht · W02 Wocheneditor Desktop (Zeitraster, Entwurf, Überschneidung) ·
W03 Wocheneditor schmal (390 px) · W04 Planblock bearbeiten (Seitenbereich, Verschieben, Rückgängig) ·
W05 Wiederholungen (Wochenstruktur, Mehrfach-Wochentage) · W06 Ziel- und Zeitauswertung ·
W07 Einstellungen · W08 Login · W09 Leerer Zustand · W10 Fehler/Offline.

### Erweiterung: Fokusfläche und Tagesnotiz (Artefakt-Version 29)

Vor der Umsetzung ergänzt (gleiche Kennung, gleiche Beispielwoche KW 42, Mittwoch 14.10.2026).
Mobbin wurde dafür **nicht** erneut abgefragt; als abstrakte Referenz dienten die Muster aus
[mobbin-research.md](mobbin-research.md) (Agenda mit aktuellem Eintrag, Fokus-Timer, schlichtes
Notizfeld) – keine Bildschirme wurden nachgebaut.

| Nr. | Ansicht                                                                                                     | Datei                           |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- |
| W11 | Übersicht: Fokusblock mittig, Dienst davor und Abendessen danach unscharf                                   | `w11-fokus.dc.html`             |
| W12 | Übersicht: freie Zeit („Freie Zeit“, Countdown, Als Nächstes)                                               | `w12-fokus-frei.dc.html`        |
| W13 | Übersicht: laufende Aktivität hat Vorrang                                                                   | `w13-fokus-laeuft.dc.html`      |
| W14 | Fokus-Zustände: vor dem ersten / nach dem letzten Block, Block ohne Ziel, Überschneidung, kein Plan, Fehler | `w14-fokus-zustaende.dc.html`   |
| W15 | Tagesnotiz: leer, geändert, speichert, gespeichert, Speicherfehler, Konflikt                                | `w15-tagesnotiz.dc.html`        |
| W16 | Wochenplan mit Notiz-Markierungen und Abschnitt „Tagesnotiz“ (Tagesauswahl + ein Editor)                    | `w16-wochenplan-notiz.dc.html`  |
| W17 | Übersicht bei 390 px                                                                                        | `w17-uebersicht-schmal.dc.html` |
| W18 | Übersicht hell                                                                                              | `w18-uebersicht-hell.dc.html`   |
| M16 | Jetzt: Fokusblock mit Nachbarn, kompakter Notizzugang                                                       | `m16-jetzt-fokus.dc.html`       |
| M17 | Tag mit Tagesnotiz (Vorschau, „Notiz bearbeiten“)                                                           | `m17-tag-notiz.dc.html`         |
| M18 | Tagesnotiz mit geöffneter Tastatur (Tastaturfläche nur als beschrifteter Platzhalter)                       | `m18-notiz-tastatur.dc.html`    |
| M19 | Tag offline: Notiz nicht verfügbar, nichts vorgetäuscht                                                     | `m19-notiz-offline.dc.html`     |
| M20 | Jetzt hell mit laufender Aktivität                                                                          | `m20-jetzt-hell.dc.html`        |

**Feinschliff Kategoriefarbe (Artefakt-Version 31):** Der Fokusblock in W11, W13, W14, W17,
W18, M16 und M20 nutzt jetzt dieselbe Fläche und denselben Rand wie der Planblock im
Wochenraster (`.focus` in `tagestakt.css`: Ton 16 % in `s1`, Rand 45 %; laufend nur der Rand im
vollen Ton). Die Zeile „Jetzt · …“ ist nicht mehr kategoriefarbig, sondern `text-2` – wie im Code.

Notizen im Artefakt sind erfundene Beispieltexte („… (Beispiel)“). Die Haftnotizen
`fokusUebergang` und `notizMobileHinweis` in `canvas.json` beschreiben Übergang und
mobile Besonderheiten.

## Zentrale Layoutentscheidungen

1. **Jetzt-Fläche statt Kartenraster.** Oben genau eine Aussage (aktueller Block oder laufende
   Aktivität) mit einer großen Zahl und einer Primäraktion; „Als Nächstes“ und Ziele darunter.
2. **Plan = Umriss/Tönung, Ist = gefüllt.** Planblöcke sind getönt mit Rahmen, erfasste Zeit ist
   eine gefüllte Fläche/Chip. In Zielbalken: gestrichelt = geplant, gefüllt = erfasst, Strich = Ziel.
3. **Zielzeilen statt Ringe.** Drei gleich aufgebaute Zeilen sind vergleichbar und barrierearm.
4. **Primäraktionen im Daumenbereich** (Mobile) und invertierter Primärknopf (helles Feld auf
   dunklem Grund) als einziges stark kontrastiertes Element.
5. **Timer nur einmal groß.** Überall sonst kompakte Timer-Leiste (Mobile) bzw. Seitenleisten-Karte (Web).
6. **Web als Planungstisch:** Seitenleiste + breite Arbeitsfläche, Zeitraster nur auf breiten
   Bildschirmen, schmal eine Tagesliste.
7. **Fokusfläche wie ein Kalenderausschnitt:** Der aktuelle Block groß und scharf, Nachbarn klein,
   unscharf und angeschnitten (nur Dekoration). Wechsel an der Blockgrenze ruhig eingeblendet,
   bei „Bewegung reduzieren“ ohne Bewegung.
8. **Tagesnotiz zurückhaltend:** auf der Übersicht bzw. „Jetzt“ nur eine Zeile, im Wochenplan
   genau ein Editor mit Tagesauswahl, in der App „Tag“ eine Vorschau und ein eigener
   Editor-Bildschirm.

## Navigationsmodell

- **Mobile:** vier Tabs (Jetzt, Tag, Woche, Mehr) mit Icon und Text. Ziele, Wochenbilanz, Plan
  bearbeiten und Zeit korrigieren sind Stapel-Ansichten bzw. Sheets – keine weiteren Tabs.
- **Web:** Seitenleiste (≥ 1024 px) mit fünf Zielen inkl. neuer Seite **Auswertung**; darunter
  Kopfzeile mit Menü-Ausklapper. Alle Wechsel sind echte Links (funktionieren ohne JavaScript).

## Verwendete Komponenten (Artefakt → Code)

| Artefakt              | Web (`apps/web/src/components`)                                                            | Mobile (`apps/mobile/src/components`)  |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| Fokusfläche           | `focus-stage.tsx` (Minutentakt: `use-clock.tsx`)                                           | `now-view.tsx`                         |
| Tagesnotiz            | `daily-note-editor.tsx`, `today-note.tsx`, `day-notes.tsx`                                 | `note-editor.tsx`, `note-card.tsx`     |
| Timer (Ziffern)       | `live-timer.tsx`                                                                           | `focus-timer.tsx`                      |
| Timer-Leiste/-Karte   | `active-session.tsx` (`ActiveSessionCard`)                                                 | `timer-bar.tsx`                        |
| Zielzeile/-balken     | `goal-progress.tsx`                                                                        | `goal-progress.tsx`                    |
| Status-Chip           | `goal-progress.tsx` (`GoalStatusChip`)                                                     | `goal-progress.tsx` (`GoalStatusChip`) |
| Planblock/Zeitstrahl  | `week-grid.tsx`, `day-list.tsx`, `entry-details.tsx`, `entry-editor.tsx`, `entry-form.tsx` | `timeline.tsx`, `session-list.tsx`     |
| Banner/Offline/Fehler | `notice.tsx` (`Notice`)                                                                    | `status-banner.tsx`, `plan-error.tsx`  |
| Sheet/Dialog          | native `<dialog>`-freie Formulare + Bestätigung                                            | `sheet.tsx`, System-Dialog (`Alert`)   |
| Kategorie             | `category-badge.tsx`                                                                       | `ui.tsx` (`CategoryPill`)              |
| Marke                 | `brand.tsx`                                                                                | `brand.tsx`                            |

## Unterschiede Mobile und Web

| Thema        | Mobile                                    | Web                                           |
| ------------ | ----------------------------------------- | --------------------------------------------- |
| Zweck        | Alltag: Was jetzt? Starten/Beenden        | Planen, Verwalten, Auswerten                  |
| Woche        | gestapelte Tage, keine Rasteransicht      | Zeitraster (breit) bzw. Tagesliste (schmal)   |
| Bearbeiten   | ausdrücklicher Modus, Sheet, ±15-Schritte | Seitenbereich/Formular, ±15/±30, Rückgängig   |
| Timer        | groß auf Jetzt, Leiste auf anderen Tabs   | groß auf Übersicht, Karte in der Seitenleiste |
| Schrift      | Systemschrift                             | Geist (selbst gehostet)                       |
| Biometrie    | App-Sperre lokal                          | nur Hinweis in Einstellungen                  |
| Erinnerungen | lokal ausgelöst, Gerät schaltet ein       | Einstellungen (Vorlauf, Umfang) für die App   |

## Offene Designfragen

1. **Bezeichnung „Laila“** ist als Zielname im Code hinterlegt (Vorgabe). Soll der Name später
   konfigurierbar sein (Einstellung statt Konstante)?
2. **Sport- und Laila-Ziel**: Zielwerte legt der Benutzer fest; das Artefakt zeigt 3 h nur als Beispiel.
3. **Wochenraster auf dem Tablet** (768–1099 px): derzeit Tagesliste; ein 3-Tage-Raster wäre denkbar.
4. **App-Icon und Splash** sind nicht Teil dieser Phase (Expo-Standard bleibt).
5. **Haptik** beim Starten/Beenden (expo-haptics) bewusst nicht eingebaut – keine zusätzliche
   Abhängigkeit ohne Gerätetest.

## Übertragung in Produktionscode

- Farben, Abstände, Radien, Typografie und Motion wurden 1 : 1 als Tokens in
  `packages/design-tokens` übernommen; das Artefakt-Stylesheet `tagestakt.css` diente als Vorlage
  für `apps/web/src/app/globals.css`.
- Die Zielberechnungen (Ziel/geplant/erfasst/Status/Satz) stammen nicht aus dem Artefakt, sondern
  aus `packages/schedule-schema/src/goals.ts`; die im Artefakt gezeigten Zahlen sind konsistent
  mit dieser Logik berechnet.
- Abweichungen und deren Gründe stehen in [visual-qa.md](visual-qa.md).

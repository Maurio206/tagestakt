# Mobbin-Recherche (Phase 2)

Stand: 07.10.2026 · Branch `feat/design-and-focus-tracking`

## Werkzeug und Einschränkungen

- **Mobbin MCP wurde verwendet** (Werkzeuge `search_screens` und `search_flows` der
  Mobbin-Agent-Integration). Alle unten genannten Beobachtungen beruhen auf den tatsächlich
  zurückgegebenen Vorschaubildern; es werden keine Screens beschrieben, die nicht angesehen wurden.
- Die Integration bietet nur die Plattformen **iOS** und **Web**. Android-Screens waren nicht
  abrufbar. Die Muster wurden deshalb abstrahiert und auf Android (Samsung Galaxy S26 Ultra,
  Gestennavigation, Material-Systemdialoge für Biometrie und Benachrichtigungen) übertragen.
- Nicht in den Ergebnissen enthalten waren **Sunsama, Routine, TickTick und Apple Calendar**
  (eine gezielte Suche nach Sunsama lieferte nur fremde Produkte). Rise und Motion lagen nur als
  Web-Screens vor. Diese Produkte fließen daher **nicht** in die Bewertung ein.
- Es wurden **keine Screenshots** heruntergeladen oder ins Repository übernommen. Links verweisen
  auf die Mobbin-Seiten (Zugang über ein Mobbin-Konto).

## Untersuchte Suchbegriffe und Flows

| #   | Plattform | Anfrage (sinngemäß)                                                 | Typ    |
| --- | --------- | ------------------------------------------------------------------- | ------ |
| 1   | iOS       | Tageszeitstrahl mit aktuellem Block, Restzeit und nächstem Block    | Screen |
| 2   | iOS       | Laufender Timer mit großer Dauer, Projekt und Stopp                 | Screen |
| 3   | iOS       | Zeiterfassung mit dauerhaftem Timer und Tagesliste                  | Screen |
| 4   | iOS       | Wochenbilanz geplant vs. tatsächlich je Kategorie                   | Screen |
| 5   | iOS       | Mehrere Wochenziele mit Stunden und Fortschritt                     | Screen |
| 6   | iOS       | Termin bearbeiten (Bottom Sheet, Datum, Beginn, Ende, Löschen)      | Screen |
| 7   | iOS       | Gesperrte App mit biometrischem Entsperren                          | Screen |
| 8   | iOS       | Erklärung vor der Benachrichtigungsberechtigung                     | Screen |
| 9   | iOS       | Leerer Tag im Planer mit Handlungsaufforderung                      | Screen |
| 10  | iOS       | Offline-Hinweis bei zwischengespeicherten Inhalten                  | Screen |
| 11  | iOS       | Einstellungen mit Erinnerungen, App-Sperre und Konto                | Screen |
| 12  | iOS       | Bestätigungsdialog beim Beenden/Wechseln eines laufenden Timers     | Screen |
| 13  | Web       | Wochenkalender mit Zeitraster und farbigen Blöcken                  | Screen |
| 14  | Web       | Tagesübersicht mit aktuellem Block und Wochenzielen                 | Screen |
| 15  | Web       | Zeitauswertung Ziel vs. tatsächlich je Projekt/Woche                | Screen |
| 16  | Web       | Seitenpanel zum Bearbeiten/Verschieben eines Termins                | Screen |
| 17  | Web       | Schlichte Anmeldung (E-Mail/Passwort, dunkel, ohne Registrierung)   | Screen |
| 18  | iOS       | Timer starten, laufen lassen, beenden, Startzeit korrigieren        | Flow   |
| 19  | iOS       | Geplante Aufgabe im Tagesverlauf verschieben                        | Flow   |
| 20  | Web/iOS   | Wochenrückblick (Sunsama), Terminliste nach Tagen (Google Calendar) | Screen |

Abgedeckte Themen: daily planner, calendar, schedule, time blocking, focus timer, active task,
time tracking, habit/goal progress, weekly review, rescheduling, task editing, adding/creating,
starting/completing, bottom navigation, offline state, empty state, notification permission,
biometric unlock, mobile settings, responsive planning dashboard.

## Referenzprodukte (mit Links)

**Planung und Zeitstrahl**

- Structured – Zeitstrahl mit Restzeit ([Timeline](https://mobbin.com/screens/bacda7ff-814b-4309-9f7c-a3418bc0097f)),
  Fokusansicht ([Fokus](https://mobbin.com/screens/f724a5db-76fd-4df5-92e6-88ab2a51ebb9)),
  leerer Tag ([Leer](https://mobbin.com/screens/695f113a-1a76-475e-b842-e1af200dd026)),
  [Replan-Flow](https://mobbin.com/flows/c08df7ea-f2a5-4065-a516-6a10ce4d2c50)
- Tiimo – Fokus mit Start→Ende ([Fokus](https://mobbin.com/screens/c3fc7fe3-d701-4586-9748-9746be5d6864)),
  [Aufgabe bearbeiten/verschieben](https://mobbin.com/flows/c4670a2d-bcbc-4e88-8e4c-7b8d1ff6e0a6)
- Google Calendar – Terminliste nach Tagen ([Schedule](https://mobbin.com/screens/e528a0cc-8cbe-44ed-aa7a-4d9fca8a41f8)),
  Wochenraster auf dem Telefon ([Woche](https://mobbin.com/screens/caff1859-540c-4786-ab12-094d4f81ee4f))
- Todoist – Datum/Zeit-Sheet ([Datum](https://mobbin.com/screens/5b3577eb-da7d-4af5-81a7-b7a99c7cc18a)),
  Wochenziel ([Ziel](https://mobbin.com/screens/e9a360e1-5dc6-4efd-a0dd-d9de9ee94a9f)),
  3-Tage-Raster ([Raster](https://mobbin.com/screens/d47e73a3-2711-4811-b66f-616f1c905bf3))
- Microsoft Outlook – Tagesraster mit Jetzt-Linie ([Tag](https://mobbin.com/screens/435d3aa8-4ff8-4bbb-9e9a-aa1a8852200f)),
  Termin bearbeiten mit Dauer ([Bearbeiten](https://mobbin.com/screens/43702e58-f7d4-4037-9e3a-128f9bca825a))
- Meetup – Beginn/Ende als verbundene Zeilen ([Event](https://mobbin.com/screens/b859877e-d77f-404f-a784-5aa6f1adffaa))

**Zeiterfassung und Fokus**

- Toggl Track – Timer-Liste nach Tagen ([Liste](https://mobbin.com/screens/7a68e997-fa3b-4248-a9a6-b464c21bf698)),
  Eintrag bearbeiten während er läuft ([Edit](https://mobbin.com/screens/76058f53-16c1-4715-a151-0c828e68e645)),
  Kalender mit erfassten Blöcken ([Kalender](https://mobbin.com/screens/9524e697-5c57-41f0-b5d8-f38702577790)),
  [Tracking-Flow](https://mobbin.com/flows/49b389d9-e7bc-4410-83d8-7aa9db7a4885),
  Web-Woche mit Tagessummen ([Web](https://mobbin.com/screens/ec591d9c-1442-4ee2-bf55-5773d17397a9)),
  Auswertung ([Report](https://mobbin.com/screens/6ae9039f-9114-4f99-922f-b000cd0c46ea))
- Jobber – [Einstempeln](https://mobbin.com/flows/2d6487e3-1fee-461d-9745-e6d287347359) und
  [Zeiteintrag bearbeiten](https://mobbin.com/flows/a3b74781-4288-4f8d-ae44-f1efc19f8be9)
- ClickUp – Timer in der Kopfzeile ([Timer](https://mobbin.com/screens/7fca930c-6a9f-4373-a704-f5af8b4807c2)),
  Timesheet „3h / 0h“ je Tag ([Timesheet](https://mobbin.com/screens/2ed8379c-f517-49fc-bbd8-7b042c1567a6))
- Workable – „Clocked in“-Leiste mit Rückgängig ([Dashboard](https://mobbin.com/screens/e84f64f8-40cc-4bd9-a68e-519e9cef2707))
- Waking Up – „Timer endet um …“ ([Timer](https://mobbin.com/screens/c07eb338-1b01-402f-9819-95e86a9cc377))
- Apple Fitness – kompakte Steuerleiste über dem Inhalt ([Workout](https://mobbin.com/screens/40e562c3-6597-49d2-b326-47038e1e0d49))
- Oura – „Sitzung früher beenden? Daten bleiben gespeichert.“ ([Dialog](https://mobbin.com/screens/f1710168-6e23-4630-a5af-30cca7da067e))

**Auswertung und Ziele**

- Asana – geschätzt vs. tatsächlich ([Report](https://mobbin.com/screens/ac55941d-fef9-4254-9997-bc5e229aad61)),
  Status „On Track“ ([Ziel](https://mobbin.com/screens/8d858b4a-9f60-465b-9419-87407c782feb))
- 7shifts – „Actual Hrs“, „Sched. Hrs“, „Variance“ ([Timesheet](https://mobbin.com/screens/2f59a1e7-5e9e-4fd8-a845-4c5d2d9f8f59))
- Brick – große Wochenzahl + Vergleich zur Vorwoche ([Aktivität](https://mobbin.com/screens/cf442781-3a85-4de9-8c0b-2a169eec4767))
- Eight Sleep – „im Zielbereich (±30 min)“ mit Zielband ([Schedule](https://mobbin.com/screens/d1379400-dfe1-489b-8522-b513131756b3))
- The Outsiders – Zeilen mit Balken, Prozent, Dauer ([Fokus](https://mobbin.com/screens/75db909e-4ab8-4c4d-b94d-120b68cf4f3d))
- Runna – Wochen mit „5/6“ und segmentiertem Fortschritt ([Plan](https://mobbin.com/screens/9eb278de-d059-4726-b181-8ec7d161ba4c))

**Web-Planung**

- Rise – dunkler Wochenkalender, Jetzt-Linie mit Uhrzeit ([Woche](https://mobbin.com/screens/8bbf95a5-ec7b-4cc2-85b7-6260e3bbc3e5)),
  Seitenpanel mit Beginn → Ende und „Reschedule“ ([Panel](https://mobbin.com/screens/8d92b21d-b7ca-43e3-a436-ae61f706229f))
- Motion – Woche mit Agenda-Spalte ([Kalender](https://mobbin.com/screens/fc1d5295-1623-4dac-bcfd-736d713a284a))
- Clockwise – gestrichelte, flexible Blöcke ([Kalender](https://mobbin.com/screens/c6dbfcf9-74eb-4741-aa55-193a0b693151))
- Midday – Zeitspanne mit Dauer „0h 50min“ ([Panel](https://mobbin.com/screens/96f1053c-c00f-4ecc-8d4f-299488faf2cc))
- Calendly – „Up next“ mit Verschieben/Absagen ([Panel](https://mobbin.com/screens/0fcf29aa-9656-4acc-a2e1-0f324b64dd84))
- Savee, Posh, Hex – schlichte dunkle Anmeldung ([Savee](https://mobbin.com/screens/b17367af-ef7c-4416-89a0-6afb7dcea163),
  [Posh](https://mobbin.com/screens/54097095-814f-4a6b-a56b-fc65ce0f927f),
  [Hex](https://mobbin.com/screens/e5b787fe-b999-45f1-8550-643d97c738ae))
- Wrike – Widget-Dashboard ([Dashboard](https://mobbin.com/screens/26ded28b-1313-4eee-b493-0ed5624513a1)) – bewusst als Gegenbeispiel

**Systemzustände**

- Apple Photos / Google Photos – gesperrter Inhalt mit einer Entsperr-Aktion
  ([Photos](https://mobbin.com/screens/01f45e7a-2178-4ecf-9f80-8a8fc6a56bbf),
  [Google Photos](https://mobbin.com/screens/fcd75ad4-24d9-49af-a3e3-c1edf8fb746c)),
  Dave – Biometrie plus Ausweichweg ([Dave](https://mobbin.com/screens/147415dd-1ea1-4b34-b51e-59d6836be5c2))
- Tempo – Erinnerungsprinzip „1 h vorher und 15 min vorher“ vor dem Systemdialog
  ([Tempo](https://mobbin.com/screens/28a98c51-2efc-4489-8d14-2f31cd4db383)),
  Givingli – „jederzeit in den Einstellungen änderbar“ ([Givingli](https://mobbin.com/screens/502f2a58-a768-4285-8fdb-8a94a165103f))
- Alta – Offline-Hinweis mit Folge („nichts kann gesendet werden“) ([Alta](https://mobbin.com/screens/2b00c4b9-d2a6-4a6a-9d95-2aba49348be1)),
  Grab Driver – „Du bist offline.“ als Statuszeile ([Grab](https://mobbin.com/screens/e604bf5f-cefb-4720-8cce-50cdbd5d9b37))
- Liven, Jira – leere Zustände mit einer Aktion ([Liven](https://mobbin.com/screens/8c1170b5-7b82-49e9-9683-7c239f9322b6))
- Mimo, Skillshare, Blinkist – gruppierte Einstellungen, Gefahrenzone am Ende
  ([Mimo](https://mobbin.com/screens/bfee415b-e542-45e9-bb43-01735b0074d9),
  [Skillshare](https://mobbin.com/screens/be442e2a-0fd8-4fd0-8db4-f8aa97aad901))

## Erkannte UX-Muster

1. **Eine Hauptaussage oben, Rest darunter.** Structured, Tiimo und Waking Up zeigen den aktuellen
   Block mit Zeitspanne und _einer_ großen Zahl (Rest- oder Laufzeit). Alles andere ist kleiner.
2. **Laufender Timer als ruhige, dauerhafte Leiste.** Toggl (Eingabeleiste über der Tab-Bar),
   ClickUp (Kopfzeile), Workable („Clocked in“ mit Rückgängig) und Apple Fitness (Steuerleiste)
   halten den laufenden Timer sichtbar, ohne jede Seite zu übernehmen.
3. **Plan und Ist in getrennten Spalten.** 7shifts („Sched. Hrs“ / „Actual Hrs“ / „Variance“),
   Asana (geschätzt vs. tatsächlich als Nachbarbalken) und ClickUp („3h / 0h“ je Tag) mischen
   beide Werte nie in einer Zahl.
4. **Bearbeiten über Start-/Endzeilen mit Dauer.** Toggl, Jobber, Outlook und Midday zeigen
   Beginn und Ende als zwei Zeilen und die Dauer daneben; „Laufender Eintrag“ bleibt erkennbar.
5. **Nachträgliches Erfassen ist ein normaler Weg** (Toggl „retroaktiv eintragen“, Jobber
   „Edit time entry“), keine Fehlerkorrektur zweiter Klasse.
6. **Wochenbilanz = große Zahl + sachlicher Vergleich + Zeilen.** Brick („12 % weniger als
   Vorwoche“), The Outsiders (Balken + Prozent + Dauer), Eight Sleep („im Zielbereich“).
7. **Zielstatus als Wort mit Punkt** (Asana „On Track“) statt nur als Farbe.
8. **Telefon zeigt Listen statt Wochenraster.** Google Calendars 7-Tage-Raster auf dem Telefon
   schneidet Titel ab („Fee d the“), die Terminliste nach Tagen bleibt lesbar.
9. **Lücken sind Information.** Structured beschriftet freie Zeit zwischen Blöcken; Google
   Calendar zeigt „Nichts geplant“ direkt im Tagesverlauf.
10. **Kontextmenü pro Block** (Tiimo: Kopie, Verschieben, Auf morgen, Starten, Bearbeiten,
    Löschen – Löschen zuletzt und rot).
11. **Gesperrter Zustand verrät nichts.** Google Photos zeigt nur Symbol und „Mit Face ID öffnen“;
    Dave bietet einen klaren Ausweichweg.
12. **Berechtigungen im Kontext und konkret.** Tempo erklärt genau, _wann_ erinnert wird, bevor
    der Systemdialog erscheint; Givingli sagt, dass es später änderbar ist.
13. **Offline-Hinweis nennt die Folge** (Alta: „nichts kann gesendet werden“), nicht nur den
    Zustand.
14. **Web-Woche: Jetzt-Linie mit Uhrzeit, Tagessummen im Kopf, Seitenpanel zum Bearbeiten**
    (Rise, Toggl Web, Motion, Calendly).
15. **Schlichte Anmeldung:** zentrierte, schmale Spalte, kleines Zeichen, ein heller
    Primärknopf auf dunklem Grund (Savee, Posh).

## Antworten auf die Leitfragen

**1. „Was mache ich jetzt?“ in unter zwei Sekunden.** Ein einziger, großer Block oben:
Titel, Kategorie, „noch 1 Std. 20 Min.“ und genau eine Primäraktion (Structured, Tiimo).
„Als Nächstes“ steht direkt darunter, deutlich kleiner. Uhrzeit und Datum sind sekundär.
→ TagesTakt: „Jetzt“-Fläche mit Zielfarbe am Rand, Restzeit groß in tabellarischen Ziffern,
ein Knopf „Fokus starten“.

**2. Laufender Timer ohne Überladung.** Der Timer wird zur dauerhaften, schmalen Leiste
(Toggl, ClickUp, Workable, Apple Fitness); nur auf der Jetzt-Ansicht ist er groß.
→ TagesTakt: große Laufzeit nur in „Jetzt“; überall sonst eine kompakte Timer-Leiste über
der Tab-Bar (Mobile) bzw. in der Seitenleiste (Web). Nur die Ziffern aktualisieren sich.

**3. Geplant vs. tatsächlich.** Getrennte Spalten und Begriffe (7shifts, Asana, ClickUp
„erfasst / erwartet“). Nie eine Mischzahl.
→ TagesTakt: in jeder Zielzeile die drei Werte „Ziel · geplant · erfasst“; im Zeitstrahl
sind erfasste Zeiten als eigene Spur dargestellt, nicht als eingefärbte Planblöcke.

**4. Starten, Beenden, Korrigieren.** Ein Knopf wechselt zwischen Starten und Beenden
(Jobber, Toggl). Korrektur über „Beginn/Ende/Dauer“-Zeilen, auch bei laufendem Eintrag
(Toggl „Time entry is running… Stop Timer“).
→ TagesTakt: „Fokus starten“ / „Beenden“; „Zeit korrigieren“ als ruhiger Sekundärlink.
Pausieren wird **nicht** modelliert (eine Sitzung = ein durchgehender Zeitraum); stattdessen
beenden und neu starten.

**5. Wochenbilanz verständlich.** Eine Kernaussage je Ziel, Zeilen mit Balken und Zahlen,
ein sachlicher Satz (Brick, The Outsiders, Eight Sleep „im Zielbereich“).
→ TagesTakt: pro Ziel eine Zeile mit Balken (erfasst), Markierung (geplant) und Zielstrich,
dazu ein Statuswort und ein Satz wie „Dir fehlen noch 3 h Gewerbe.“

**6. Drei Lebensziele vergleichen.** Gleich aufgebaute, gestapelte Zeilen mit identischer
Skala je Ziel (The Outsiders) sind besser vergleichbar als drei Ringe oder Karten.
→ TagesTakt: drei Zeilen untereinander, jeweils relativ zum eigenen Ziel; ohne Ziel wird
die Zeile neutral mit „Ziel noch festlegen“ gezeigt.

**7. Terminänderungen mobil, sicher und schnell.** Kontextmenü pro Block (Tiimo), Bottom Sheet
mit Beginn/Ende-Zeilen (Outlook, Meetup), Schnellauswahl (Todoist „Heute/Morgen“), Löschen
zuletzt und farblich abgesetzt.
→ TagesTakt: Bearbeiten nur im ausdrücklichen Modus „Plan bearbeiten“; Zeitänderungen über
±5/±15-Minuten-Schritte und direkte Eingabe; Bestätigung vor dem Veröffentlichen.

**8. Leere, Offline- und Fehlerzustände.** Leer: ein Satz + eine Aktion (Liven, Jira, Google
Calendar „Nichts geplant“). Offline: Zustand + Folge (Alta) + Zeitpunkt der letzten
Aktualisierung. Fehler: verständliche Ursache und „Erneut versuchen“.
→ TagesTakt: alle drei Zustände als eigene Komponenten mit Symbol, Satz und höchstens einer Aktion.

**9. Einhändige Android-Navigation.** Vier beschriftete Tabs unten (Structured, Tiimo, Todoist);
Primäraktionen im unteren Drittel (Strava, Runna „Pause“ unten). Icon-only-Tabs (Toggl) sind
weniger verständlich.
→ TagesTakt: vier Tabs „Jetzt · Tag · Woche · Mehr“ mit Icon **und** Text; Start/Beenden im
Daumenbereich; keine fünfte Schaltfläche.

**10. Kein generisches „Dashboard voller Karten“.** Das Wrike-Widget-Dashboard zeigt das
Problem: gleich gewichtete Kästen ohne Hierarchie. Gute Planer (Structured, Superlist, Rise)
arbeiten mit einer klaren Hauptfläche, Linien, Typografie und Abstand statt Kartenrastern.
→ TagesTakt: eine Hauptfläche, Abschnitte mit feinen Trennlinien und Überschriften, Karten
nur für interaktive Einheiten (z. B. ein Planblock).

## Übernommene abstrakte Prinzipien

1. Eine Hauptaussage pro Ansicht, alles andere ordnet sich unter.
2. Laufende Zeit dauerhaft sichtbar, aber nur an einer Stelle groß.
3. Ziel, Plan und Ist getrennt benannt und getrennt dargestellt.
4. Korrigieren ist ein normaler, ruhiger Weg – kein Fehlerdialog.
5. Status immer als Wort + Form/Symbol, Farbe nur zusätzlich.
6. Listen statt Raster auf dem Telefon; Raster auf breiten Bildschirmen.
7. Freie Zeit und leere Tage sind beschriftete Zustände.
8. Gesperrt bedeutet: nichts Privates sichtbar, eine Entsperr-Aktion, ein Ausweichweg.
9. Berechtigungen nur im Kontext, mit konkreter Erklärung und „später“-Option.
10. Offline-Hinweise nennen Stand und Folgen.

## Bewusst nicht übernommene Muster

- **Gamification mit Schuld oder Druck:** Forest („verwelkter Baum“), Opal („Gib nicht auf“,
  „Halten zum Verlassen“), Streaks und Maskottchen (Finch, QUITTR, adidas). Widerspricht
  „keine manipulative Gamification, kein Shaming“.
- **Atmosphärische Vollbild-Hintergründe** (Life Reset, TIDE, Waking Up): schöner Effekt, aber
  geringer Kontrast und keine Information.
- **Fortschrittsringe für mehrere Ziele** (Blinkist, adidas): schwer vergleichbar und schlecht
  lesbar bei drei Zielen; stattdessen Zeilen.
- **Wochenraster auf dem Telefon** (Google Calendar Woche): abgeschnittene Titel.
- **Widget-Dashboards** (Wrike): fehlende Hierarchie.
- **Wischgesten als einziger Weg** (Structured Replan): nicht auffindbar und schwer zugänglich;
  bei TagesTakt höchstens zusätzlich, nie allein.
- **Pomodoro-/Countdown-Logik** (Tiimo, Me+): TagesTakt misst tatsächliche Zeit, keine
  vorgegebenen Intervalle.
- **„Clock in/out“-Begriffe** (Jobber, Workable): werden mit dem Benutzer-Login verwechselt;
  TagesTakt sagt „Fokus starten“ / „Beenden“.
- **Marken, Illustrationen, Farben oder Texte** einzelner Produkte – nichts davon wird kopiert.

## Warum das zu TagesTakt passt

TagesTakt ist ein privates Werkzeug für genau eine Person mit drei parallelen Lebenszielen und
festen Dienstzeiten. Es braucht schnelle Orientierung im Alltag („Was jetzt?“), ehrliche Zahlen
(geplant ≠ erfasst) und Ruhe statt Motivationstricks. Die übernommenen Prinzipien zielen genau
darauf: eine klare Hauptaussage, sachliche Bilanz, einhändige Bedienung auf einem großen
Android-Gerät und ein Web-Werkzeug, das wie ein präziser Planungstisch wirkt – nicht wie ein
Dashboard. Die daraus entwickelte, eigenständige Gestaltung beschreiben
[design-system.md](design-system.md) und [ui-spec.md](ui-spec.md).

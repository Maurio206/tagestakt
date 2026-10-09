# Startbildschirm-Widget „Jetzt und danach“ (Android)

Natives, größenveränderbares AppWidget im TagesTakt-Design: zeigt den **aktuellen** und den
**nächsten** Block des veröffentlichten Wochenplans. Antippen öffnet TagesTakt in „Jetzt“.
Eingeführt mit `versionCode` 4 (09.10.2026).

## Gestaltung

| Element         | Umsetzung                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Größe           | Standard 4 × 2, mindestens 3 × 2 (`minWidth` 250 dp, `minResizeWidth` 180 dp, Höhe 110 dp), frei skalierbar                                          |
| Fläche          | Anthrazit `bg` `#121110`, Haarlinie `line`, Radius des Launchers (Android 12+) bzw. 16 dp                                                            |
| Kopf            | Logo „Fokusstapel“ (Vektor aus dem Master-SVG) und „Jetzt“                                                                                           |
| Aktueller Block | Fläche, Rand und Akzentkante wie der Fokusblock (`blockColors(dark, Ton, "strong")`), darüber Kategorie · Zeit, darunter der Titel (bis zwei Zeilen) |
| Freie Zeit      | gestrichelter, neutraler Rahmen: „Freie Zeit“, „bis 14:00“ bzw. „Heute nichts mehr geplant“                                                          |
| Nächster Block  | Punkt im Kategorieton, „Danach“, Uhrzeit („14:00“, „morgen 07:00“, „Do 15.10. 07:00“), Titel · Kategorie                                             |
| Leer / neutral  | Logo groß, „Kein aktueller Wochenplan“ · „Plan nicht aktuell“ · „Nicht angemeldet“, darunter „TagesTakt öffnen“ (Gold)                               |

Kategorien stehen immer als Text **und** als zurückhaltende Farbe. Die Fläche ist deckend und
dunkel, daher auf hellen wie dunklen Hintergründen des Launchers gleich gut lesbar. Texte in sp
(Systemschriftgröße), Bedienungshilfen lesen eine Zusammenfassung („Jetzt: …, 09:00 bis 11:00.
Danach: 11:30 …“). Das ganze Widget ist die Tippfläche. Die Vorschau in der Widget-Auswahl zeigt
frei erfundene Beispielinhalte.

## Datenfluss

1. Die App lädt den Plan wie bisher (`fetchPlanSnapshot` → Plan-Cache, nur veröffentlichte
   Wochen, ohne Notizen). Es gibt **keine zweite Datenquelle** und keinen Netzwerkzugriff aus
   dem Widget.
2. `useWidgetSync` berechnet daraus mit `buildWidgetTimeline`
   (`packages/schedule-schema/src/widget.ts`) eine Zeitleiste: Segmente mit fertigen Texten,
   Grenzen an Blockbeginn, Blockende und Mitternacht (Europe/Berlin, inklusive Sommer- und
   Winterzeit). Auswahl wie in „Jetzt“ (`getFocusState`): halboffene Blöcke, bei Überschneidung
   der zuletzt begonnene. Laufende Aktivitäten fließen nicht ein.
3. `src/lib/home-widget.ts` ergänzt die Farbtöne (`categoryTone`) und übergibt das JSON an das
   native Modul `TagesTaktWidget`; es speichert in den app-internen SharedPreferences
   (`tagestakt_widget`, `MODE_PRIVATE`, kein Backup) und zeichnet die Widgets neu.
4. Der Provider wählt per Zeitvergleich das passende Segment und plant die nächste
   Aktualisierung an dessen Ende.

**Gespeichert werden nur:** Titel (bei App-Sperre nicht einmal diese), Kategorie, Zeitangaben,
Farbton und Segmentgrenzen – keine IDs, Orte, Notizen, Tagesnotizen, Tokens oder API-Antworten.

## Aktualisierung

| Anlass                                   | Weg                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| Neuer Planstand, Planänderung, Anmeldung | `useWidgetSync` nach jedem Snapshot (Abruf, Cache, alle 15 min)                   |
| Rückkehr in die App, App-Start           | `AppState` „active“ bzw. erster Snapshot nach dem Start                           |
| App-Sperre ein/aus                       | Geräteeinstellung ändert sich → neu berechnen (mit/ohne Titel)                    |
| Blockwechsel, Datumswechsel              | `AlarmManager.setWindow(RTC, Segmentende)` – inexakt, weckt nicht                 |
| Uhrzeit, Zeitzone, Neustart, App-Update  | Receiver: `TIME_SET`, `TIMEZONE_CHANGED`, `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED` |
| Rückfall                                 | `updatePeriodMillis` 1 h                                                          |
| Abmeldung, Sitzung abgelaufen            | Daten sofort gelöscht → „Nicht angemeldet“                                        |

Ohne Exact-Alarm-Berechtigung (bewusst gesperrt) wechselt das Widget an einer Blockgrenze
**spätestens etwa 10 Minuten** später (ab Android 12 dehnt das System das Fenster auf
mindestens 10 Minuten; im Ruhezustand erst beim Einschalten des Bildschirms). Nach „Stopp
erzwingen“ verwirft Android Alarme und Ereignisse der App – der nächste App-Start aktualisiert
das Widget wieder.

## Verdeckte, veraltete und fehlende Daten

- **App-Sperre aktiv:** nur Kategorie und Zeit („Gewerbe · 09:00–11:00“), keine Titel.
- **Veraltet:** Inhalte gelten höchstens 48 Stunden ab dem letzten erfolgreichen Abruf
  (`WIDGET_MAX_AGE_HOURS`). Danach – oder wenn die Geräteuhr vor den Erzeugungszeitpunkt
  gestellt wird oder die Daten unlesbar sind – zeigt das Widget „Plan nicht aktuell“, nie ein
  altes Segment.
- **Kein passender Block** (kein veröffentlichter Plan, Entwurf, nach dem letzten Block):
  „Kein aktueller Wochenplan“.
- **Abgemeldet:** „Nicht angemeldet“, keine Daten gespeichert.

## Technik

- Erzeugt beim Prebuild von `apps/mobile/plugins/with-android-widget.js` (keine neue
  Abhängigkeit): Kotlin aus `plugins/android-widget/*.kt`, Layouts aus
  `plugins/android-widget/res/layout/`, Farben, Texte, Maße, Formen, Logo-Vektor und
  `xml/tagestakt_widget_info.xml` werden generiert; der Receiver wird ins Manifest, das Modul in
  `MainApplication.kt` eingetragen.
- Das Modul ist ein klassisches React-Native-Modul über die Interop-Schicht der New
  Architecture (in RN 0.86 standardmäßig aktiv).
- Keine zusätzliche Berechtigung (`RECEIVE_BOOT_COMPLETED` war schon vorhanden), keine Exact
  Alarms, keine Cloud-Komponente.

## Tests

- `packages/schedule-schema/src/widget.test.ts`: aktueller/nächster Block, Halboffenheit,
  Überschneidung, Mitternacht, Wochenwechsel, Zeitzone, Sommer-/Winterzeit (25.10. und 29.03.),
  leerer Plan, Entwurf, App-Sperre, Abmeldung, veraltete Daten, keine Notizen/Orte/IDs.
- `apps/mobile/src/__tests__/home-widget.test.ts`: Brücke, Format, Datensparsamkeit.
- `apps/mobile/src/__tests__/android-widget.test.ts`: Manifest, Receiver, Registrierung,
  Provider-Metadaten, Ressourcen gegen Design-Tokens und Master-Logo, Kotlin ohne Exact Alarms,
  Netzwerk, Protokollierung oder Intent-Daten.

## Auf dem Gerät hinzufügen

Startbildschirm lange drücken → **Widgets** → **TagesTakt** → „Jetzt und danach“ auf den
Startbildschirm ziehen; Größe über die Ränder anpassen (mindestens 3 × 2).

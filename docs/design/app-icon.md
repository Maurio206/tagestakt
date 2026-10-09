# App-Icon und Startbildschirm

**Motiv „Fokusstapel“** (Version 1, gewählt am 09.10.2026): eine Zeitachse mit dem vorherigen,
dem aktuellen und dem nächsten Block – das Bild der „Jetzt“-Ansicht. Der aktuelle Block und der
Punkt auf der Achse sind golden und dominant, die Nachbarn gedämpft in Kategoriefarben, der
Hintergrund ist ruhiges Anthrazit. Kein Text, kein Buchstabe.

| Element          | Token (Palette „dark“)                                |
| ---------------- | ----------------------------------------------------- |
| Hintergrund      | `bg` `#121110`                                        |
| Zeitachse        | `lineStrong` `#76716A`                                |
| aktueller Block  | `business` `#E2B04A` (Gold)                           |
| vorheriger Block | `blockColors(dark, "duty", "muted").accent` `#5B6C7E` |
| nächster Block   | `blockColors(dark, "relationship", "muted").accent`   |

## Dateien

- **Quelle:** `apps/mobile/assets/branding/tagestakt-logo.svg` – Fläche 108 × 108 (Android
  Adaptive Icon: sichtbar die mittleren 72, Safe Zone Kreis ⌀ 66). Nur `<rect>`/`<circle>`;
  `data-layer` trennt Hinter- und Vordergrund, `data-mono-opacity` steuert das Themed Icon.
- **Erzeugt** (nicht von Hand bearbeiten), je 1024 × 1024:
  - `assets/icon.png` – deckend, sichtbarer Bereich (iOS, ältere Launcher),
  - `assets/adaptive-icon.png` – transparenter Vordergrund, Motiv in der Safe Zone,
  - `assets/adaptive-icon-monochrome.png` – einfarbig weiß, Hierarchie über Deckkraft
    (Android-13-Themed-Icons),
  - `assets/splash-icon.png` – transparentes Symbol für den Startbildschirm.

```bash
pnpm --filter @tagestakt/mobile icons
```

Das Skript `apps/mobile/scripts/app-icons.js` rendert ohne Fremdpakete (Distanzfeld mit
Kantenglättung, PNG über `node:zlib`) und ist reproduzierbar; `-- --check` prüft nur. Ein Test
vergleicht die Dateien byte-genau mit dem Master-SVG und prüft Abmessungen, Transparenz,
Safe Zone, Farben und die Einbindung in `app.json`.

## Einbindung

- `app.json`: `icon`, `android.adaptiveIcon` (`foregroundImage`, `monochromeImage`,
  `backgroundColor: "#121110"`). Die Launcher-Ressourcen erzeugt der Expo-Prebuild.
- Startbildschirm ohne `expo-splash-screen` (keine zusätzliche native Abhängigkeit) über
  `apps/mobile/plugins/with-android-splash.js`: Android 7–11 Farbe plus zentriertes Symbol
  (160 dp, je Dichte aus `splash-icon.png` verkleinert), Android 12+ System-Startbildschirm in
  derselben Farbe mit dem Adaptive Icon.
- Das Motiv ändern: SVG bearbeiten, `data-version` erhöhen, Skript ausführen, Tests laufen
  lassen; danach neuer Build mit höherem `versionCode`.

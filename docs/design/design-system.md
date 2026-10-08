# TagesTakt-Designsystem

> **Ruhige Präzision für ein volles Leben.**
> Disziplin ohne Härte: klare Zahlen, feine Linien, warme dunkle Flächen, wenige Farben mit Bedeutung.

Quelle der Wahrheit für alle Werte ist das Paket **`packages/design-tokens`** (`src/index.ts`).
Die Website spiegelt die Werte als CSS-Variablen in `apps/web/src/app/globals.css` (ein Test prüft die
Übereinstimmung), die App liest sie direkt in `apps/mobile/src/theme.ts`. Web und App teilen damit
dieselbe Sprache, aber keinen Layoutcode.

## Grundsätze

1. **Dark-first.** Warmes Fast-Schwarz statt Reinschwarz; das helle Erscheinungsbild folgt der
   Systemeinstellung und ist gleichwertig gepflegt.
2. **Farbe trägt Bedeutung, nie allein.** Zielfarben nur für Ziele und Kategorien, Statusfarben nur
   für Status – jeweils mit Text, Symbol oder Muster (gestrichelt = geplant, gefüllt = erfasst).
3. **Eine Hauptaussage pro Ansicht.** Hierarchie über Größe, Gewicht und Abstand, nicht über Kästen.
4. **Linien statt Karten.** Abschnitte werden durch Haarlinien und Überschriften gegliedert; Flächen
   (Karten) nur für bedienbare Einheiten wie Planblöcke, Listen und Dialoge.
5. **Ziffern sind Werkzeug.** Uhrzeiten, Dauern und Timer immer in tabellarischen Ziffern.
6. **Keine Effekte um ihrer selbst willen.** Keine Verläufe, kein Glas, kein Neon, sparsame Schatten.

## Farben

### Neutrale Flächen und Text

| Token        | Dunkel    | Hell      | Verwendung                                     |
| ------------ | --------- | --------- | ---------------------------------------------- |
| `bg`         | `#121110` | `#F7F5F1` | Seitenhintergrund                              |
| `surface1`   | `#1A1917` | `#FFFFFF` | Seitenleiste, Listen, Sheets                   |
| `surface2`   | `#211F1D` | `#F1EEE8` | Eingabefelder, Timer-Leiste                    |
| `surface3`   | `#2A2825` | `#E7E3DB` | aktive Navigation, gedrückte Zustände          |
| `line`       | `#302E2A` | `#E2DDD4` | Haarlinien (dekorativ)                         |
| `lineStrong` | `#76716A` | `#857E72` | Ränder von Bedienelementen (≥ 3 : 1)           |
| `text`       | `#F3EFE8` | `#1A1815` | Haupttext, Fokusring, Primärknopf (invertiert) |
| `textMuted`  | `#BDB6AA` | `#4C473F` | Sekundärtext                                   |
| `textSubtle` | `#979083` | `#665F55` | Hinweise (≥ 4,5 : 1 auf allen Flächen)         |
| `inverse`    | `#F3EFE8` | `#1A1815` | Fläche des Primärknopfs                        |
| `onInverse`  | `#141312` | `#F7F5F1` | Text auf `inverse`                             |

Kontraste (berechnet): `text` 16,5 : 1, `textMuted` 9,4 : 1, `textSubtle` 6,0 : 1 auf `bg` (dunkel).

### Ziel- und Kategoriefarben

| Ton            | Dunkel    | Hell      | Symbol (Lucide) | Kategorien                                               |
| -------------- | --------- | --------- | --------------- | -------------------------------------------------------- |
| `business`     | `#E2B04A` | `#875A00` | `briefcase`     | Gewerbe                                                  |
| `sport`        | `#5DBE86` | `#1E7546` | `dumbbell`      | Sport                                                    |
| `relationship` | `#EC8FA3` | `#AE3A5F` | `heart`         | Laila                                                    |
| `duty`         | `#88A6C6` | `#2E5B88` | `building`      | Dienst                                                   |
| `violet`       | `#A99BD8` | `#5C4AA3` | `calendar`      | Termin, Freizeit                                         |
| `neutral`      | `#A59E92` | `#655F55` | `circle`        | Einkaufen, Essen, Körperpflege, Fahrt, Schlaf, Sonstiges |

Alle Töne erreichen ≥ 6,6 : 1 (dunkel) bzw. ≥ 5,2 : 1 (hell) auf `bg` und `surface1` und sind
damit auch als Textfarbe zulässig (geprüft in `packages/design-tokens/src/index.test.ts`,
Mindestwert 4,5 : 1). Kategorien werden **immer** zusätzlich als Text angezeigt.

**Planblock-Fläche (`planBlockTint`):** Der Block im Wochenraster der Website und der Fokusblock
(Web-Übersicht, App „Jetzt“) zeigen den Kategorieton gleich stark – Fläche 16 % Ton in `surface1`
(`color-mix(in srgb, var(--g) 16%, var(--tt-surface1))`, App: `mixColor`), Rand 45 % Deckkraft.
Auf dieser getönten Fläche stehen Chips und Status-Tags auf `surface1`, Nebenzeilen in
`textMuted` und Ränder sekundärer Knöpfe in `textSubtle`; so bleiben Text ≥ 4,5 : 1 und Ränder
≥ 3 : 1 für alle Töne in beiden Modi (Test in `packages/design-tokens/src/index.test.ts`).

**Semantische Blockfarben der App (`blockColors`, `blockTint`):** Die App färbt jeden Planblock
an genau einer Stelle (`blockStyle` in `apps/mobile/src/theme.ts`) in drei Stufen desselben
Kategorietons – Hauptphase `strong` (aktueller Block, Fokusblock „Jetzt“: Fläche 24 %, Rand 80 %),
regulär `base` (= `planBlockTint`, wie das Wochenraster der Website) und Nebenblock `muted`
(Nachbarn, „Als Nächstes“, Vergangenes: Fläche 8 %, Rand 30 %, gedämpfter Text). Jede Stufe
liefert Hintergrund, Rand, Akzentkante (links, 4 dp), Text und gedämpften Text; Titel, Zeit und
Warnhinweise erreichen auf jeder Stufe ≥ 4,5 : 1 (Test). Zustände sind auch ohne Farbe
erkennbar: läuft (breiter Rand im vollen Ton + Text), erledigt (Haken + Text), ausgelassen (blass,
durchgestrichen + Text), ausgewählt (Ring in `text`), Überschneidung (gestrichelt in `warning` +
Symbol). Die Website nutzt die neuen Stufen noch nicht.

Hinweis: Lucide 1.x heißt das Dienst-Symbol `Building` (vormals `Building2`) und das
Löschen-Symbol `Trash` (vormals `Trash2`).

### Status

| Token     | Dunkel    | Hell      | Hintergrund (dunkel/hell) | Symbol           |
| --------- | --------- | --------- | ------------------------- | ---------------- |
| `error`   | `#F26A5C` | `#B3261E` | `#2B1714` / `#FBE9E7`     | `triangle-alert` |
| `warning` | `#F09A4A` | `#94470A` | `#2A1E11` / `#FDF0E2`     | `triangle-alert` |
| `success` | `#6CCB91` | `#1E7546` | `#132219` / `#E5F3EA`     | `circle-check`   |

Bekannte Nähe: Warnung ↔ Gewerbe (Orange/Gold) und Erfolg ↔ Sport (Grün). Statusfarben erscheinen
deshalb ausschließlich in Status-Komponenten mit Symbol und Wort (Banner, Status-Chip), Zielfarben
nur mit Zielsymbol und Namen.

## Zielstatus (Wort + Symbol)

| Status     | Wort                         | Symbol            | Darstellung                 |
| ---------- | ---------------------------- | ----------------- | --------------------------- |
| `unset`    | „Ziel noch festlegen“        | `circle-dashed`   | gestrichelter Rahmen        |
| `on_track` | „Im Plan“                    | `calendar-check`  | neutral (`surface3`)        |
| `at_risk`  | „Gefährdet“                  | `triangle-alert`  | Warnung                     |
| `reached`  | „Erreicht“                   | `circle-check`    | Erfolg                      |
| `over`     | „Über Ziel“                  | `circle-arrow-up` | Erfolg                      |
| `below`    | „Unter Ziel“ (abgeschlossen) | `circle-minus`    | neutral – bewusst nicht rot |

## Typografie

- **Web:** Geist Sans und Geist Mono, selbst gehostet über das npm-Paket `geist`
  (keine Anfragen an Drittserver; CSP `font-src 'self'` bleibt).
- **Mobile:** Systemschrift (auf dem Galaxy S26 Ultra: One UI/Roboto); Timer und Zeiten mit
  `fontVariant: ['tabular-nums']`.
- Skala (px, Web / dp, Mobile):

| Rolle       | Web          | Mobile       | Gewicht | Zeilenhöhe |
| ----------- | ------------ | ------------ | ------- | ---------- |
| Timer groß  | 56–64 (Mono) | 56 (Mono)    | 500     | 1,0        |
| Restzeit    | 40 (Mono)    | 36 (Mono)    | 500     | 1,0        |
| Jetzt-Titel | 34           | 30           | 650     | 1,15       |
| Seitentitel | 28           | 24           | 650     | 1,2        |
| Abschnitt   | 18–20        | 18–20        | 650     | 1,3        |
| Text        | 15           | 16           | 400     | 1,5        |
| Klein       | 13–14        | 13–14        | 400/500 | 1,45       |
| Überzeile   | 12, +0,08 em | 12, +0,08 em | 600     | 1,3        |

Keine Marketing-Überschriften innerhalb der App. Textskalierung des Systems wird respektiert
(Mobile: keine festen Höhen für Text, `allowFontScaling` bleibt an).

## Abstände, Radien, Schatten, Ebenen

| Gruppe   | Werte                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Abstände | 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 (4er-Raster)                                          |
| Radien   | `sm` 6 · `md` 10 · `lg` 14 · `xl` 20 · `sheet` 22 · `pill` 999                                          |
| Schatten | dunkel: nur Sheets/Dialoge `0 -12px 40px rgb(0 0 0 / .45)`; hell: `0 1px 2px` + `0 4px 16px` (6 %)      |
| Ebenen   | Inhalt 0 · klebrig 10 · Navigation 20 · Timer-Leiste 30 · Overlay 40 · Sheet 50 · Toast 60 · Sperre 100 |

## Bewegung

| Token  | Dauer  | Einsatz                 |
| ------ | ------ | ----------------------- |
| `fast` | 120 ms | Hover, Druckzustand     |
| `base` | 200 ms | Ein-/Ausblenden, Banner |
| `calm` | 320 ms | Sheets, Dialoge         |

Kurve `cubic-bezier(0.2, 0, 0, 1)`. Bei „Bewegung reduzieren“ (Web: `prefers-reduced-motion`,
Mobile: `AccessibilityInfo.isReduceMotionEnabled`) entfallen Animationen vollständig. Der Timer
aktualisiert nur seine Ziffern (keine Layoutänderung), Puls-Animationen gibt es nicht.

## Fokus und Touch-Ziele

- Fokus: 2 px Ring in `text`, 3 px Abstand (Web `:focus-visible`); nie entfernt.
- Touch-Ziele: Web ≥ 44 × 44 px, Android ≥ 48 × 48 dp; Primäraktionen 56 dp hoch im Daumenbereich.
- Safe Areas: oben Statusleiste, unten Gestennavigation (`react-native-safe-area-context`).

## Ikonografie

**Lucide** auf beiden Plattformen (`lucide-react` im Web, `lucide-react-native` + `react-native-svg`
in der App), Strichstärke 1,75–2, Größen 16/20/24. Icons stehen nie allein: Navigation immer mit
Text, reine Symbolknöpfe immer mit `aria-label`/`accessibilityLabel`. Keine Emojis.

## Marke

Wortmarke „TagesTakt“ in Geist 650 mit einem Zeichen aus abgerundetem Quadrat und drei steigenden
Taktstrichen (eigene Zeichnung, `TagesTaktMark`). Keine militärischen Symbole, Tarnmuster oder
Abzeichen.

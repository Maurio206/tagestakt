# Mobile App: Testen, Debug- und Release-Build

Getestet wird mit einem **lokal gebauten Debug-Build** (Paket `app.tagestakt.privat.dev`) auf dem
eigenen Gerät per USB: Metro und die lokale Supabase laufen nur auf diesem Rechner und sind über
`adb reverse` erreichbar (`127.0.0.1`), nie über WLAN. Die eigenständige App ist ein **lokal
gebauter, selbst signierter Release** (`app.tagestakt.privat`) gegen die Produktions-Supabase über
HTTPS – ohne Metro, ohne USB, ohne Play Store und ohne EAS (Abschnitt 2). Expo Go wird nicht
verwendet; die Tabelle in Abschnitt 1 erklärt, warum.

## 1. Warum nicht Expo Go

Expo Go zeigt zwar Oberfläche, Fokus-Erfassung, Plan bearbeiten, Ziele und Offline-Verhalten. Für
App-Sperre, Erinnerungen und Berechtigungen ist es aber nicht aussagekräftig:

| Thema                  | In Expo Go                                                                                                             | Verlässlich prüfbar erst im eigenen Build  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Berechtigungen         | Es gelten die Berechtigungen der **Expo-Go-App**, nicht `app.json` (`permissions`/`blockedPermissions` wirken nicht)   | ja                                         |
| Lokale Erinnerungen    | lokal planbar; erscheinen aber als Benachrichtigung von Expo Go, im Kanal von Expo Go. Push wird ohnehin nicht genutzt | ja (Kanal „Erinnerungen“, Sperrbildschirm) |
| App-Sperre (Biometrie) | Fingerabdruck/Geräte-PIN grundsätzlich nutzbar; Gesichtserkennung unter iOS laut Expo-Dokumentation nicht in Expo Go   | ja                                         |
| Neustart des Geräts    | Erinnerungen nach Neustart nicht aussagekräftig                                                                        | ja (`RECEIVE_BOOT_COMPLETED`)              |
| Name, Symbol, Splash   | Expo Go                                                                                                                | ja                                         |

## 2. Debug- und Release-Build (lokal, nur nach Rückfrage)

Beide Varianten entstehen lokal (JDK 17, Android-SDK/NDK außerhalb des Repositorys) und nur für
das eigene Gerät – kein Play Store, kein EAS. Der Ordner `apps/mobile/android/` ist generiert
(`expo prebuild -p android --no-install`) und wird nicht committed; alle Anpassungen kommen aus
`app.json` und dem Plugin `apps/mobile/plugins/with-android-release.js`.

|                    | Debug                                                     | Release                                    |
| ------------------ | --------------------------------------------------------- | ------------------------------------------ |
| Paket              | `app.tagestakt.privat.dev`                                | `app.tagestakt.privat`                     |
| JavaScript         | von Metro (USB, `adb reverse`)                            | in der APK eingebettet                     |
| Supabase-URL       | `http://127.0.0.1:54321` (lokal) oder HTTPS               | **nur HTTPS** (Produktion)                 |
| Signatur           | öffentlicher Debug-Schlüssel                              | eigener Schlüssel; ohne ihn **unsigniert** |
| Zusätzliche Rechte | `SYSTEM_ALERT_WINDOW` (Entwickler-Overlay), Klartext-HTTP | keine                                      |
| Badge/Install-Ref. | aus Bibliotheken vorhanden                                | per Release-Manifest entfernt              |

Beide Pakete können nebeneinander installiert sein. Ein Debug-Build vor dieser Trennung hieß
ebenfalls `app.tagestakt.privat` und ist mit dem Debug-Schlüssel signiert – Android installiert
den Release nicht darüber. Er wird **einmal** deinstalliert (lokale App-Daten gehen verloren; der
Plan liegt in der Datenbank).

**Signierschlüssel (einmalig, durch den Benutzer):** außerhalb des Repositorys, z. B. unter
`%USERPROFILE%\TagesTakt-Android\signing\`, mit `keytool -genkeypair` (PKCS12, RSA 4096). Die
Passwörter werden nur interaktiv eingegeben – nie als Befehlsargument, nie in Chat, Log oder
Repository. Den Schlüssel samt Passwort im Passwortmanager und offline sichern: Ohne ihn kann
die installierte App nicht mehr aktualisiert, nur neu installiert werden.

**Signierwerte für Gradle:** vier Eigenschaften in der `gradle.properties` des verwendeten
`GRADLE_USER_HOME` (hier `%USERPROFILE%\TagesTakt-Android\gradle-home\`), nie im Repository und nie
mit `-P` auf der Kommandozeile:

```properties
# Pfad mit Schrägstrichen (Properties-Format); bei PKCS12 sind beide Passwörter gleich.
TAGESTAKT_RELEASE_STORE_FILE=C:/…/TagesTakt-Android/signing/<datei>.p12
TAGESTAKT_RELEASE_STORE_PASSWORD=<nur lokal eintragen>
TAGESTAKT_RELEASE_KEY_ALIAS=<alias>
TAGESTAKT_RELEASE_KEY_PASSWORD=<nur lokal eintragen>
```

**Umgebung für den Release-Bundle:** `EXPO_PUBLIC_SUPABASE_URL=https://api.plan.north-frame.de` und
der **Publishable Key** der Produktion – nur in der Shell des Builds oder in
`apps/mobile/.env.production.local` (per `.gitignore` ausgeschlossen), niemals ein Secret- oder
Service-Role-Key. Mit einer HTTP-URL startet der Release nicht.

**Bauen:** unter Windows aus einem `git worktree` des gepushten Stands unter einem **kurzen
echten Pfad** (z. B. `C:\tt`; CMake scheitert sonst an der Pfadlänge), dort
`pnpm install --frozen-lockfile --prefer-offline`, `.env.production.local` hineinkopieren,
`expo prebuild -p android --clean`, dann
`gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a` (`GRADLE_USER_HOME` über ein
kurzes Laufwerk wie `G:`). **Nicht** das Repository per `subst` ansprechen: Die pnpm-Links der
Workspace-Pakete zeigen auf den echten Pfad, Metro bündelt dann unvollständig (beobachtet: 1 196
statt rund 3 500 Module – App-Seiten fehlten, der Build meldete trotzdem Erfolg). Ein Release ohne
die vier Eigenschaften bricht nicht ab, ist aber unsigniert und nicht installierbar – nie mit dem
Debug-Schlüssel signiert.

**Vor der Installation prüfen** (alles muss stimmen, sonst nicht installieren):

- Signatur gültig und **nicht** der Debug-Schlüssel (`apksigner verify --print-certs`), Paket
  `app.tagestakt.privat`, `versionCode`/`versionName`, Größe und SHA-256 der APK notieren.
- JavaScript eingebettet (`assets/index.android.bundle`), keine Verbindung zu Metro nötig.
- Nur `arm64-v8a` unter `lib/`.
- Manifest: `allowBackup="false"`, kein `usesCleartextTraffic`, Berechtigungen wie in Abschnitt 3.
- Bundle vollständig (Hermes-Bytecode, App-Texte wie „Anmelden“ enthalten), nur die
  HTTPS-Produktions-URL, kein `127.0.0.1`/`10.0.2.2`. Schlüssel: nur der öffentliche
  anon/Publishable Key. Hermes legt Zeichenketten ohne Trennzeichen ab – Treffer für
  `sb_secret_` deshalb über die Source-Map auf ihre Herkunft prüfen (nur Präfix-Literale aus
  `supabase-js` und `env.ts` sind unkritisch).
- App-Icon und Startbildschirm: Adaptive Icon mit Vorder-, Hintergrund und Monochrom-Ebene,
  kein Vorlagen-Platzhalter (siehe [design/app-icon.md](design/app-icon.md)).
- Update statt Neuinstallation: gleicher Paketname, gleiches Zertifikat, höherer `versionCode`;
  nur `adb install -r` – nie deinstallieren oder mit `-d` erzwingen.

Staging gibt es bewusst noch nicht; Empfehlung für später siehe [security.md](security.md).

## 3. Nach dem Build: Berechtigungen prüfen

Das zusammengeführte Manifest enthält auch Berechtigungen aus Bibliotheken. Prüfen mit
`apkanalyzer manifest permissions <apk>` (Android SDK) oder `aapt2 dump permissions <apk>`.

| Erwartet                                                                              | Herkunft                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| `INTERNET`                                                                            | React Native / Supabase                     |
| `USE_BIOMETRIC`                                                                       | App-Sperre                                  |
| `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`                                        | lokale Erinnerungen                         |
| `VIBRATE`                                                                             | Expo-Vorlage (Benachrichtigungen)           |
| ggf. `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Bibliotheken (AndroidX, Benachrichtigungen) |
| `DETECT_SCREEN_CAPTURE` (Android 14+)                                                 | `expo-screen-capture`, beim Laden benötigt  |

`DETECT_SCREEN_CAPTURE` erlaubt keine Aufnahme oder Auslesung des Bildschirms; die App erfährt
damit nur, dass ein Screenshot ihrer eigenen Oberfläche erstellt wurde. `expo-screen-capture`
braucht sie unter Android 14 und neuer bereits beim Laden – war sie gesperrt, startete die App
nicht („Permission Denial: registerScreenCaptureObserver …“). TagesTakt nutzt das Modul weiterhin
nur für `preventScreenCaptureAsync` (Schutz sensibler Inhalte bzw. der Vorschau im
App-Umschalter), nicht für Screenshot-Meldungen. Begründung: [security.md](security.md).

**Darf nicht enthalten sein:** Standort, Kamera, Mikrofon, Kontakte, Kalender, Speicher,
`SYSTEM_ALERT_WINDOW` (nur im Debug-Build), `USE_FINGERPRINT`, `SCHEDULE_EXACT_ALARM`,
`USE_EXACT_ALARM`, `com.google.android.c2dm.permission.RECEIVE`, `READ_MEDIA_IMAGES`; im
**Release** außerdem keine Launcher-Badge-Berechtigungen (`READ_APP_BADGE`, `…launcher…`,
`…badge…`) und kein `BIND_GET_INSTALL_REFERRER_SERVICE`. Taucht etwas Unerwartetes auf: für alle
Varianten in `apps/mobile/app.json` unter `blockedPermissions` ergänzen, nur für den Release in
`RELEASE_BLOCKED_PERMISSIONS` des Plugins – vorher prüfen, dass keine benötigte Funktion
(Erinnerungen, App-Sperre) daran hängt.

Außerdem prüfen: `android:allowBackup="false"` im Manifest.

Vorab (ohne Android-SDK) lässt sich das **App-Manifest** prüfen: `apps/mobile` in ein temporäres
Verzeichnis außerhalb des Repositorys kopieren, dort `npx expo prebuild -p android --no-install`
ausführen und `android/app/src/main/AndroidManifest.xml` lesen; danach das Verzeichnis löschen.
Das ersetzt nicht die Prüfung der fertigen APK (Bibliotheks-Manifeste werden erst von Gradle
zusammengeführt).

Expo-Abhängigkeiten prüfen (im Repository):

```bash
pnpm --filter @tagestakt/mobile run doctor
```

(`pnpm --filter … doctor` ohne `run` würde den gleichnamigen pnpm-Befehl aufrufen.)

## 4. Gerätetests (Checkliste)

Mit Beispieldaten oder dem eigenen Konto; keine Bildschirmfotos mit echten Daten ins Repository.

**Grundfunktionen**

- [ ] Anmeldung; keine Registrierung sichtbar; Tabs Jetzt/Tag/Woche/Mehr mit Symbol und Text.
- [ ] „Fokus starten“ → App vollständig beenden → neu öffnen: Timer läuft mit derselben Startzeit.
- [ ] Laufende Aktivität und anderer geplanter Block: „Zu … wechseln“ zeigt drei Möglichkeiten.
- [ ] „Zeit korrigieren“ (5/15 Min.), „Aktivität verwerfen“; im Web sichtbar als „korrigiert“.
- [ ] „Plan bearbeiten“: neue Version anlegen, Block ändern, veröffentlichen – Web zeigt dieselbe
      Version; die alte Version war bis dahin sichtbar.
- [ ] Flugmodus: Plan und laufender Timer sichtbar, Hinweis „Offline – gespeicherter Plan“,
      Starten/Beenden/Bearbeiten gesperrt mit Erklärung; nach Verbindung wieder möglich.

**Fokusfläche („Jetzt“)**

- [ ] Aktueller Block groß in der Mitte, vorheriger/nächster Block blass und angeschnitten
      (Android zusätzlich unscharf); Nachbarn reagieren nicht auf Tippen.
- [ ] Zur Start- bzw. Endzeit eines Blocks wechselt die Fläche ohne Neuladen (App offen lassen).
- [ ] Freie Zeit: „Freie Zeit“ mit Countdown, nichts startet automatisch.
- [ ] Laufende Aktivität hat Vorrang vor dem geplanten Block.
- [ ] TalkBack liest die Nachbarn **nicht** vor, wohl aber „Davor … / Danach …“ im Fokusblock;
      beim Wechsel wird „Jetzt im Fokus: …“ angesagt.
- [ ] „Animationen entfernen“ → Wechsel ohne Einblendung oder Bewegung.

**Tagesnotiz**

- [ ] „Tag“: Notiz schreiben → „Gespeichert um …“; Web zeigt dieselbe Notiz (und umgekehrt).
- [ ] Tastatur offen: Textfeld und „Speichern“ bleiben sichtbar (auch bei Systemschrift 200 %).
- [ ] Gleichzeitig im Web ändern, dann in der App speichern → Konflikt mit beiden Möglichkeiten.
- [ ] „Zurück“ bzw. Android-Zurück-Taste mit ungespeicherten Änderungen → Rückfrage.
- [ ] Flugmodus: „Ohne Verbindung nicht verfügbar“, keine Notiz sichtbar; nach Verbindung
      „Erneut versuchen“ lädt sie.
- [ ] Erinnerungen und Sperrbildschirm enthalten **nie** Notizinhalte.
- [ ] TalkBack: Textfeld beschriftet („Tagesnotiz für …“), Status wird angesagt.

**App-Sperre**

- [ ] Einschalten verlangt Entsperrung; Standard war „aus“.
- [ ] Kaltstart → gesperrt; Inhalte nicht sichtbar, TalkBack liest nur den Sperrbildschirm.
- [ ] Hintergrund kürzer/länger als die gewählte Zeit (sofort, 1 min, 5 min).
- [ ] Geräte-PIN statt Fingerabdruck → entsperrt, **keine** erneute Sperre direkt danach.
- [ ] Ausschalten verlangt Entsperrung. Gerät ohne Bildschirmsperre: verständlicher Hinweis.
- [ ] App-Umschalter bei eingeschalteter Sperre: Vorschau leer bzw. neutrale TagesTakt-Fläche,
      keine Termine und kein Timer lesbar.
- [ ] Bei eingeschalteter Sperre sind Screenshots gesperrt; nach dem Ausschalten wieder möglich.
- [ ] Rückkehr innerhalb der Sperrzeit: kurz die Schutzfläche, dann Inhalte – keine Sperrschleife.
- [ ] Nur falls ein Gerät mit Android 7–8.1 genutzt wird: App-Sperre wird als „nicht
      unterstützt“ gemeldet, kein Absturz.

**Erinnerungen**

- [ ] Berechtigungsdialog erscheint erst beim Einschalten unter „Mehr → Erinnerungen“.
- [ ] Ablehnen → Hinweis mit „Systemeinstellungen öffnen“.
- [ ] Vorab-, Beginn- und „noch nicht gestartet“-Erinnerung kommen (Abweichung von wenigen
      Minuten ist ohne Exact Alarms möglich); nach „Fokus starten“ entfällt „nicht gestartet“.
- [ ] Sperrbildschirm zeigt **keine** Titel; erst mit „Titel in Erinnerungen zeigen“.
- [ ] Gerät neu starten → kommende Erinnerungen kommen weiterhin.
- [ ] Abmelden → keine Erinnerungen mehr, App-Sperre zurückgesetzt, Plan-Cache gelöscht.

**Startbildschirm-Widget** ([design/widget.md](design/widget.md))

- [ ] „TagesTakt“ erscheint in der Widget-Auswahl mit „Jetzt und danach“; Standard 4 × 2,
      kleiner als 3 × 2 nicht möglich.
- [ ] Aktueller Block hervorgehoben, nächster Block mit Uhrzeit; Antippen öffnet „Jetzt“ (auch
      wenn die App auf einem anderen Tab offen war).
- [ ] Ohne veröffentlichten Plan: „Kein aktueller Wochenplan“ / „TagesTakt öffnen“.
- [ ] Blockwechsel bei geschlossener App innerhalb von etwa 10 Minuten; nach Datums- bzw.
      Zeitzonenwechsel und Neustart korrekt.
- [ ] App-Sperre ein → Widget zeigt nur Kategorie und Zeit; Abmelden → „Nicht angemeldet“.
- [ ] Nach mehr als 48 h ohne App-Start: „Plan nicht aktuell“ statt alter Inhalte.

**Offline-Cache**

- [ ] Nach dem Update auf diese Version: Offline-Anzeige funktioniert weiter; Notizen zu
      Planblöcken erscheinen in der App nicht (werden nicht mehr geladen oder gespeichert).

**Darstellung und Barrierefreiheit**

- [ ] Hell/Dunkel, Systemschrift 200 %, kleines und großes Display, Gesten- und
      Drei-Tasten-Navigation (nichts unter der Navigationsleiste).
- [ ] TalkBack: sinnvolle Reihenfolge, alle Symbolknöpfe beschriftet, Timer wird nicht im
      Sekundentakt vorgelesen.
- [ ] „Animationen entfernen“ (Bedienungshilfen) → Sheets ohne Animation.

## 5. Bekannte Grenzen

- Erinnerungen sind nicht minutengenau (keine Exact-Alarm-Berechtigung, bewusst); dasselbe gilt
  für Blockwechsel im Startbildschirm-Widget (bis etwa 10 Minuten später).
- `expo-notifications` bündelt auf Android die Firebase-Messaging-Bibliothek; sie bleibt ohne
  `google-services.json` und ohne Push-Token ungenutzt.
- Die Vorschau im Task-Wechsler ist nur bei eingeschalteter App-Sperre geschützt; dann sind auch
  Screenshots der App gesperrt (Android bietet in Expo keine getrennte Steuerung).
- Offline werden keine Änderungen vorgemerkt (keine Warteschlange).
- Tagesnotizen sind nur online verfügbar und werden nicht auf dem Gerät gespeichert.
- Die Unschärfe der Nachbarblöcke gibt es nur unter Android (React Native `filter: blur`); unter
  iOS sind sie nur blass und angeschnitten.

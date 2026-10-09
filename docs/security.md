# Sicherheit

## Schutzziel

Geschützt werden die persönlichen Wochenpläne einer einzelnen Person (Dienstzeiten, Termine,
Orte, gemeinsame Zeit zu zweit, Gewohnheiten). Daraus lassen sich Anwesenheit,
Abwesenheit und Routinen ableiten – die Daten sind deshalb vertraulich zu behandeln, auch wenn
sie keine „besonderen Kategorien“ im Sinne der DSGVO sind.

Seit den **Tagesnotizen** kommen frei formulierte Texte hinzu. Sie können deutlich persönlicher
sein als Termine (Gedanken, Gesundheit, andere Menschen) und werden deshalb noch strenger
behandelt: nie protokolliert, nie im Offline-Cache, nie in Benachrichtigungen, nie im Repository.

## Bedrohungsmodell

| Angreifer / Risiko                 | Beispiel                                                                           | Gegenmaßnahmen                                                                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unbekannte im Internet             | Aufruf der Website, Erraten von URLs, direkte API-Aufrufe mit dem öffentlichen Key | Keine öffentlichen Inhalte; Proxy leitet auf `/login`; jede Seite und Server Action prüft serverseitig; `anon` hat **keine** Grants; RLS auf jeder Tabelle                                                                                 |
| Registrierung eines eigenen Kontos | Signup-API von Supabase aufrufen                                                   | Registrierung in Supabase deaktiviert; zusätzlich Eigentümer-UUID (`TAGESTAKT_OWNER_USER_ID`, in Produktion Pflicht)                                                                                                                       |
| Anderer gültiger Supabase-Benutzer | z. B. versehentlich angelegtes Zweitkonto                                          | RLS `owner_id = auth.uid()`, zusammengesetzter FK, Trigger-Prüfung; pgTAP-Negativtests                                                                                                                                                     |
| Passwort-Raten                     | Brute Force auf `/login`                                                           | Supabase-Rate-Limits, Mindestlänge 12, neutrale Fehlermeldungen; optional später Zugriffsschicht/MFA                                                                                                                                       |
| XSS / Code-Injektion               | eingeschleustes Skript liest Tokens                                                | React-Escaping, strikte CSP mit Nonce + `strict-dynamic`, Session-Cookies `httpOnly`, keine Fremdskripte/-schriften                                                                                                                        |
| CSRF / Clickjacking                | fremde Seite löst Aktionen aus                                                     | Server Actions mit Origin-Prüfung (Next.js), `SameSite=Lax`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`                                                                                                                             |
| Verlust/Diebstahl des Smartphones  | Zugriff auf App-Daten                                                              | Tokens nur in SecureStore (Android Keystore); Plan-Cache nur in der App-Sandbox; Android-Backup deaktiviert; optionale App-Sperre (Biometrie/Geräte-PIN); Erinnerungen ohne Inhalte; Logout löscht alles; Sitzung serverseitig widerrufbar |
| Leck des Repositories              | Repo wird öffentlich/kopiert                                                       | Keine Secrets/echten Daten im Repo, `.env*` ignoriert, `pnpm check:secrets` lokal und in CI                                                                                                                                                |
| Fehlkonfiguration                  | Service-Role-Key im Client                                                         | Kein Service-Role-Key im Projekt; Web und App brechen ab, wenn ein Secret-Key als Publishable Key eingetragen wird; ESLint verbietet Secret-Variablen im Client                                                                            |
| Supply Chain                       | kompromittiertes npm-Paket                                                         | Lockfile, pnpm-Release-Alter-Sperre (24 h), Build-Skripte nur für freigegebene Pakete, Dependabot zurückhaltend, keine Analyse-/Werbe-SDKs                                                                                                 |
| Späterer Agent                     | Agent veröffentlicht falsche Pläne                                                 | Datenbank lässt neue Wochen nur als Entwurf zu; Veröffentlichen nur durch den Benutzer (siehe agent-integration.md)                                                                                                                        |

## Row Level Security und Grants

- RLS ist auf **allen** Tabellen im `public`-Schema aktiv (per Test erzwungen).
- Je Tabelle vier getrennte Policies (SELECT, INSERT, UPDATE, DELETE), ausschließlich
  `to authenticated` mit `(select auth.uid()) = owner_id`; UPDATE zusätzlich mit `with check`.
- Grants werden explizit gesetzt: `anon` und `PUBLIC` erhalten **nichts**, `authenticated`
  nur SELECT/INSERT/UPDATE/DELETE. Standardrechte für neue Objekte in `public` wurden für
  `anon`/`authenticated` entzogen – jede neue Tabelle braucht bewusst eigene Grants.
- Keine Views (die RLS umgehen könnten), keine SECURITY-DEFINER-Funktionen im `public`-Schema.
  RPC-Funktionen laufen als SECURITY INVOKER; interne Trigger-Funktionen liegen im nicht
  exponierten Schema `private`.
- Zusammengesetzter Fremdschlüssel `(schedule_week_id, owner_id)` verhindert, dass ein Eintrag
  einem fremden Wochenplan zugeordnet wird – unabhängig von Policies.
- Zusammengesetzter Fremdschlüssel `(schedule_entry_id, owner_id)` bindet erfasste Zeit
  (`activity_sessions`) ausschließlich an eigene Planblöcke.
- Prüfungen: `supabase/tests/*.test.sql` (239 pgTAP-Tests) – anonym abgewiesen, fremder
  Benutzer kann weder lesen noch ändern noch unterschieben, Eigentümer kann bearbeiten,
  Status- und Constraint-Regeln, Fokus-Erfassung (eine laufende Aktivität, keine
  Überschneidung, Serverzeit, Korrekturkennzeichen, atomarer Wechsel), Tagesnotizen (eine pro
  Tag, Länge, Bearbeitungsstand, fremder Benutzer ohne Zugriff, unverändert über
  Planversionen hinweg). Gleichzeitige Wechsel, Starts und Notiz-Speicherungen prüft zusätzlich
  `pnpm db:concurrency-test` mit zwei echten Datenbanksitzungen.

## Publishable Key

Der Publishable Key (bzw. lokal der `anon`-Key) ist **öffentlich** – er steckt im App-Bundle und
darf als `NEXT_PUBLIC_*` gesetzt werden. Er ersetzt **keine** Berechtigung: Ohne gültige
Benutzer-Session und passende RLS-Policies liefert die Datenbank keine Daten. Er darf daher nur
zusammen mit korrekt getesteter RLS verwendet werden.

## Secret-Verwaltung

- Echte Werte nur in `apps/*/.env.local` (git-ignoriert), im Passwortmanager bzw. später in den
  Umgebungsvariablen der Hosting-/Build-Plattform. Ein privates GitHub-Repository ist **kein**
  Secret-Speicher.
- `SUPABASE_SECRET_KEY` / `service_role` werden derzeit nirgends benötigt und sollen nicht
  gesetzt werden. Sollte ein späterer serverseitiger Endpunkt sie brauchen: nur serverseitig,
  niemals mit `NEXT_PUBLIC_`/`EXPO_PUBLIC_`-Präfix, niemals an Clients oder Chat-Agenten.
- Wird ein Secret versehentlich committed oder geteilt: **sofort im Supabase-Dashboard rotieren**
  (das Entfernen aus Git allein genügt nicht).
- Protokolliert werden nur Fehlercodes – keine Passwörter, Tokens oder vollständigen Termine.

## Ein-Benutzer-Modell

- Keine Registrierung in Web oder App, kein „Registrieren“-Button.
- Der Benutzer wird manuell in Supabase angelegt (siehe setup.md).
- Die Website akzeptiert über `TAGESTAKT_OWNER_USER_ID` nur genau diese UUID. In Produktion
  (`NODE_ENV=production`) ist die Variable **Pflicht**: Fehlt sie oder ist sie ungültig, bricht
  der Serverstart ab, und der Proxy verweigert jede Anfrage mit 503 (fail closed). Sessions
  anderer Supabase-Benutzer gelten bereits im Proxy als „nicht angemeldet“. Die UUID ist eine
  reine Laufzeitvariable und gelangt nie in den Client. In development/test darf sie fehlen.
  (Die App verlässt sich auf deaktivierte Registrierung + RLS; ein anderes Konto sähe ohnehin
  keine fremden Daten.)

## Session-Speicherung

**Web:** Die Supabase-Session liegt in Cookies, die nur der eigene Server liest
(`httpOnly`, `SameSite=Lax`, in Produktion `Secure`). Der Browser spricht nie direkt mit
Supabase (`connect-src 'self'`). Session-Refresh erfolgt im Proxy; geschützte Seiten prüfen mit
`auth.getUser()` gegen den Auth-Server.

**App:** Die Session liegt ausschließlich in **Expo SecureStore** (Android Keystore, iOS
Keychain mit `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Weil Sessions größer als 2 KB sein
können, wird der Wert in Abschnitte aufgeteilt – alle in SecureStore, ohne eigene Kryptografie.
Abmelden widerruft die Sitzung serverseitig (falls online) und löscht SecureStore-Einträge sowie
den Plan-Cache auch offline.

### Lokale Daten, die nur durch den Betriebssystem-/Sandbox-Schutz gesichert sind

| Daten                                                                                                                                                                    | Ort                                         | Schutz                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Zuletzt geladener **veröffentlichter** Plan (Vor-, aktuelle, nächste Woche): Titel, Kategorie, Zeiten, Ort, Erledigt-Status – **ohne** Notizen und Planungshinweise      | AsyncStorage (App-Sandbox)                  | nur App-Sandbox / Geräteverschlüsselung; nicht zusätzlich verschlüsselt; Android-Backup deaktiviert; beim Logout gelöscht |
| Erfasste Aktivitäten dieser Wochen (Ziel, Titel, Zeiten), Wochenziele, Erinnerungs-Vorgaben, Zeitzone, letzte Synchronisierung                                           | AsyncStorage (gleicher Eintrag)             | wie oben                                                                                                                  |
| Geräteeinstellungen (App-Sperre an/aus, Sperrzeit, Erinnerungen an/aus, „Titel zeigen“) – keine Inhalte                                                                  | SecureStore                                 | Android Keystore; beim Logout gelöscht                                                                                    |
| Geplante lokale Erinnerungen (Zeitpunkt, kurzer Text, `kind`)                                                                                                            | Benachrichtigungsdienst des Betriebssystems | standardmäßig **ohne** Titel, Ort oder Notiz („Gewerbe in 10 Min.“); beim Logout gelöscht                                 |
| Startbildschirm-Widget: vorberechnete Segmente der nächsten höchstens 48 h (Titel bzw. bei App-Sperre nur Kategorie, Zeiten, Farbton) – keine IDs, Orte, Notizen, Tokens | SharedPreferences der App (`MODE_PRIVATE`)  | nur App-Sandbox; kein Backup; nach 48 h ab Abruf nicht mehr angezeigt; beim Logout gelöscht                               |
| Abfrage-Zwischenspeicher im Arbeitsspeicher                                                                                                                              | RAM (TanStack Query)                        | nur solange die App läuft; beim Logout geleert                                                                            |
| **Tagesnotizen** (zuletzt geöffneter Tag)                                                                                                                                | nur RAM (TanStack Query)                    | **nie** in AsyncStorage/SecureStore oder im Plan-Cache; ohne Verbindung nicht verfügbar; beim Logout geleert              |

Auf einem gerooteten oder kompromittierten Gerät kann der Plan-Cache gelesen werden. Eine
Bildschirmsperre auf dem Gerät ist daher Voraussetzung.

### Bewertung des Plan-Caches (Entscheidung: minimieren statt zusätzlich verschlüsseln)

| Bedrohung                                        | Schutz                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Andere Apps auf dem Gerät                        | App-Sandbox: kein Zugriff auf AsyncStorage dieser App                                                                                                     |
| Gestohlenes, **gesperrtes** Gerät                | dateibasierte Android-Verschlüsselung; Schlüssel erst nach dem Entsperren verfügbar                                                                       |
| Cloud-/ADB-Backup                                | `allowBackup=false` – der Cache wird nicht gesichert                                                                                                      |
| Jemand hält das **entsperrte** Gerät in der Hand | optionale App-Sperre (Oberfläche) und leere Vorschau im App-Umschalter                                                                                    |
| Gerootetes/kompromittiertes Gerät, Forensik      | **kein** Schutz – auch ein zusätzlich verschlüsselter Cache wäre dort angreifbar, weil die App ihren Schlüssel im selben Gerät und Prozess verwenden muss |

Eine zusätzliche Verschlüsselung würde eine nicht offiziell von Expo bereitgestellte
Kryptografie-Bibliothek erfordern (Expo bietet keine symmetrische Verschlüsselung; SecureStore ist
für kleine Werte gedacht) und gegen die realistischen Bedrohungen oben kaum Schutz hinzufügen.
Stattdessen werden **Notizen und Planungshinweise** gar nicht mehr geladen oder gespeichert
(`apps/mobile/src/lib/plan-api.ts`, `plan-cache.ts`); ein älterer Cache (`…plan-snapshot.v2`),
der Notizen enthalten konnte, wird beim nächsten Start gelöscht. Auth-Tokens liegen weiterhin
ausschließlich in SecureStore. Auf dem Gerät zu prüfen bleibt, dass nach einem Update der alte
Cache verschwunden ist und Offline-Lesen weiter funktioniert.

## Tagesnotizen

- **Reiner Text**, höchstens 10 000 Zeichen – in der Datenbank per Constraint erzwungen, in Web
  und App mit demselben Zod-Schema geprüft (`dailyNoteSaveInputSchema`). Normalisiert werden nur
  Zeilenumbrüche, Unicode (NFC), Steuerzeichen und Leerraum am Rand; HTML wird nie interpretiert
  (React gibt Text escaped aus, es gibt kein `dangerouslySetInnerHTML`).
- **RLS wie alle Tabellen** (vier Policies, `anon` ohne Rechte), Schreiben über die
  SECURITY-INVOKER-RPC `save_daily_note`. Eine ältere Antwort oder ein anderes Gerät kann eine
  neuere Fassung nicht still überschreiben (Bearbeitungsstand `revision`, Fehler `TT007`); die
  Oberfläche zeigt den Konflikt und lässt den Benutzer entscheiden.
- **Keine Inhalte in Logs, Fehlermeldungen oder Telemetrie:** Server Action und Data-Access-
  Schicht protokollieren nur Fehlercodes; Statustexte des Editors enthalten nie den Notiztext.
- **App:** nur online; nicht im Offline-Cache, nicht in Erinnerungen. ESLint verbietet, dass
  `plan-cache.ts`, `plan-api.ts`, `notifications.ts`, `use-reminder-sync.ts` oder die Widget-Module
  (`home-widget.ts`, `use-widget-sync.ts`) die
  Notiz-Module importieren; ein Test prüft das zusätzlich.
- **Keine KI und keine automatische Auswertung** von Notizen. Ein späterer Agent darf Notizen
  nur nach ausdrücklicher Freigabe lesen (siehe [notes-roadmap.md](notes-roadmap.md)).
- **Repository:** `pnpm check:secrets` lehnt private Verknüpfungen (`.url`, `.webloc`, `.lnk`),
  OneNote-Dateien (`.one`, `.onepkg`, `.onetoc2`), Dokumentexporte (`.docx`, `.mht` …),
  Notiz-Exporte und JSON/CSV-Datensätze mit `note_date` + `content` ab; Funde nennen nur Datei
  und Regel, nie Inhalte. Dieselben Muster stehen in `.gitignore`. Seed, Tests und Doku
  verwenden nur neutrale, erfundene Texte.

## App-Sperre (optional, Standard: aus)

- Ausschließlich lokal über `expo-local-authentication`: Fingerabdruck, Gesicht oder – als
  Ausweichmöglichkeit – die Geräte-PIN. Die App erhält nur „erfolgreich/nicht erfolgreich“, nie
  biometrische Daten; nichts davon verlässt das Gerät.
- Sperrt bei jedem Kaltstart und nach einstellbarer Zeit im Hintergrund (sofort, 1 min, 5 min).
  Ein- und Ausschalten erfordert eine erfolgreiche Entsperrung. Eigene Systemdialoge (PIN-Eingabe,
  Berechtigungsabfrage) lösen keine erneute Sperre aus.
- Gesperrt verdeckt ein Sperrbildschirm alle Inhalte; sie sind für Screenreader ausgeblendet.
  Ohne Bildschirmsperre auf dem Gerät bietet die App nur „Abmelden“ an.
- Die Sperre schützt die **Oberfläche**, nicht die Daten auf einem kompromittierten Gerät; der
  Plan-Cache bleibt wie oben beschrieben gespeichert.
- **Vorschau im App-Umschalter:** Bei eingeschalteter App-Sperre setzt die App über
  `expo-screen-capture` (`preventScreenCaptureAsync`) das Android-Fensterflag `FLAG_SECURE` – die
  Vorschau bleibt leer (iOS zusätzlich: Unschärfe im App-Umschalter). Sobald die App in den
  Hintergrund geht, zeigt sie außerdem eine neutrale TagesTakt-Schutzfläche statt Terminen und
  Timer. **Kompromiss:** Android trennt Vorschau- und Screenshot-Schutz in Expo nicht
  (`setRecentsScreenshotEnabled` ist nicht verfügbar); mit eingeschalteter App-Sperre sind
  deshalb auch Screenshots und Bildschirmaufnahmen der App gesperrt. Ohne App-Sperre bleibt
  beides erlaubt. Die Zustandslogik (Schutzfläche, Sperre, keine Sperrschleife bei der
  PIN-Eingabe) ist als reine Funktion getestet (`nextLockState`); das tatsächliche Verhalten im
  App-Umschalter muss auf dem Gerät geprüft werden.

## Lokale Erinnerungen

- Werden ausschließlich auf dem Gerät geplant (`expo-notifications`, Datums-Trigger). Kein
  Push-Dienst, kein Push-Token, kein Firebase-Projekt, keine Übertragung an Dritte.
- Inhalt standardmäßig **ohne Termininhalte**: nur Ziel bzw. Kategorie und Uhrzeit. Titel
  erscheinen nur, wenn „Titel in Erinnerungen zeigen“ auf dem Gerät ausdrücklich eingeschaltet
  ist. Der Android-Kanal ist für den Sperrbildschirm als `PRIVATE` markiert.
- Die Berechtigung wird erst angefragt, wenn Erinnerungen eingeschaltet werden.
- **Keine Remote-Push-Funktion:** Die App ruft keine Push-Token-Funktionen auf
  (`getExpoPushTokenAsync`/`getDevicePushTokenAsync`), es gibt keine `google-services.json` und
  der generierte Gradle-Build bindet kein Google-Services-Plugin ein – Firebase wird also nicht
  initialisiert. `com.google.android.c2dm.permission.RECEIVE` wird per `tools:node="remove"` aus
  dem Manifest entfernt. Lokale Benachrichtigungen benötigen weder Firebase noch Push.

## Android-Berechtigungen

| Berechtigung             | Zweck                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `INTERNET`               | Verbindung zu Supabase (von Expo/React Native)                                             |
| `USE_BIOMETRIC`          | App-Sperre                                                                                 |
| `POST_NOTIFICATIONS`     | lokale Erinnerungen (Abfrage erst beim Einschalten)                                        |
| `RECEIVE_BOOT_COMPLETED` | geplante Erinnerungen und das Startbildschirm-Widget nach Neustart wiederherstellen        |
| `VIBRATE`                | aus der Expo-Vorlage; Vibration von Benachrichtigungen (normale Berechtigung, keine Daten) |
| `DETECT_SCREEN_CAPTURE`  | nur, weil `expo-screen-capture` sie ab Android 14 beim Laden benötigt (siehe unten)        |

Ausdrücklich gesperrt (`blockedPermissions`, im generierten Manifest als `tools:node="remove"`):
Standort, Kamera, Mikrofon, Kontakte, Kalender, Speicher, `SYSTEM_ALERT_WINDOW`, `USE_FINGERPRINT`
(veraltet), `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `com.google.android.c2dm.permission.RECEIVE`
(Push) sowie `READ_MEDIA_IMAGES`. `allowBackup` bleibt `false`.

**`DETECT_SCREEN_CAPTURE`** (Android 14+, normale Berechtigung ohne Abfrage) erlaubt **keine**
Aufnahme oder Auslesung des Bildschirms. Sie informiert die App nur darüber, dass ein Screenshot
ihrer **eigenen** Oberfläche erstellt wurde. `expo-screen-capture` registriert diesen Melder unter
Android 14 und neuer bereits beim Laden des Moduls; ohne die Berechtigung scheitert das Laden und
damit der App-Start („Permission Denial: registerScreenCaptureObserver … requires
android.permission.DETECT_SCREEN_CAPTURE“, gefunden beim ersten Gerätetest mit einem lokalen
Debug-Build). Deshalb ist sie nicht mehr gesperrt. TagesTakt wertet Screenshot-Meldungen nicht aus
und nutzt das Modul weiterhin nur für `preventScreenCaptureAsync` (`FLAG_SECURE`): Schutz sensibler
Inhalte bzw. leere Vorschau im App-Umschalter bei eingeschalteter App-Sperre. Ein Regressionstest
(`apps/mobile/src/__tests__/app-config.test.ts`) hält diese Konfiguration fest.

`USE_FINGERPRINT` wird nur von Android 7.0–8.1 (API 24–27) für Fingerabdrücke benötigt. Ab
Android 9 genügt `USE_BIOMETRIC`. Auf Android 7–8.1 meldet die App die App-Sperre daher als
„nicht unterstützt“ (der Fehler des Biometrie-Moduls wird abgefangen) – auf dem Gerät zu prüfen,
falls ein so altes Gerät genutzt werden soll.

**Nur im Release entfernt** (Plugin `apps/mobile/plugins/with-android-release.js`, Manifest des
Build-Typs `release`): die Launcher-Badge-Berechtigungen aus Bibliotheken von
`expo-notifications` (Samsung, Huawei, Oppo, HTC, Sony, …, `READ_APP_BADGE`) und
`com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` (Play-Store-Zuordnung).
TagesTakt nutzt keine Badges (`shouldSetBadge`/`showBadge: false`) und keinen Store. Debug-Builds
behalten sie, ebenso `SYSTEM_ALERT_WINDOW` nur im Debug (Entwickler-Overlay von React Native).

**Release-Builds (eigenständige App):**

- **Nur HTTPS:** Die App startet im Release nur mit einer `https://`-Supabase-URL
  (`apps/mobile/src/lib/env.ts`). HTTP ist ausschließlich im Debug-Build und nur zu diesem
  Rechner erlaubt (`127.0.0.1`/`localhost` über `adb reverse`, Emulator `10.0.2.2`) – nie über
  WLAN, damit Tokens nicht unverschlüsselt übertragen werden. Release-Builds erlauben ohnehin
  keinen Klartext-Verkehr (`usesCleartextTraffic` nur im Debug).
- **Getrennte Pakete:** Debug `app.tagestakt.privat.dev`, Release `app.tagestakt.privat`.
- **Eigener Signierschlüssel:** Pfad, Alias und Passwörter stehen nur in einer
  `gradle.properties` außerhalb des Repositorys (`TAGESTAKT_RELEASE_STORE_FILE`,
  `…_STORE_PASSWORD`, `…_KEY_ALIAS`, `…_KEY_PASSWORD`). Fehlen sie, entsteht eine unsignierte APK –
  nie eine mit dem öffentlich bekannten Debug-Schlüssel signierte. Der Schlüssel wird vom
  Benutzer selbst erzeugt und im Passwortmanager sowie offline gesichert; `*.jks`/`*.keystore`
  sind per `.gitignore` und Secret-Scan geschützt. Ohne den Schlüssel sind keine Updates der
  installierten App möglich (nur Neuinstallation mit Verlust der lokalen App-Daten).
- **Nur der öffentliche Publishable/Anon-Key** im Bundle; die App verweigert den Start mit einem
  Secret-/Service-Role-Key.

Geprüft per `expo prebuild` (temporär, außerhalb des Repositorys): angefordert werden nur
`INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `USE_BIOMETRIC` und `VIBRATE`; alle
gesperrten tragen `tools:node="remove"`. `DETECT_SCREEN_CAPTURE` kommt erst über das Manifest von
`expo-screen-capture` hinzu. Das endgültige, per Gradle **zusammengeführte**
Manifest (inklusive Bibliotheken aus Maven) lässt sich erst in einem nativen Build prüfen (siehe
[mobile-preview-build.md](mobile-preview-build.md)).

## Website im Internet

Eine login-geschützte Website ist trotzdem **öffentlich erreichbar**: Jeder kann die Loginseite
aufrufen, Anmeldeversuche starten oder nach Schwachstellen suchen. Die Inhalte bleiben privat,
die Angriffsfläche existiert aber. Schutzmaßnahmen jetzt: keine Inhalte ohne Anmeldung,
`noindex, nofollow` (Meta, `X-Robots-Tag`, `robots.txt`), Security-Header, strikte CSP,
keine Registrierung, starke Passwortrichtlinie.

**Option für später (nicht eingebaut):** eine zusätzliche Zugriffsschicht vor der Website, z. B.
**Cloudflare Access** (Zero-Trust-Login vor der Seite, nur die eigene E-Mail erlaubt) oder ein
**VPN** (z. B. WireGuard/Tailscale), sodass die Website gar nicht öffentlich erreichbar ist.
Zusätzlich denkbar: Supabase-MFA (TOTP) für das Konto.

## Verbleibende Risiken und offene Punkte

- **Login-Rate-Limit über den Server:** Anmeldungen laufen über Server Actions; Supabase sieht
  daher die IP des Web-Servers. Ein Angreifer könnte Rate-Limits für den eigenen Login
  ausschöpfen (Verfügbarkeit, nicht Vertraulichkeit). Abhilfe später: eigene Begrenzung pro IP
  oder vorgeschaltete Zugriffsschicht.
- **Kein MFA** im MVP.
- **CSP `style-src 'unsafe-inline'`** (für React-Inline-Styles/Next.js) – Skripte sind dennoch
  nonce-geschützt.
- **Plan-Cache unverschlüsselt** in der App-Sandbox (siehe oben).
- **Tagesnotizen ohne Ende-zu-Ende-Verschlüsselung:** Sie liegen wie die Pläne im Klartext in
  der Datenbank (Supabase verschlüsselt die Speicherung, der Betreiber könnte sie technisch
  lesen). Für sehr sensible Inhalte ist das zu bedenken; eine clientseitige Verschlüsselung
  würde Suche und Export erschweren und ist bewusst nicht Teil des MVP.
- **App-Vorschau im Task-Wechsler ohne App-Sperre:** Nur bei eingeschalteter App-Sperre bleibt
  die Vorschau leer (`FLAG_SECURE`); dann sind auch Screenshots gesperrt (siehe App-Sperre).
- **`expo-notifications` bringt auf Android die Firebase-Messaging-Bibliothek mit.** Sie bleibt
  ungenutzt (keine `google-services.json`, kein Push-Token, `c2dm.RECEIVE` gesperrt), ist aber
  im Build enthalten.
- **Erinnerungen sind nicht minutengenau:** ohne Exact-Alarm-Berechtigung kann Android sie im
  Energiesparmodus verzögern.
- **Kein Audit-Log** für Änderungen; Versionen werden aber nie überschrieben.
- **Backups (Stand 08.10.2026):** Coolify sichert die Datenbank `postgres` täglich um 02:30 UTC
  lokal (7 Sicherungen) und auf S3 (privater Bucket in einem anderen Rechenzentrum, 30
  Sicherungen). Vor jeder Produktionsmigration zusätzlich „Backup Now“ mit Prüfung von Erfolg,
  S3-Upload und Inhaltsverzeichnis (`pg_restore -l`). **Offen:** eine Probe-Wiederherstellung in
  eine getrennte Datenbank.
- Supabase-Projekte im kostenlosen Cloud-Plan können bei Inaktivität pausieren – betrifft nur
  Supabase Cloud; die Produktion läuft selbst gehostet in Coolify.
- **Härtung für später** (Prüfung vom 08.10.2026, kein akuter Befund): HSTS auch für die
  API-Domain, Versionsangabe im `Server`-Header des API-Gateways ausblenden, Studio zusätzlich nur
  per IP-Freigabe oder SSH-Tunnel erreichbar machen, `ufw` als zweite Firewall neben der
  Hetzner-Cloud-Firewall (eingehend nur 22/80/443; Datenbank-Ports sind nicht veröffentlicht).
- **Eigentümer in Produktion:** Die Initialmigration wurde über den SQL-Editor von Studio
  eingespielt; alle Objekte gehören `supabase_admin`, einen Migrationsverlauf gibt es nicht.
  Migrationen laufen deshalb ebenfalls als `supabase_admin` (siehe
  [production-migration-runbook.md](production-migration-runbook.md)).
- Die Seed-Datei legt lokal einen Demo-Benutzer an – sie darf nie gegen Produktion laufen.
- **Kein Staging-System** (Entscheidung vom 08.10.2026 für den Einzelbenutzerbetrieb): Absicherung
  über lokale Tests, `db:upgrade-test`, frisches Backup vor jeder Migration, kontrollierte
  Produktionsmigration und Smoke-Test. **Empfehlung für später:** ein getrenntes Staging (eigene
  Supabase-Ressource, eigene URL/Schlüssel, eigene App-Variante), sobald weitere Nutzer, ein
  automatischer Agent oder häufigere Releases hinzukommen.

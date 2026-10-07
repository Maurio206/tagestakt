# Sicherheit

## Schutzziel

Geschützt werden die persönlichen Wochenpläne einer einzelnen Person (Dienstzeiten, Termine,
Orte, gemeinsame Zeit zu zweit, Gewohnheiten). Daraus lassen sich Anwesenheit,
Abwesenheit und Routinen ableiten – die Daten sind deshalb vertraulich zu behandeln, auch wenn
sie keine „besonderen Kategorien“ im Sinne der DSGVO sind.

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
- Prüfungen: `supabase/tests/*.test.sql` (151 pgTAP-Tests) – anonym abgewiesen, fremder
  Benutzer kann weder lesen noch ändern noch unterschieben, Eigentümer kann bearbeiten,
  Status- und Constraint-Regeln, Fokus-Erfassung (eine laufende Aktivität, keine
  Überschneidung, Serverzeit, Korrekturkennzeichen).

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

| Daten                                                                                                                          | Ort                                         | Schutz                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Zuletzt geladener **veröffentlichter** Plan (Vor-, aktuelle, nächste Woche) inkl. Titel, Zeiten, Orte, Notizen                 | AsyncStorage (App-Sandbox)                  | nur App-Sandbox / Geräteverschlüsselung; nicht zusätzlich verschlüsselt; Android-Backup deaktiviert; beim Logout gelöscht |
| Erfasste Aktivitäten dieser Wochen (Ziel, Titel, Zeiten), Wochenziele, Erinnerungs-Vorgaben, Zeitzone, letzte Synchronisierung | AsyncStorage (gleicher Eintrag)             | wie oben                                                                                                                  |
| Geräteeinstellungen (App-Sperre an/aus, Sperrzeit, Erinnerungen an/aus, „Titel zeigen“) – keine Inhalte                        | SecureStore                                 | Android Keystore; beim Logout gelöscht                                                                                    |
| Geplante lokale Erinnerungen (Zeitpunkt, kurzer Text, `kind`)                                                                  | Benachrichtigungsdienst des Betriebssystems | standardmäßig **ohne** Titel, Ort oder Notiz („Gewerbe in 10 Min.“); beim Logout gelöscht                                 |
| Abfrage-Zwischenspeicher im Arbeitsspeicher                                                                                    | RAM (TanStack Query)                        | nur solange die App läuft; beim Logout geleert                                                                            |

Auf einem gerooteten oder kompromittierten Gerät kann der Plan-Cache gelesen werden. Eine
Bildschirmsperre auf dem Gerät ist daher Voraussetzung.

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

## Lokale Erinnerungen

- Werden ausschließlich auf dem Gerät geplant (`expo-notifications`, Datums-Trigger). Kein
  Push-Dienst, kein Push-Token, kein Firebase-Projekt, keine Übertragung an Dritte.
- Inhalt standardmäßig **ohne Termininhalte**: nur Ziel bzw. Kategorie und Uhrzeit. Titel
  erscheinen nur, wenn „Titel in Erinnerungen zeigen“ auf dem Gerät ausdrücklich eingeschaltet
  ist. Der Android-Kanal ist für den Sperrbildschirm als `PRIVATE` markiert.
- Die Berechtigung wird erst angefragt, wenn Erinnerungen eingeschaltet werden.

## Android-Berechtigungen

| Berechtigung             | Zweck                                                |
| ------------------------ | ---------------------------------------------------- |
| `INTERNET`               | Verbindung zu Supabase (von Expo/React Native)       |
| `USE_BIOMETRIC`          | App-Sperre                                           |
| `POST_NOTIFICATIONS`     | lokale Erinnerungen (Abfrage erst beim Einschalten)  |
| `RECEIVE_BOOT_COMPLETED` | geplante Erinnerungen nach Neustart wiederherstellen |

Ausdrücklich gesperrt (`blockedPermissions`): Standort, Kamera, Mikrofon, Kontakte, Kalender,
Speicher, `SYSTEM_ALERT_WINDOW`, `USE_FINGERPRINT` (veraltet), `SCHEDULE_EXACT_ALARM`,
`USE_EXACT_ALARM` und `com.google.android.c2dm.permission.RECEIVE` (Push).
`allowBackup` bleibt `false`. Das endgültige, zusammengeführte Manifest lässt sich erst in einem
nativen Build prüfen (siehe [mobile-preview-build.md](mobile-preview-build.md)).

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
- **App-Vorschau im Task-Wechsler:** Android zeigt beim Wechseln ein Bild des letzten Bildschirms.
  Die App-Sperre verhindert das nicht (kein `FLAG_SECURE`, weil das auch Screenshots sperrt).
- **`expo-notifications` bringt auf Android die Firebase-Messaging-Bibliothek mit.** Sie bleibt
  ungenutzt (keine `google-services.json`, kein Push-Token, `c2dm.RECEIVE` gesperrt), ist aber
  im Build enthalten.
- **Erinnerungen sind nicht minutengenau:** ohne Exact-Alarm-Berechtigung kann Android sie im
  Energiesparmodus verzögern.
- **Wechsel einer Aktivität im Web** besteht aus zwei Aufrufen (beenden, dann starten). Schlägt
  der zweite fehl, ist die erste Aktivität beendet und es läuft keine – die Oberfläche meldet das.
- **Kein Audit-Log** für Änderungen; Versionen werden aber nie überschrieben.
- **Kein automatisches Backup-Konzept** dokumentiert; im kostenlosen Supabase-Plan regelmäßig
  selbst exportieren (z. B. `supabase db dump --data-only` lokal, nicht ins Repo).
- Supabase-Projekte im kostenlosen Plan können bei Inaktivität pausieren.
- Die Seed-Datei legt lokal einen Demo-Benutzer an – sie darf nie gegen Produktion laufen.

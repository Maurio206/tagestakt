# Einrichtung

Diese Anleitung führt von einem leeren Rechner zu einer lokal laufenden Web-App und App –
zuerst vollständig lokal (Supabase in Docker), danach mit einem eigenen Supabase-Projekt.

> Es werden **keine Deployments** und **keine kostenpflichtigen Aktionen** vorausgesetzt.
> Alle Werte in `.env.local`-Dateien bleiben auf deinem Rechner und werden nie committed.

## 1. Voraussetzungen

| Werkzeug       | Version      | Hinweis                                          |
| -------------- | ------------ | ------------------------------------------------ |
| Node.js        | 24 (≥ 22.12) | siehe `.nvmrc`                                   |
| pnpm           | 11           | `npm i -g pnpm@11` (oder `corepack enable pnpm`) |
| Docker Desktop | aktuell      | nur für das lokale Supabase                      |
| Git            | aktuell      |                                                  |
| Expo Go        | aktuell      | Android-App aus dem Play Store (für SDK 57)      |

Die Supabase CLI wird als Entwicklungsabhängigkeit mitinstalliert (`pnpm exec supabase …`).

```bash
pnpm install
```

> **Hinweis pnpm 11:** pnpm lehnt Pakete ab, die jünger als 24 Stunden sind
> (Supply-Chain-Schutz). Das ist gewollt. Falls `pnpm install` deshalb abbricht, eine etwas ältere
> Version wählen statt die Regel zu lockern.

## 2. Vollständig lokal mit Supabase in Docker

```bash
pnpm db:start     # startet Postgres, Auth, REST, Studio (lokal)
pnpm db:reset     # spielt alle Migrationen und die neutralen Beispieldaten ein
pnpm db:test      # pgTAP-Sicherheitstests (RLS, Grants, Constraints)
pnpm exec supabase status   # zeigt lokale URLs und Keys (nur lokal gültig)
```

Die lokale Konfiguration (`supabase/config.toml`) deaktiviert bereits die öffentliche
Registrierung, setzt eine Mindestpasswortlänge von 12 Zeichen und exponiert neue Tabellen nicht
automatisch.

### Lokalen Demo-Benutzer nutzen

Der Seed legt `demo@tagestakt.test` mit einem **zufälligen, unbekannten** Passwort an (im Repo
steht kein Passwort). Setze dir lokal ein eigenes Passwort, z. B. im lokalen Studio
(<http://127.0.0.1:54323> → SQL Editor):

```sql
update auth.users
   set encrypted_password = extensions.crypt('DEIN-LOKALES-TESTPASSWORT', extensions.gen_salt('bf'))
 where email = 'demo@tagestakt.test';
```

Das funktioniert nur lokal; gegen ein echtes Projekt niemals Seeds oder solche Befehle ausführen.

### Umgebungsvariablen lokal

`apps/web/.env.local` (Werte aus `pnpm exec supabase status`):

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY aus supabase status>
```

`apps/mobile/.env.local`:

```
# Android-Emulator: 10.0.2.2 · echtes Gerät im selben WLAN: IP deines Rechners
EXPO_PUBLIC_SUPABASE_URL=http://192.168.x.y:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY aus supabase status>
```

Niemals `SECRET_KEY` oder `SERVICE_ROLE_KEY` aus `supabase status` eintragen – Web und App brechen
mit einer Fehlermeldung ab, wenn sie einen solchen Schlüssel erkennen.

## 3. Eigenes Supabase-Projekt anlegen (manuell)

1. Auf <https://supabase.com> ein Konto anlegen und ein **neues Projekt** erstellen.
   - Region in der EU wählen (z. B. Frankfurt).
   - Ein starkes Datenbank-Passwort erzeugen und **nur im Passwortmanager** speichern.
   - Der kostenlose Plan reicht für den MVP. Kostenpflichtige Optionen nicht aktivieren.
2. **Data API** (Project Settings → Data API / API):
   - Exponierte Schemas: nur `public`.
   - Falls angeboten: „Automatically expose new tables and functions“ **deaktivieren**
     (die Migrationen setzen Grants ohnehin explizit).
3. **Authentication → Sign In / Providers**:
   - „**Allow new users to sign up**“ → **aus** (keine öffentliche Registrierung).
   - **E-Mail-Provider aktiviert lassen!** Achtung: In Supabase schaltet das Deaktivieren des
     E-Mail-Providers (bzw. `[auth.email] enable_signup = false` in der CLI-Konfiguration) den
     _Login_ komplett ab („Email logins are disabled“). Registrierungen werden ausschließlich über
     die globale Einstellung oben verhindert.
   - Anonyme Anmeldungen: aus. Andere Provider (Google, Apple, …): aus.
   - Passwortrichtlinie: mindestens 12 Zeichen, Groß-/Kleinbuchstaben und Ziffern.
   - Optional (sofern im Plan enthalten): „Leaked password protection“ aktivieren.
4. **Authentication → URL Configuration**: Site URL auf die spätere Web-Adresse setzen
   (lokal `http://localhost:3000`). Weitere Redirect-URLs werden aktuell nicht benötigt.

### Genau einen Benutzer anlegen

Authentication → Users → **Add user → Create new user**:

- E-Mail: deine echte Adresse
- Passwort: lang und zufällig (Passwortmanager)
- „Auto Confirm User“: an

Anschließend die **User UID** kopieren und in `apps/web/.env.local` als
`TAGESTAKT_OWNER_USER_ID` eintragen. Damit akzeptiert die Website ausschließlich dieses Konto,
selbst wenn versehentlich weitere Konten existieren sollten.

### Migrationen anwenden

```bash
pnpm exec supabase login                       # öffnet den Browser (Access Token)
pnpm exec supabase link --project-ref <ref>    # <ref> aus der Projekt-URL; fragt DB-Passwort
pnpm exec supabase db push                     # wendet supabase/migrations/* an – OHNE Seed
```

`supabase db push` spielt **keine** Seed-Daten ein (nicht `--include-seed` verwenden). Danach im
Dashboard unter **Advisors → Security Advisor** prüfen, dass keine Warnungen offen sind
(insbesondere „RLS disabled“).

Optional: Die pgTAP-Tests laufen bewusst nur lokal/CI (`pnpm db:test`), nicht gegen Produktion.

### Umgebungsvariablen für das echte Projekt

Project Settings → **API Keys**: den **Publishable Key** (`sb_publishable_…`) kopieren.
Den **Secret Key** (`sb_secret_…`) und Legacy-`service_role`-Keys **nicht** verwenden.

`apps/web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
TAGESTAKT_OWNER_USER_ID=<User UID>
```

`apps/mobile/.env.local`:

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

## 4. Web lokal starten

```bash
pnpm dev:web
```

<http://localhost:3000> öffnen → Loginseite. Nach der Anmeldung: Übersicht, Wochenplan,
Wiederholungen, Einstellungen.

Typischer Ablauf: Unter **Wiederholungen** feste Termine anlegen → „In Wochenentwurf
übernehmen“ → unter **Wochenplan** Einträge ergänzen/anpassen → Überschneidungswarnungen prüfen →
**Entwurf veröffentlichen**. Erst die veröffentlichte Version erscheint in der App.

## 5. Expo-App lokal starten

```bash
pnpm dev:mobile
```

- Im Terminal erscheint ein QR-Code. Auf dem Android-Gerät **Expo Go** öffnen und den Code
  scannen (Gerät und Rechner im selben WLAN).
- Die App nutzt nur Module, die in Expo Go enthalten sind – ein eigener Build ist für die
  Entwicklung nicht nötig.
- Bei lokalem Supabase muss `EXPO_PUBLIC_SUPABASE_URL` die **WLAN-IP** des Rechners enthalten
  (nicht `127.0.0.1`); ggf. die Windows-Firewall für Port 54321 im privaten Netzwerk freigeben.
- Nach Änderungen an `.env.local`: Dev-Server mit `pnpm dev:mobile -- --clear` neu starten.

### Android-Testgerät per USB verbinden (optional)

1. Auf dem Gerät: Einstellungen → Über das Telefon → 7× auf „Build-Nummer“ tippen
   → Entwickleroptionen → **USB-Debugging** aktivieren.
2. Android SDK Platform-Tools installieren (enthält `adb`), Gerät verbinden, Zugriff bestätigen.
3. `adb devices` zeigt das Gerät. Dann `pnpm --filter @tagestakt/mobile android`.

Für einen Emulator: Android Studio → Device Manager → virtuelles Gerät starten, dann ebenfalls
`pnpm --filter @tagestakt/mobile android`. Lokale Supabase-URL im Emulator: `http://10.0.2.2:54321`.

## 5a. Produktion (Website)

Für das Deployment der Website mit Coolify (Dockerfile, Variablen, Healthcheck, Prüfungen) siehe
[deployment-coolify.md](deployment-coolify.md). In Produktion ist `TAGESTAKT_OWNER_USER_ID`
Pflicht – ohne gültige UUID startet die Website nicht.

## 6. Später: private APK / eigener Build (noch nicht veröffentlichen)

Für den Alltag ohne Expo Go wird später ein eigener, **privater** Build erstellt – nicht über
einen App-Store, sondern als APK zur direkten Installation:

- **Variante A – EAS Build (Expo-Cloud):** `npx eas-cli login`, `npx eas-cli build:configure`,
  Profil `preview` mit `"android": { "buildType": "apk" }` und `"distribution": "internal"`,
  dann `npx eas-cli build -p android --profile preview`. Die Umgebungsvariablen
  (`EXPO_PUBLIC_*`, nur Publishable Key) werden als EAS-Umgebungsvariablen hinterlegt, nicht im Repo.
  Der kostenlose Plan hat ein begrenztes Build-Kontingent – vor der Nutzung Bedingungen prüfen.
- **Variante B – lokal:** `npx expo prebuild -p android`, eigenen Release-Keystore erzeugen
  (außerhalb des Repos aufbewahren!), `cd android && ./gradlew assembleRelease`.
  Benötigt Android Studio/SDK und JDK.
- Die APK nur auf das eigene Gerät übertragen („Installation aus unbekannten Quellen“ gezielt für
  den Dateimanager erlauben und danach wieder entziehen).

Keystores, `google-services.json`, `credentials.json` und APK/AAB-Dateien sind per `.gitignore`
ausgeschlossen und dürfen nie committed werden.

## 7. Fehlerbehebung

| Symptom                                        | Ursache / Lösung                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Login meldet „E-Mail-Anmeldung deaktiviert“    | E-Mail-Provider in Supabase wieder aktivieren (siehe Abschnitt 3).                                                     |
| „Ungültige Konfiguration … Secret“             | In einer `*_PUBLISHABLE_KEY`-Variable steht ein Secret-Key – sofort ersetzen und den Secret-Key im Dashboard rotieren. |
| App zeigt „Offline – gespeicherter Plan“       | Server nicht erreichbar (URL/IP/Firewall prüfen). Der Cache wird weiter angezeigt.                                     |
| App zeigt „Für diese Woche … kein Plan“        | Im Web wurde für die Woche noch kein Entwurf veröffentlicht.                                                           |
| `pnpm` EPERM unter Windows                     | Editor/Dev-Server schließen, `pnpm install` im Repo-Wurzelverzeichnis ausführen.                                       |
| `expo install --check` meldet Patch-Abweichung | Bei sehr neuen Expo-Patches greift die pnpm-Release-Sperre; nach 24 h `pnpm update` im Paket ausführen.                |

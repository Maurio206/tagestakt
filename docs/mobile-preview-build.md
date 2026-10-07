# Mobile App: Testen und privater Vorschau-Build

In dieser Phase wurde **keine APK gebaut oder verteilt** und kein Test auf einem echten Gerät
durchgeführt. Dieses Dokument beschreibt, was in Expo Go prüfbar ist, wie später ein privater
Build entsteht und welche Gerätetests dann nötig sind.

## 1. Was Expo Go kann – und was nicht

`pnpm dev:mobile` + Expo Go genügt für Oberfläche, Fokus-Erfassung, Plan bearbeiten, Ziele und
Offline-Verhalten. Für App-Sperre, Erinnerungen und Berechtigungen ist Expo Go nur eingeschränkt
aussagekräftig:

| Thema                  | In Expo Go                                                                                                             | Verlässlich prüfbar erst im eigenen Build  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Berechtigungen         | Es gelten die Berechtigungen der **Expo-Go-App**, nicht `app.json` (`permissions`/`blockedPermissions` wirken nicht)   | ja                                         |
| Lokale Erinnerungen    | lokal planbar; erscheinen aber als Benachrichtigung von Expo Go, im Kanal von Expo Go. Push wird ohnehin nicht genutzt | ja (Kanal „Erinnerungen“, Sperrbildschirm) |
| App-Sperre (Biometrie) | Fingerabdruck/Geräte-PIN grundsätzlich nutzbar; Gesichtserkennung unter iOS laut Expo-Dokumentation nicht in Expo Go   | ja                                         |
| Neustart des Geräts    | Erinnerungen nach Neustart nicht aussagekräftig                                                                        | ja (`RECEIVE_BOOT_COMPLETED`)              |
| Name, Symbol, Splash   | Expo Go                                                                                                                | ja                                         |

## 2. Privaten Build erstellen (später, nur nach Rückfrage)

Beide Wege erzeugen eine APK **nur für das eigene Gerät** – keine Veröffentlichung im Play Store.

**A – EAS Build (Expo-Cloud):** benötigt ein Expo-Konto; das kostenlose Kontingent ist begrenzt –
Bedingungen vorher prüfen, keine kostenpflichtigen Builds ohne Entscheidung des Benutzers. Eine
`eas.json` gibt es im Repository noch nicht; ein mögliches Profil:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    }
  }
}
```

Die Umgebungsvariablen `EXPO_PUBLIC_SUPABASE_URL` und `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
werden als EAS-Umgebungsvariablen hinterlegt – **nur der öffentliche Publishable Key**, niemals
ein Secret- oder Service-Role-Key.

**B – lokal:** `npx expo prebuild -p android`, eigenen Release-Keystore außerhalb des Repositorys
erzeugen, `cd android && ./gradlew assembleRelease`. Benötigt Android Studio/SDK und JDK. Der
Ordner `android/` ist generiert und wird nicht committed.

## 3. Nach dem Build: Berechtigungen prüfen

Das zusammengeführte Manifest enthält auch Berechtigungen aus Bibliotheken. Prüfen mit
`apkanalyzer manifest permissions <apk>` (Android SDK) oder `aapt2 dump permissions <apk>`.

| Erwartet                                                                                         | Herkunft                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `INTERNET`                                                                                       | React Native / Supabase                     |
| `USE_BIOMETRIC`                                                                                  | App-Sperre                                  |
| `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`                                                   | lokale Erinnerungen                         |
| ggf. `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `VIBRATE`, `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Bibliotheken (AndroidX, Benachrichtigungen) |

**Darf nicht enthalten sein:** Standort, Kamera, Mikrofon, Kontakte, Kalender, Speicher,
`SYSTEM_ALERT_WINDOW`, `USE_FINGERPRINT`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`,
`com.google.android.c2dm.permission.RECEIVE`. Taucht etwas Unerwartetes auf (z. B.
Launcher-Badge-Berechtigungen aus einer Bibliothek von `expo-notifications`), in
`apps/mobile/app.json` unter `blockedPermissions` ergänzen und neu bauen.

Außerdem prüfen: `android:allowBackup="false"` im Manifest.

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

**App-Sperre**

- [ ] Einschalten verlangt Entsperrung; Standard war „aus“.
- [ ] Kaltstart → gesperrt; Inhalte nicht sichtbar, TalkBack liest nur den Sperrbildschirm.
- [ ] Hintergrund kürzer/länger als die gewählte Zeit (sofort, 1 min, 5 min).
- [ ] Geräte-PIN statt Fingerabdruck → entsperrt, **keine** erneute Sperre direkt danach.
- [ ] Ausschalten verlangt Entsperrung. Gerät ohne Bildschirmsperre: verständlicher Hinweis.

**Erinnerungen**

- [ ] Berechtigungsdialog erscheint erst beim Einschalten unter „Mehr → Erinnerungen“.
- [ ] Ablehnen → Hinweis mit „Systemeinstellungen öffnen“.
- [ ] Vorab-, Beginn- und „noch nicht gestartet“-Erinnerung kommen (Abweichung von wenigen
      Minuten ist ohne Exact Alarms möglich); nach „Fokus starten“ entfällt „nicht gestartet“.
- [ ] Sperrbildschirm zeigt **keine** Titel; erst mit „Titel in Erinnerungen zeigen“.
- [ ] Gerät neu starten → kommende Erinnerungen kommen weiterhin.
- [ ] Abmelden → keine Erinnerungen mehr, App-Sperre zurückgesetzt, Plan-Cache gelöscht.

**Darstellung und Barrierefreiheit**

- [ ] Hell/Dunkel, Systemschrift 200 %, kleines und großes Display, Gesten- und
      Drei-Tasten-Navigation (nichts unter der Navigationsleiste).
- [ ] TalkBack: sinnvolle Reihenfolge, alle Symbolknöpfe beschriftet, Timer wird nicht im
      Sekundentakt vorgelesen.
- [ ] „Animationen entfernen“ (Bedienungshilfen) → Sheets ohne Animation.

## 5. Bekannte Grenzen

- Erinnerungen sind nicht minutengenau (keine Exact-Alarm-Berechtigung, bewusst).
- `expo-notifications` bündelt auf Android die Firebase-Messaging-Bibliothek; sie bleibt ohne
  `google-services.json` und ohne Push-Token ungenutzt.
- Die Vorschau im Task-Wechsler kann den letzten Bildschirm zeigen, auch bei aktiver App-Sperre.
- Offline werden keine Änderungen vorgemerkt (keine Warteschlange).

# Deployment der Website mit Coolify

Diese Anleitung beschreibt die Einstellungen für das erste Deployment der Verwaltungswebsite
(`apps/web`) auf Coolify. Die mobile App und der spätere Claude-Agent sind nicht Teil davon.

```
Browser ──HTTPS──▶ plan.north-frame.de ──▶ Coolify-Proxy ──▶ Container „tagestakt-web“ (Port 3000)
                                                                   │ HTTPS, Publishable/Anon-Key
                                                                   ▼
                                          api.plan.north-frame.de (Supabase, eigene Coolify-Ressource)
```

Supabase läuft als **getrennte Coolify-Ressource** und wird nicht in den Web-Container eingebaut.
Der Browser spricht nie direkt mit Supabase, nur mit dem Web-Server.

## 1. Anwendung in Coolify anlegen

| Einstellung                   | Wert                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Projekt                       | `TagesTakt`                                                                               |
| Environment                   | `production`                                                                              |
| Quelle                        | GitHub-Repository `Maurio206/tagestakt` (über die GitHub-App bzw. Deploy-Key von Coolify) |
| Branch                        | `main`                                                                                    |
| Build Pack                    | `Dockerfile`                                                                              |
| Base Directory                | `/` (Repository-Wurzel)                                                                   |
| Dockerfile Location           | `/Dockerfile`                                                                             |
| Ports Exposes (interner Port) | `3000`                                                                                    |
| Domain                        | `https://plan.north-frame.de`                                                             |
| Healthcheck-Pfad              | `/api/health`                                                                             |

**Healthcheck:** Das Image enthält eine eigene `HEALTHCHECK`-Anweisung, die `/api/health` mit
Node.js abfragt (curl/wget sind bewusst nicht installiert). Coolify erkennt diese Anweisung und
verwendet sie vorrangig. Der Pfad `/api/health` kann zusätzlich in Coolify eingetragen werden;
ein in Coolify konfigurierter Check mit curl/wget würde in diesem Image aber nicht funktionieren.

## 2. Umgebungsvariablen

In Coolify unter **Environment Variables** der Anwendung anlegen (Werte nie in Dateien committen):

```
NEXT_PUBLIC_SUPABASE_URL=https://api.plan.north-frame.de
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<öffentlicher Publishable-/Anon-Key>
TAGESTAKT_OWNER_USER_ID=<UUID des einzigen angelegten Supabase-Benutzers>
```

| Variable                               | Build    | Laufzeit | Hinweis                                                          |
| -------------------------------------- | -------- | -------- | ---------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | **ja**   | **ja**   | öffentlich; muss mit `https://` beginnen                         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **ja**   | **ja**   | öffentlich; nur Publishable Key oder Legacy-JWT mit Rolle `anon` |
| `TAGESTAKT_OWNER_USER_ID`              | **nein** | **ja**   | serverseitig, Pflicht in Produktion                              |

- In Coolify heißen die Schalter je nach Version „Build Variable?“ bzw. „Available at Buildtime“
  und „Available at Runtime“. Die beiden `NEXT_PUBLIC_*`-Variablen brauchen **beides**: Next.js
  setzt sie beim Build in den Code ein, und die Startprüfung liest sie zur Laufzeit.
- `TAGESTAKT_OWNER_USER_ID` **nur zur Laufzeit** setzen (Build-Häkchen aus). Das Dockerfile
  deklariert sie absichtlich nicht als Build-Argument.
- Fehlt eine Variable oder ist sie ungültig, bricht der Container beim Start mit einer klaren
  Meldung im Coolify-Log ab (`[tagestakt] Konfigurationsfehler …`) – die Website läuft dann nie
  ungeschützt an. Fehlen die `NEXT_PUBLIC_*`-Werte schon beim Build, bricht der Build ab.

### Woher kommen die Werte?

- **Öffentlicher Schlüssel:** Bei selbstgehostetem Supabase ist das je nach Version ein
  Publishable Key (`sb_publishable_…`) oder der **anon key** (ein JWT mit Rolle `anon`). In der
  Supabase-Ressource in Coolify findest du ihn unter den Umgebungsvariablen der Ressource
  (bei der Coolify-Vorlage typischerweise `SERVICE_SUPABASEANON_KEY`).
- **Owner-UUID:** Supabase Studio → Authentication → Users → dein Benutzer → „User UID“.

### Was niemals gesetzt wird

- **Keine** Secret- oder Service-Role-Keys (`sb_secret_…`, `service_role`-JWT, bei der
  Coolify-Vorlage z. B. `SERVICE_SUPABASESERVICE_KEY`), **kein** `SUPABASE_SECRET_KEY`,
  **kein** `JWT_SECRET`, **keine** Datenbankpasswörter. Die Website braucht sie nicht; wird ein
  solcher Schlüssel als öffentlicher Schlüssel eingetragen, verweigert sie den Start.
- **Keine** Login-E-Mail und **kein** Passwort als Umgebungsvariable – die Anmeldung erfolgt
  ausschließlich über das Login-Formular.
- **Keine** echten Werte in `.env`-Dateien im Repository. `.env.example` enthält nur Platzhalter.

## 3. Supabase-Einstellungen prüfen (selbstgehostet)

In der Supabase-Ressource (Auth/GoTrue):

- Registrierung deaktiviert (`DISABLE_SIGNUP=true` bzw. „Allow new users to sign up“ aus).
- E-Mail-Login **aktiviert** lassen (`ENABLE_EMAIL_SIGNUP` bzw. E-Mail-Provider an) – sonst ist
  auch die Anmeldung gesperrt. Siehe Hinweis in [setup.md](setup.md).
- `SITE_URL` auf `https://plan.north-frame.de` setzen.
- Der Web-Container muss `https://api.plan.north-frame.de` erreichen können (gleicher Server:
  DNS/Proxy so konfiguriert, dass der Aufruf von innen funktioniert).

## 4. Deployment

> **Reihenfolge bei Versionen mit neuer Migration** (z. B. Fokus-Erfassung,
> `20261007120000_focus_tracking_and_goals.sql`): **zuerst** die Migration gemeinsam mit dem
> Benutzer nach [production-migration-runbook.md](production-migration-runbook.md) anwenden und
> prüfen, **danach** die Website deployen. Die neue Website liest `activity_sessions` und die
> neuen `user_settings`-Spalten; ohne Migration zeigen Übersicht und Auswertung eine
> Fehlermeldung (keine Datenänderung). Die Migration ist rein additiv – die bisherige Website
> läuft mit der migrierten Datenbank unverändert weiter.
>
> Das Image baut zusätzlich das Workspace-Paket `packages/design-tokens` (im `Dockerfile`
> bereits berücksichtigt). Schriften (Geist) und Symbole (Lucide) werden mitgebündelt – es werden
> keine externen Ressourcen geladen, die CSP bleibt unverändert.

1. Variablen wie oben setzen.
2. **Deploy** auslösen. Coolify baut das Image aus dem `Dockerfile` im Repository-Wurzelverzeichnis:
   - `pnpm install --frozen-lockfile` nur für `@tagestakt/web` und seine Workspace-Pakete,
   - `next build` im Standalone-Modus,
   - schlankes Laufzeit-Image (Node.js 22, Benutzer `node`, `tini` als PID 1,
     Start mit `node apps/web/server.js` auf Port 3000).
3. Im Deployment-Log auf `✓ Ready` achten, nicht auf `Konfigurationsfehler`.

Lokal lässt sich dasselbe Image so prüfen (nur Platzhalter verwenden):

```bash
docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.test --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_platzhalter_test -t tagestakt-web:test .
```

```bash
docker run --rm -p 3000:3000 -e NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.test -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_platzhalter_test -e TAGESTAKT_OWNER_USER_ID=00000000-0000-4000-8000-000000000000 tagestakt-web:test
```

## 5. Prüfungen nach dem Deployment

| Prüfung                                                                         | Erwartung                                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `https://plan.north-frame.de/api/health`                                        | HTTP 200, `{"status":"ok","service":"tagestakt-web"}`                                                              |
| `https://plan.north-frame.de/login`                                             | Loginseite erreichbar, kein „Registrieren“                                                                         |
| `https://plan.north-frame.de/` und `/wochenplan` ohne Anmeldung                 | Weiterleitung auf `/login`, keine Planinhalte                                                                      |
| Anmeldung mit dem angelegten Benutzer                                           | Übersicht wird angezeigt                                                                                           |
| Anmeldung mit einem anderen, gültigen Supabase-Konto (falls zum Test vorhanden) | „Dieses Konto ist für TagesTakt nicht freigeschaltet.“                                                             |
| Browser-Quelltext (`Strg+U`) und Entwicklerwerkzeuge                            | keine Owner-UUID, keine Secret-Keys, keine Passwörter; Cookies nicht per `document.cookie` lesbar                  |
| Coolify-Logs                                                                    | keine Tokens, Passwörter oder Termininhalte                                                                        |
| Response-Header (Entwicklerwerkzeuge → Netzwerk)                                | `Content-Security-Policy`, `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, `Strict-Transport-Security` |

Der öffentliche Schlüssel und die Supabase-URL dürfen im Client-Code auftauchen – sie sind
öffentlich und schützen nichts; der Schutz erfolgt über Anmeldung, Owner-Prüfung und RLS.

## 6. Fehlerbehebung

| Symptom                                                                          | Ursache / Lösung                                                                                                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Build bricht ab: „…müssen als Build-Argumente gesetzt sein“                      | `NEXT_PUBLIC_*` in Coolify zusätzlich als Build-Variable markieren.                                                                          |
| Container startet nicht, Log: `TAGESTAKT_OWNER_USER_ID fehlt` / `… gültige UUID` | Variable zur Laufzeit setzen bzw. UUID prüfen.                                                                                               |
| Log: „… Secret-/Service-Role-Key …“                                              | Falscher Schlüssel eingetragen – durch den anon-/Publishable Key ersetzen. Falls ein Secret-Key irgendwo sichtbar war: in Supabase rotieren. |
| Log: „… muss in Produktion mit https:// beginnen“                                | `NEXT_PUBLIC_SUPABASE_URL` auf die HTTPS-Adresse setzen.                                                                                     |
| Seiten liefern 503 „Konfiguration unvollständig“                                 | Laufzeitvariablen prüfen und neu deployen.                                                                                                   |
| Login meldet „Anmeldedienst nicht erreichbar“                                    | Container erreicht `api.plan.north-frame.de` nicht (DNS/Proxy/Zertifikat prüfen).                                                            |
| Login meldet „E-Mail-Anmeldung deaktiviert“                                      | E-Mail-Provider in Supabase wieder aktivieren.                                                                                               |

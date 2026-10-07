# Design und Fokus-Erfassung – Überblick

Diese Phase führt ein verbindliches Designsystem, die Neugestaltung von Website und App sowie die
Erfassung tatsächlicher Zeit für die drei Lebensziele **Gewerbe, Sport und Laila** ein.

| Dokument                                   | Inhalt                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| [mobbin-research.md](mobbin-research.md)   | Recherche mit Mobbin MCP, Muster, Antworten auf die Leitfragen      |
| [design-artifact.md](design-artifact.md)   | Design-Artefakt (Mobile und Web), Layout- und Navigationsmodell     |
| [design-system.md](design-system.md)       | Markenidee, Tokens (Farben, Typografie, Abstände, Motion …)         |
| [ui-spec.md](ui-spec.md)                   | Bildschirme, Komponenten, Zustände, Texte, Barrierefreiheit         |
| [visual-qa.md](visual-qa.md)               | Visuelle Prüfung der Umsetzung gegen das Artefakt                   |
| [../notes-roadmap.md](../notes-roadmap.md) | Konzept für Notizbücher, Import (OneNote), Export – nicht umgesetzt |

## Bestandsaufnahme vor der Umsetzung (Phase 1)

Ausgangsstand: `main` = `c25e022` (produktiv). Gelesen wurden alle Dokumente, die Initialmigration,
die pgTAP-Tests, `packages/schedule-schema`, sämtliche Web- und Mobile-Dateien und die Tests.

**Wiederverwendet ohne Änderung des Verhaltens**

- **Authentifizierung und Owner-Schutz:** `apps/web/src/proxy.ts`, `src/server/auth.ts`
  (`authorizedClient()`), `src/server/owner.ts`; Mobile-Session in SecureStore
  (`src/lib/secure-storage.ts`, `src/lib/supabase.ts`). Neue Server Actions und Mobile-Aufrufe
  laufen ausschließlich über diese Wege.
- **RLS und Grants:** Muster der Initialmigration (vier getrennte Policies, `revoke all` +
  gezielte Grants, Trigger im Schema `private`, RPCs als `SECURITY INVOKER`). Die neue Tabelle
  folgt exakt diesem Muster.
- **Versionierung:** `create_schedule_draft`, `publish_schedule_week`, Trigger
  `guard_schedule_entry` (veröffentlichte Inhalte schreibgeschützt, nur `completion_status`
  änderbar). Die mobile Bearbeitung nutzt dieselben RPCs – keine Umgehung.
- **Zeitlogik:** `packages/schedule-schema/src/time.ts` und `schedule.ts` (Europe/Berlin,
  Sommer-/Winterzeit, Wochen- und Tagesgrenzen, `getCurrentEntry`, `getNextEntry`,
  Vereinigungsminuten). Neue Zielberechnungen bauen darauf auf.
- **Validierung:** gemeinsame Zod-Schemas (`scheduleEntryInputSchema` u. a.) für Web und App.
- **Offline-Cache:** `apps/mobile/src/lib/plan-cache.ts` (nur veröffentlichte Pläne, beim
  Abmelden gelöscht); wird um erfasste Sitzungen erweitert, alte Cache-Stände werden migriert.
- **Sicherheitsheader und CSP:** `src/lib/security-headers.ts`, unverändert streng.

**Beobachtete Ausgangslage, die diese Phase adressiert**

- Kategorien: zwölf, davon `business`, `sport`, `relationship` als Zielkategorien.
- `completion_status` (`planned` / `completed` / `skipped`) ist ein Planstatus, **keine**
  erfasste Zeit. Bisher galt „erledigt“ als absolvierte Gewerbezeit – das wird durch echte
  Zeiterfassung ersetzt (Plan und Ist bleiben getrennt).
- Gewerbeziel: `weekly_business_target_minutes`, Standard 1200 (= 20 h); bleibt erhalten.
  Ein Ziel von 0 wurde bisher als „erreicht“ gewertet – künftig „kein Ziel festgelegt“.
- Web-Navigation: einfache Kopfzeile ohne Einklappen; Mobile: vier Text-Tabs ohne Icons.
- Bekannter Fehler: Datumsfeld im Wocheneditor zeigte nach „Folgewoche“ den alten Montag
  (unkontrolliertes Feld blieb bei Client-Navigation stehen).
- Expo-Berechtigungen: `USE_BIOMETRIC`, `USE_FINGERPRINT`, `POST_NOTIFICATIONS` waren gesperrt;
  `allowBackup: false`.

## Umsetzungsstand dieses Branches

| Bereich          | Ergebnis                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Datenbank        | `activity_sessions`, Ziele für Sport/Laila, Erinnerungs-Vorgaben – eine additive Migration, pgTAP-Tests                                                                                                                     |
| Gemeinsame Logik | Zielstatus, Plan/Ist, Erinnerungsplanung, Wiederholungen an mehreren Wochentagen (`packages/schedule-schema`)                                                                                                               |
| Designsystem     | `packages/design-tokens` (Web: CSS-Variablen, App: Theme)                                                                                                                                                                   |
| Website          | Neugestaltung aller Seiten, Fokus-Timer, Auswertung, Ziele und Erinnerungen in den Einstellungen                                                                                                                            |
| App              | Tabs Jetzt/Tag/Woche/Mehr, Fokus-Erfassung, Plan bearbeiten (Entwurf), Ziele, Wochenbilanz                                                                                                                                  |
| App, nur lokal   | App-Sperre (Standard aus), lokale Erinnerungen ohne Termininhalte (Standard aus)                                                                                                                                            |
| Fokusfläche      | Startseite (Web) und „Jetzt“ (App): aktueller Block groß, Nachbarn unscharf, Wechsel an der Blockgrenze ohne Neuladen (`getFocusState`)                                                                                     |
| Tagesnotiz       | `daily_notes` (eigene Migration `20261008120000`), Web: Übersicht + Wochenplan, App: Tag + Editor; nur online, nie im Cache oder in Erinnerungen                                                                            |
| Berechtigungen   | neu erlaubt: `USE_BIOMETRIC`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`; weiterhin gesperrt: `USE_FINGERPRINT`; zusätzlich gesperrt: Exact Alarms, Push (`c2dm.RECEIVE`), `READ_MEDIA_IMAGES`, `DETECT_SCREEN_CAPTURE` |

Visuelle Prüfung: [visual-qa.md](visual-qa.md).

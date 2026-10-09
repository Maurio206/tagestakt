# Claude-Wochenplaner

„Woche mit Claude planen“ (Website, `/planen`) erstellt aus den eigenen Einstellungen, Regeln und
Wiederholungen einen **Entwurf** für genau eine Kalenderwoche. Veröffentlicht wird ausschließlich
nach Prüfung durch einen ausdrücklichen Klick auf „Wochenplan veröffentlichen“. Danach zeigen
Website, Android-App und Widget denselben veröffentlichten Plan.

## Ablauf und Datenfluss

```
Browser (/planen) ──Server Action──▶ Next.js-Server (apps/web/src/server)
  1. authorizedClient(): Sitzung serverseitig geprüft, nur TAGESTAKT_OWNER_USER_ID
  2. readPlannerConfig(): ANTHROPIC_API_KEY vorhanden? (sonst klare Meldung, kein Absturz)
  3. loadPlanningContext(): eigene user_settings, planning_preferences, planning_goal_slots,
     aktive recurring_commitments (RLS, Publishable Key + Benutzersitzung)
  4. getMissingPlanningRequirements() / findPlanningConflicts(): fehlt etwas oder ist die Woche
     nicht erfüllbar → Liste mit Links, keine Anfrage an Claude
  5. Auftrag reservieren (ein laufender je Benutzer, höchstens 8 je Stunde), Antwort an Browser
  6. Hintergrund (next/server `after`):
       buildPlannerModelInput() ──▶ Claude Messages API (offizielles SDK, strukturierte Ausgabe)
       parsePlannerProposal() + materializeProposal()  – strenge, deterministische Prüfung
       bei Fehlern: genau ein Korrekturversuch mit den Prüffehlern, sonst nichts speichern
       save_generated_schedule_draft()  – atomar, mit erwartetem Entwurfsstand (TT008)
Browser pollt /planen (alle 5 s) ──▶ Prüfübersicht, Vorschau, „Wochenplan veröffentlichen“
  publish_reviewed_schedule_week(id, Prüfstand) – nur der angezeigte Stand, idempotent
App/Widget ──▶ lesen wie bisher nur status = 'published' (keine Änderung nötig)
```

Code: `packages/schedule-schema/src/planner.ts` (Regeln, Prüfung, Modell-Eingabe; ohne Netzwerk),
`apps/web/src/server/planner/*` (Konfiguration, Prompt, SDK-Aufruf, Aufträge, Ablauf),
`apps/web/src/server/data/planner.ts`, `apps/web/src/server/actions/planner.ts`,
`apps/web/src/app/(geschuetzt)/planen/page.tsx`, Regeln unter Einstellungen → „Planungsregeln“.

## Eingaben des Planers

| Quelle                                  | genutzt für                                                              |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `user_settings.timezone`                | muss `Europe/Berlin` sein (Planungszeitzone)                             |
| `user_settings.weekly_*_target_minutes` | Gewerbe-Minimum (Pflicht), Sport-/Laila-Ziel (Anzeige „fehlt“)           |
| `recurring_commitments` (aktiv)         | feste Termine der Woche, z. B. Dienst – unverändert übernommen           |
| `planning_preferences`                  | Gewerbe: Rahmen, Blocklängen, Tages-/Wochenendgrenzen, Pausen            |
| `planning_goal_slots` (Training, Laila) | je Wochentag: verbindlich/optional, Dauer, Zeitfenster, sichtbarer Titel |

Fehlt eine Angabe, wird **nicht geraten**: Die Seite listet die fehlenden Punkte mit Link zum
passenden Eingabefeld. Dienst, mindestens ein verbindlicher Trainingstag und mindestens ein
verbindlicher Laila-Tag sind Pflichtbestandteile; ohne sie ist kein Entwurf veröffentlichbar.

## Was an Anthropic übertragen wird – und was nicht

Übertragen (`PlannerModelInput`): Zeitzone, Woche, je Tag die belegten Zeiten mit **neutraler**
Art („Dienst“, „Termin“, „Schlaf“ …), Gewerbe-Minimum und -Regeln, die Zeitfenster als
`sport-2026-10-12` bzw. `relationship-2026-10-16` mit Dauer und „verbindlich/optional“ sowie die
Wochenziele in Minuten.

**Nie übertragen:** Benutzer-ID, E-Mail, Auth-Daten, Tokens, Supabase-Schlüssel, interne IDs,
Titel, Notizen und Orte von Terminen, die Slot-Titel (z. B. „Zeit mit Laila“ – an Claude geht nur
„Beziehungszeit“), Tagesnotizen, erfasste Aktivitäten, frühere Pläne. Damit können Texte aus der
Datenbank auch keine Anweisungen an das Modell sein (Prompt-Injection).

## Strukturierte Antwort und Prüfung

- Claude antwortet über `output_config.format` mit einem festen JSON-Schema
  (`PLANNER_PROPOSAL_JSON_SCHEMA`): Wochenbeginn, Blöcke (`business`/`sport`/`relationship`,
  Slot, Datum, Beginn/Ende, Titel, kurze Begründung), erreichte/fehlende Minuten je Ziel,
  Hinweise, Konflikte, Zusammenfassung.
- Der Server prüft unabhängig davon mit Zod (`.strict()`: unbekannte Felder → abgelehnt;
  Längen, Anzahl, Kategorien, Uhrzeiten) und danach deterministisch mit der gemeinsamen
  Zeitlogik: Woche, Zeitumstellung, Vergangenheit, Gewerbe-Rahmen/-Längen/-Tagesgrenzen,
  Gewerbe-Minimum, Slot-Fenster und exakte Dauer, Pflicht-Slots, höchstens ein Block je Ziel und
  Tag, keine Überschneidungen (inklusive Pausen) mit festen Terminen und untereinander.
- Feste Termine plant nie das Modell; der Server übernimmt sie selbst. Titel für Training und
  Laila stammen aus den Einstellungen, Modelltext wird einzeilig ohne Steuerzeichen gespeichert
  und von React nur als Text dargestellt (nie HTML).
- Jede Abweichung → nichts wird gespeichert. Höchstens ein Korrekturversuch mit der Fehlerliste.

## Prüfübersicht vor dem Veröffentlichen

`evaluatePlanDraft` bewertet den gespeicherten Entwurf (auch nach manuellen Änderungen):
Dienst vollständig, Trainingstage erfüllt, Laila-Tage erfüllt, Gewerbe geplant (Stunden und
Minuten), Gewerbe-Minimum erreicht, Dienst nicht als Gewerbe gezählt, Überschneidungen,
offene Entscheidungen. „Wochenplan veröffentlichen“ ist nur aktiv, wenn alle Pflichtregeln
erfüllt sind; der Server prüft das beim Klick erneut.

## Versionen, Nebenläufigkeit, Fehler

- Ein Planungsergebnis wird immer **neue Entwurfsversion** bzw. ersetzt nur den eigenen Entwurf
  (`save_generated_schedule_draft`). Veröffentlichte Versionen bleiben unverändert sichtbar, bis
  der Benutzer veröffentlicht.
- **Prüfstand** (`schedule_week_fingerprint`): SHA-256 über Woche, Version und alle Einträge.
  „Neu planen“ und „Veröffentlichen“ senden den angezeigten Stand mit; hat sich der Entwurf
  inzwischen geändert (anderer Tab, Bearbeitung, paralleler Lauf) → `TT008`, nichts passiert.
- Beide RPCs nehmen eine Advisory-Sperre je Benutzer und Woche. Gleichzeitige Planungen → genau
  ein Entwurf; doppelte Freigabe → harmlos (idempotent); Freigabe parallel zu Neu-Planen → genau
  eines gelingt (`pnpm db:concurrency-test`).
- Aufträge liegen nur im Speicher des Web-Servers (ein Prozess, ein Benutzer). Nach einem
  Neustart ist ein laufender Auftrag verloren – gespeichert wurde dann nichts.
- Zeitlimits: 180 s je Anfrage (SDK wiederholt Verbindungs-/Lastfehler höchstens zweimal),
  8 min je Auftrag; hängende Aufträge gelten nach 10 min als fehlgeschlagen.
- Fehlermeldungen sind feste deutsche Texte ohne interne Details (fehlender/abgelehnter
  Schlüssel, Auslastung, Zeitüberschreitung, Ablehnung, ungültige Antwort, geänderter Entwurf).

## Modell und Konfiguration

- Server-Variablen: `ANTHROPIC_API_KEY` (Pflicht für den Planer, Secret), `ANTHROPIC_MODEL`
  (optional, Standard `claude-opus-5-5`). Siehe [deployment-coolify.md](deployment-coolify.md).
- Adaptive Denkweise (Standard des Modells), `effort: "high"`, Streaming mit `finalMessage()`.
- Für unterstützte Modelle ist die **serverseitige Ausweichlösung** aktiviert
  (`fallbacks: "default"`, Beta `server-side-fallback-2026-07-01`): Lehnt das Modell eine Anfrage
  aus Richtliniengründen ab, versucht Anthropic serverseitig ein Ersatzmodell.
- Protokolliert werden nur Fehlerart, HTTP-Status und Anzahl der Prüffehler – nie Prompt,
  Antwort, Termine, Titel, Notizen, Tokens oder Schlüssel.

## Bekannte Grenzen

- Einzeltermine (manuelle Einträge) eines vorhandenen Entwurfs bzw. der veröffentlichten
  Version werden beim Planen **nicht** übernommen; „Neu planen“ ersetzt den Entwurf vollständig
  (Rückfrage). Einzeltermine nach dem Planen im Entwurf ergänzen.
- Planbar sind die laufende und die nächsten vier Wochen; in der laufenden Woche nur die Zeit ab
  jetzt (verbindliche Blöcke an vergangenen Tagen → Konflikt, Entscheidung durch den Benutzer).

import type { Metadata } from "next";

import {
  type IsoWeekday,
  type PlannerSlotGoal,
  type PlanningGoalSlot,
  type PlanningPreferences,
  SLOT_GOAL_LABELS,
  formatLocalDateShort,
  formatTime,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import Link from "next/link";

import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/notice";
import {
  type GoalSlotDefaults,
  GoalSlotsForm,
  type PlanningRulesDefaults,
  PlanningRulesForm,
} from "@/components/planning-rules-form";
import { GoalSettingsForm, ReminderSettingsForm } from "@/components/settings-form";
import { logoutAction } from "@/server/actions/auth";
import { revokeConnectorGrantAction } from "@/server/actions/connector";
import { saveGoalSlotsAction, savePlanningPreferencesAction } from "@/server/actions/planner";
import { saveGoalsAction, saveRemindersAction } from "@/server/actions/settings";
import { requireUser } from "@/server/auth";
import { type ConnectorOverview, getConnectorOverview } from "@/server/data/connector";
import { getPlanningRules } from "@/server/data/planner";
import { getSettings } from "@/server/data/settings";
import { settle } from "@/server/settle";

export const metadata: Metadata = { title: "Einstellungen" };

/** Minuten → Stundenfeld („20“, „2,5“); kein Ziel → leer. */
function hoursField(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "";
  return String(Math.round((minutes / 60) * 100) / 100).replace(".", ",");
}

/** Gespeicherte Regeln als Formularwerte; nicht gespeichert → leer (nichts wird vorgeschlagen). */
function rulesDefaults(preferences: PlanningPreferences | null): PlanningRulesDefaults {
  const text = (value: number | undefined) => (value === undefined ? "" : String(value));
  return {
    businessEarliestStart: preferences?.businessEarliestStart ?? "",
    businessLatestEnd: preferences?.businessLatestEnd ?? "",
    businessMinBlockMinutes: text(preferences?.businessMinBlockMinutes),
    businessMaxBlockMinutes: text(preferences?.businessMaxBlockMinutes),
    businessMaxDailyMinutes: text(preferences?.businessMaxDailyMinutes),
    businessSaturdayMaxMinutes: text(preferences?.businessSaturdayMaxMinutes),
    businessSundayMaxMinutes: text(preferences?.businessSundayMaxMinutes),
    bufferMinutes: text(preferences?.bufferMinutes),
  };
}

function slotDefaults(
  slots: readonly PlanningGoalSlot[],
  goal: PlannerSlotGoal,
): GoalSlotDefaults[] {
  return ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday: IsoWeekday) => {
    const slot = slots.find((s) => s.goal === goal && s.weekday === weekday);
    return {
      weekday,
      active: Boolean(slot),
      requirement: slot?.requirement ?? "required",
      title: slot?.title ?? SLOT_GOAL_LABELS[goal],
      duration: slot ? String(slot.durationMinutes) : "",
      start: slot?.windowStart ?? "",
      end: slot?.windowEnd ?? "",
    };
  });
}

/** Zeitpunkt kurz und lesbar, z. B. „Mo. 12.10. 18:05“. */
function shortDateTime(iso: string): string {
  return `${formatLocalDateShort(toLocalDate(new Date(iso)))} ${formatTime(iso)}`;
}

const CONNECTOR_FALLBACK: ConnectorOverview = { configured: false, misconfigured: false };

export default async function SettingsPage() {
  const [user, settings, loadedRules, loadedConnector] = await Promise.all([
    requireUser(),
    getSettings(),
    // Ein Ladefehler der Planungsregeln blockiert die übrigen Einstellungen nicht.
    settle(getPlanningRules(), { preferences: null, slots: [] }),
    settle(getConnectorOverview(), CONNECTOR_FALLBACK),
  ]);
  const rules = loadedRules.value;
  const connector = loadedConnector.value;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Konto</p>
          <h1>Einstellungen</h1>
        </div>
      </header>

      <section className="section" id="wochenziele" aria-labelledby="ziele-titel">
        <div className="section-head">
          <h2 id="ziele-titel">Wochenziele</h2>
        </div>
        <p className="muted">
          Ziele für erfasste Zeit pro Woche. Ohne Ziel zeigt TagesTakt nur geplante und erfasste
          Zeit – nie „erreicht“.
        </p>
        <GoalSettingsForm
          action={saveGoalsAction}
          defaults={{
            business: hoursField(settings.weeklyBusinessTargetMinutes),
            sport: hoursField(settings.weeklySportTargetMinutes),
            relationship: hoursField(settings.weeklyRelationshipTargetMinutes),
          }}
        />
      </section>

      <section className="section" id="planungsregeln" aria-labelledby="regeln-titel">
        <div className="section-head">
          <h2 id="regeln-titel">Planungsregeln für die Wochenplanung</h2>
          <Link href="/planen" className="btn btn--ghost btn--sm">
            Zur Wochenplanung
          </Link>
        </div>
        <p className="muted">
          Die Wochenplanung mit Claude nutzt nur diese Angaben, deine Wochenziele und deine aktiven
          Wiederholungen (z. B. Dienst). Leere Felder gelten als nicht festgelegt – dann wird nicht
          geplant, statt Werte zu raten.
        </p>
        {loadedRules.failed ? (
          <Notice tone="error" role="alert">
            Die Planungsregeln konnten nicht geladen werden. Bitte später erneut versuchen.
          </Notice>
        ) : null}
        <h3>Gewerbe</h3>
        <PlanningRulesForm
          action={savePlanningPreferencesAction}
          defaults={rulesDefaults(rules.preferences)}
        />
        <h3>{SLOT_GOAL_LABELS.sport}</h3>
        <p className="muted small">
          Je Tag höchstens ein Block. „Verbindlich“ wird immer geplant, „optional“ nur bei genug
          freier Zeit.
        </p>
        <GoalSlotsForm
          action={saveGoalSlotsAction.bind(null, "sport")}
          goalLabel={SLOT_GOAL_LABELS.sport}
          idPrefix="training"
          slots={slotDefaults(rules.slots, "sport")}
        />
        <h3>{SLOT_GOAL_LABELS.relationship}</h3>
        <p className="muted small">
          An Claude geht nur die neutrale Bezeichnung „Beziehungszeit“ mit Zeiten – nie der Titel.
        </p>
        <GoalSlotsForm
          action={saveGoalSlotsAction.bind(null, "relationship")}
          goalLabel={SLOT_GOAL_LABELS.relationship}
          idPrefix="laila"
          slots={slotDefaults(rules.slots, "relationship")}
        />
      </section>

      <section className="section" id="claude" aria-labelledby="claude-titel">
        <div className="section-head">
          <h2 id="claude-titel">Claude-Connector</h2>
        </div>
        <p className="muted">
          Claude plant über diesen Connector die laufende und die kommenden Wochen, veröffentlicht
          gültige Pläne selbst und berichtet danach, was sich geändert hat; die vorherige Version
          bleibt archiviert. Claude sieht nur Zeiten und neutrale Arten – keine Titel, Notizen,
          Orte, Tagesnotizen oder Kontodaten.
        </p>
        {loadedConnector.failed ? (
          <Notice tone="error" role="alert">
            Der Status des Connectors konnte nicht geladen werden. Bitte später erneut versuchen.
          </Notice>
        ) : !connector.configured ? (
          <Notice tone={connector.misconfigured ? "error" : "info"}>
            {connector.misconfigured
              ? "Der Connector ist unvollständig konfiguriert und deshalb deaktiviert (siehe docs/claude-connector.md)."
              : "Der Connector ist auf diesem Server nicht eingerichtet."}
          </Notice>
        ) : (
          <>
            <dl className="details-list">
              <dt>Connector-URL</dt>
              <dd>
                <code>{connector.mcpUrl}</code>
              </dd>
            </dl>
            {connector.grants.length === 0 ? (
              <p className="small muted">Derzeit ist Claude nicht verbunden.</p>
            ) : (
              <ul className="list">
                {connector.grants.map((grant) => (
                  <li key={grant.id}>
                    <span className="list-main">
                      <span className="list-title">
                        {grant.clientName} ({grant.clientHost})
                      </span>
                      <span className="list-meta">
                        Verbunden seit {shortDateTime(grant.createdAt)} · zuletzt genutzt{" "}
                        {grant.lastUsedAt ? shortDateTime(grant.lastUsedAt) : "noch nie"} · Rechte:{" "}
                        {grant.scopes.join(", ")}
                      </span>
                    </span>
                    <ActionButton
                      action={revokeConnectorGrantAction.bind(null, grant.id)}
                      label="Zugriff widerrufen"
                      pendingLabel="Wird widerrufen …"
                      confirmMessage={`Zugriff für „${grant.clientName}“ widerrufen? Claude muss sich danach neu verbinden.`}
                      variant="danger"
                      size="sm"
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="section" aria-labelledby="erinnerungen-titel">
        <div className="section-head">
          <h2 id="erinnerungen-titel">Erinnerungen</h2>
        </div>
        <p className="muted">
          Erinnerungen löst ausschließlich die App lokal auf dem Gerät aus – ohne Push-Dienst. Dort
          schaltest du sie unter „Mehr“ für das Gerät ein. Standardmäßig enthalten sie nur Kategorie
          und Uhrzeit, keine Titel oder Notizen.
        </p>
        <ReminderSettingsForm action={saveRemindersAction} defaults={settings.reminders} />
      </section>

      <section className="section" aria-labelledby="region-titel">
        <div className="section-head">
          <h2 id="region-titel">Zeit und Sprache</h2>
        </div>
        <dl className="details-list">
          <dt>Zeitzone</dt>
          <dd>{settings.timezone}</dd>
          <dt>Sprache</dt>
          <dd>{settings.locale}</dd>
        </dl>
        <p className="muted small">
          Alle Zeiten werden in {settings.timezone} geplant und angezeigt – inklusive
          Sommer-/Winterzeit.
        </p>
      </section>

      <section className="section" aria-labelledby="sicherheit-titel">
        <div className="section-head">
          <h2 id="sicherheit-titel">Sicherheit und Datenschutz</h2>
        </div>
        <ul className="stack-tight muted">
          <li>Kein Tracking, keine Werbung, keine Analyse- oder Telemetriedienste.</li>
          <li>
            Die App-Sperre mit Fingerabdruck oder Gesichtserkennung richtest du in der App unter
            „Mehr“ ein; sie wirkt nur auf dem jeweiligen Gerät.
          </li>
          <li>Eine Registrierung ist nicht möglich; der Zugang ist auf ein Konto beschränkt.</li>
        </ul>
      </section>

      <section className="section" aria-labelledby="konto-titel">
        <div className="section-head">
          <h2 id="konto-titel">Konto</h2>
        </div>
        <p>
          Angemeldet als <strong>{user.email ?? "unbekannt"}</strong>
        </p>
        <form action={logoutAction}>
          <button type="submit" className="btn btn--danger">
            Abmelden
          </button>
        </form>
        {!settings.persisted ? (
          <Notice tone="info">
            Es wurden noch keine Einstellungen gespeichert; angezeigt werden die Standardwerte.
          </Notice>
        ) : null}
      </section>
    </>
  );
}

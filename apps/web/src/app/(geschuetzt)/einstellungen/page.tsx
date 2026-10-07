import type { Metadata } from "next";

import { Notice } from "@/components/notice";
import { GoalSettingsForm, ReminderSettingsForm } from "@/components/settings-form";
import { logoutAction } from "@/server/actions/auth";
import { saveGoalsAction, saveRemindersAction } from "@/server/actions/settings";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/data/settings";

export const metadata: Metadata = { title: "Einstellungen" };

/** Minuten → Stundenfeld („20“, „2,5“); kein Ziel → leer. */
function hoursField(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "";
  return String(Math.round((minutes / 60) * 100) / 100).replace(".", ",");
}

export default async function SettingsPage() {
  const [user, settings] = await Promise.all([requireUser(), getSettings()]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Konto</p>
          <h1>Einstellungen</h1>
        </div>
      </header>

      <section className="section" aria-labelledby="ziele-titel">
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

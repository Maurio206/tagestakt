import type { Metadata } from "next";

import { SettingsForm } from "@/components/settings-form";
import { logoutAction } from "@/server/actions/auth";
import { saveSettingsAction } from "@/server/actions/settings";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/data/settings";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  const [user, settings] = await Promise.all([requireUser(), getSettings()]);
  const hours = String(Math.round((settings.weeklyBusinessTargetMinutes / 60) * 100) / 100).replace(
    ".",
    ",",
  );

  return (
    <div className="stack-loose">
      <header className="page-header">
        <div>
          <p className="eyebrow">Konto</p>
          <h1>Einstellungen</h1>
        </div>
      </header>

      <section className="card stack" aria-labelledby="ziel-titel">
        <h2 id="ziel-titel">Gewerbeziel</h2>
        <SettingsForm action={saveSettingsAction} defaultHours={hours} />
      </section>

      <section className="card stack" aria-labelledby="region-titel">
        <h2 id="region-titel">Zeit und Sprache</h2>
        <dl className="details-list">
          <dt>Zeitzone</dt>
          <dd>{settings.timezone}</dd>
          <dt>Sprache</dt>
          <dd>{settings.locale}</dd>
        </dl>
        <p className="muted">
          Alle Zeiten werden in {settings.timezone} geplant und angezeigt – inklusive
          Sommer-/Winterzeit.
        </p>
      </section>

      <section className="card stack" aria-labelledby="konto-titel">
        <h2 id="konto-titel">Konto</h2>
        <p>
          Angemeldet als <strong>{user.email ?? "unbekannt"}</strong>
        </p>
        <form action={logoutAction}>
          <button type="submit" className="button button--danger">
            Abmelden
          </button>
        </form>
      </section>
    </div>
  );
}

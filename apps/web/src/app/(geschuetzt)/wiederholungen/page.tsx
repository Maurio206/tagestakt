import {
  ISO_WEEKDAYS,
  type RecurringCommitment,
  WEEKDAY_LABELS,
  addDays,
  getWeekStart,
  recurringEndsNextDay,
} from "@tagestakt/schedule-schema";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/action-button";
import { ApplyRecurringForm } from "@/components/apply-recurring-form";
import { CategoryBadge } from "@/components/category-badge";
import { RecurringForm, type RecurringFormDefaults } from "@/components/recurring-form";
import {
  applyRecurringAction,
  createRecurringAction,
  deleteRecurringAction,
  toggleRecurringAction,
  updateRecurringAction,
} from "@/server/actions/recurring";
import { listRecurring } from "@/server/data/recurring";

export const metadata: Metadata = { title: "Wiederholungen" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function defaultsFor(item: RecurringCommitment): RecurringFormDefaults {
  return {
    title: item.title,
    category: item.category,
    weekday: String(item.weekday),
    startTime: item.start_time,
    endTime: item.end_time,
    location: item.location ?? "",
    note: item.note ?? "",
    active: item.active,
  };
}

export default async function RecurringPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const editId = typeof params.bearbeiten === "string" ? params.bearbeiten : undefined;
  const items = await listRecurring();
  const nextWeek = addDays(getWeekStart(new Date()), 7);

  return (
    <div className="stack-loose">
      <header className="page-header">
        <div>
          <p className="eyebrow">Vorlagen</p>
          <h1>Wiederholungen</h1>
        </div>
      </header>

      <section className="card stack" aria-labelledby="uebernehmen-titel">
        <h2 id="uebernehmen-titel">In einen Wochenentwurf übernehmen</h2>
        <p className="muted">
          Aktive Wiederholungen werden als Einträge in den Entwurf der gewählten Woche kopiert. Gibt
          es nur eine veröffentlichte Version, entsteht ein neuer Entwurf – die veröffentlichte
          Version bleibt unverändert, bis du den Entwurf veröffentlichst.
        </p>
        <ApplyRecurringForm action={applyRecurringAction} defaultWeek={nextWeek} />
      </section>

      <details className="card" open={items.length === 0}>
        <summary>
          <h2>Neue Wiederholung</h2>
        </summary>
        <RecurringForm
          action={createRecurringAction}
          idPrefix="neu"
          submitLabel="Wiederholung anlegen"
          defaults={{
            title: "",
            category: "duty",
            weekday: "1",
            startTime: "08:00",
            endTime: "16:00",
            location: "",
            note: "",
            active: true,
          }}
        />
      </details>

      {items.length === 0 ? <p className="muted">Noch keine Wiederholungen angelegt.</p> : null}

      {ISO_WEEKDAYS.map((weekday) => {
        const dayItems = items.filter((item) => item.weekday === weekday);
        if (dayItems.length === 0) return null;
        return (
          <section key={weekday} className="day" aria-labelledby={`wochentag-${weekday}`}>
            <h2 id={`wochentag-${weekday}`} className="day-title">
              {WEEKDAY_LABELS[weekday]}
            </h2>
            <ul className="entry-list">
              {dayItems.map((item) =>
                item.id === editId ? (
                  <li key={item.id} className="entry entry--editing">
                    <RecurringForm
                      action={updateRecurringAction.bind(null, item.id)}
                      idPrefix={`bearbeiten-${item.id}`}
                      submitLabel="Änderungen speichern"
                      defaults={defaultsFor(item)}
                      cancelHref="/wiederholungen"
                    />
                  </li>
                ) : (
                  <li key={item.id} className={`entry${item.active ? "" : " entry--inactive"}`}>
                    <div className="entry-time">
                      {item.start_time}–{item.end_time}
                      {recurringEndsNextDay(item.start_time, item.end_time) ? " (+1 Tag)" : ""}
                    </div>
                    <div className="entry-body">
                      <p className="entry-title">{item.title}</p>
                      <p className="entry-meta">
                        <CategoryBadge category={item.category} />
                        {!item.active ? <span className="tag">Inaktiv</span> : null}
                      </p>
                      {item.location ? <p className="muted">Ort: {item.location}</p> : null}
                      {item.note ? <p className="muted">{item.note}</p> : null}
                    </div>
                    <div className="entry-actions">
                      <Link
                        className="button button--ghost"
                        href={`/wiederholungen?bearbeiten=${item.id}`}
                        aria-label={`„${item.title}“ bearbeiten`}
                      >
                        Bearbeiten
                      </Link>
                      <ActionButton
                        action={toggleRecurringAction.bind(null, item.id, !item.active)}
                        label={item.active ? "Deaktivieren" : "Aktivieren"}
                        ariaLabel={`„${item.title}“ ${item.active ? "deaktivieren" : "aktivieren"}`}
                      />
                      <ActionButton
                        action={deleteRecurringAction.bind(null, item.id)}
                        label="Löschen"
                        variant="danger"
                        ariaLabel={`„${item.title}“ löschen`}
                        confirmMessage={`Wiederholung „${item.title}“ löschen? Bereits übernommene Einträge bleiben erhalten.`}
                      />
                    </div>
                  </li>
                ),
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

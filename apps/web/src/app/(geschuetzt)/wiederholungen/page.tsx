import { categoryTone } from "@tagestakt/design-tokens";
import {
  ISO_WEEKDAYS,
  type RecurringCommitment,
  WEEKDAY_LABELS,
  addDays,
  getWeekStart,
  recurringEndsNextDay,
} from "@tagestakt/schedule-schema";
import { Copy, Pencil, Repeat, Trash } from "lucide-react";
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
  duplicateRecurringAction,
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

function timeLabel(item: RecurringCommitment): string {
  return `${item.start_time}–${item.end_time}${recurringEndsNextDay(item.start_time, item.end_time) ? " (+1 Tag)" : ""}`;
}

export default async function RecurringPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const editId = typeof params.bearbeiten === "string" ? params.bearbeiten : undefined;
  const items = await listRecurring();
  const nextWeek = addDays(getWeekStart(new Date()), 7);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Vorlagen</p>
          <h1>Wiederholungen</h1>
        </div>
      </header>

      <section className="section" aria-labelledby="struktur-titel">
        <div className="section-head">
          <h2 id="struktur-titel">Wochenstruktur</h2>
          <p className="small muted">Aktive und inaktive Vorlagen je Wochentag</p>
        </div>
        {items.length === 0 ? (
          <div className="empty">
            <Repeat size={28} aria-hidden="true" className="icon" />
            <p>Noch keine Wiederholungen angelegt.</p>
          </div>
        ) : (
          <div className="week-structure">
            {ISO_WEEKDAYS.map((weekday) => (
              <section key={weekday} className="ws-day" aria-label={WEEKDAY_LABELS[weekday]}>
                <p className="eyebrow">{WEEKDAY_LABELS[weekday]}</p>
                {items
                  .filter((item) => item.weekday === weekday)
                  .map((item) => (
                    <div
                      key={item.id}
                      className={`ws-item tone-${categoryTone[item.category]}${item.active ? "" : " is-inactive"}`}
                    >
                      <b>{item.title}</b>
                      <span>
                        {timeLabel(item)}
                        {item.active ? "" : " · inaktiv"}
                      </span>
                    </div>
                  ))}
              </section>
            ))}
          </div>
        )}
      </section>

      <details className="disclosure" open={items.length === 0}>
        <summary>Neue Wiederholung</summary>
        <RecurringForm
          action={createRecurringAction}
          idPrefix="neu"
          submitLabel="Wiederholung anlegen"
          multipleWeekdays
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

      <section className="section" aria-labelledby="uebernehmen-titel">
        <div className="section-head">
          <h2 id="uebernehmen-titel">In einen Wochenentwurf übernehmen</h2>
        </div>
        <p className="muted">
          Aktive Wiederholungen werden als Einträge in den Entwurf der gewählten Woche kopiert. Gibt
          es nur eine veröffentlichte Version, entsteht ein neuer Entwurf – die veröffentlichte
          Version bleibt unverändert, bis du den Entwurf veröffentlichst.
        </p>
        <ApplyRecurringForm action={applyRecurringAction} defaultWeek={nextWeek} />
      </section>

      {ISO_WEEKDAYS.map((weekday) => {
        const dayItems = items.filter((item) => item.weekday === weekday);
        if (dayItems.length === 0) return null;
        return (
          <section key={weekday} className="day-group" aria-labelledby={`wochentag-${weekday}`}>
            <h2 id={`wochentag-${weekday}`} className="day-title">
              {WEEKDAY_LABELS[weekday]}
            </h2>
            <ul className="list">
              {dayItems.map((item) =>
                item.id === editId ? (
                  <li key={item.id} className="is-editing">
                    <h3 className="visually-hidden">„{item.title}“ bearbeiten</h3>
                    <RecurringForm
                      action={updateRecurringAction.bind(null, item.id)}
                      idPrefix={`bearbeiten-${item.id}`}
                      submitLabel="Änderungen speichern"
                      defaults={defaultsFor(item)}
                      cancelHref="/wiederholungen"
                    />
                  </li>
                ) : (
                  <li key={item.id} className={item.active ? undefined : "is-inactive"}>
                    <span className="list-time">{timeLabel(item)}</span>
                    <div className="list-main">
                      <p className="list-title">{item.title}</p>
                      <div className="list-meta">
                        <CategoryBadge category={item.category} />
                        {!item.active ? <span className="tag">Inaktiv</span> : null}
                      </div>
                      {item.location ? <p className="small muted">Ort: {item.location}</p> : null}
                      {item.note ? <p className="small muted">{item.note}</p> : null}
                    </div>
                    <div className="list-actions">
                      <Link
                        className="btn btn--ghost btn--sm"
                        href={`/wiederholungen?bearbeiten=${item.id}`}
                        aria-label={`„${item.title}“ bearbeiten`}
                      >
                        <Pencil size={16} aria-hidden="true" />
                        Bearbeiten
                      </Link>
                      <ActionButton
                        action={duplicateRecurringAction.bind(null, item.id)}
                        label="Duplizieren"
                        icon={<Copy size={16} aria-hidden="true" />}
                        variant="ghost"
                        size="sm"
                        ariaLabel={`„${item.title}“ duplizieren`}
                      />
                      <ActionButton
                        action={toggleRecurringAction.bind(null, item.id, !item.active)}
                        label={item.active ? "Deaktivieren" : "Aktivieren"}
                        size="sm"
                        ariaLabel={`„${item.title}“ ${item.active ? "deaktivieren" : "aktivieren"}`}
                      />
                      <ActionButton
                        action={deleteRecurringAction.bind(null, item.id)}
                        label="Löschen"
                        icon={<Trash size={16} aria-hidden="true" />}
                        variant="danger"
                        size="sm"
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
    </>
  );
}

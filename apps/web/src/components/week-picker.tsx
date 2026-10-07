import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/**
 * Wochenwechsel: Vorwoche / Heute / Folgewoche plus Datumsfeld (GET-Formular, ohne JavaScript).
 *
 * Das Datumsfeld ist unkontrolliert. Bei clientseitiger Navigation (z. B. „Folgewoche“)
 * behält React sonst den alten DOM-Wert – der `key` erzwingt ein neues Feld mit dem
 * Datum der angezeigten Woche, damit Feld und URL immer übereinstimmen.
 */
export function WeekPicker({
  weekStart,
  previousHref,
  todayHref,
  nextHref,
  action,
}: {
  weekStart: string;
  previousHref: string;
  todayHref: string;
  nextHref: string;
  action: string;
}) {
  return (
    <div className="toolbar">
      <nav aria-label="Woche wechseln" className="toolbar">
        <Link className="btn btn--ghost" href={previousHref}>
          <ChevronLeft size={18} aria-hidden="true" />
          Vorwoche
        </Link>
        <Link className="btn btn--secondary" href={todayHref}>
          Heute
        </Link>
        <Link className="btn btn--ghost" href={nextHref}>
          Folgewoche
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </nav>
      <form method="get" action={action} className="week-picker">
        <div className="field">
          <label htmlFor="woche-auswahl" className="visually-hidden">
            Woche wählen (beliebiger Tag)
          </label>
          <input
            key={weekStart}
            id="woche-auswahl"
            name="woche"
            type="date"
            defaultValue={weekStart}
            required
          />
        </div>
        <button type="submit" className="btn btn--secondary">
          Anzeigen
        </button>
      </form>
    </div>
  );
}

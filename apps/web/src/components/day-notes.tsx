import {
  type DailyNoteSnapshot,
  type LocalDate,
  formatLocalDateLong,
  formatLocalDateShort,
} from "@tagestakt/schedule-schema";
import { NotebookPen } from "lucide-react";
import Link from "next/link";

import { DAILY_NOTE_ANCHOR, type SaveDailyNote } from "@/lib/daily-note";

import { DailyNoteEditor } from "./daily-note-editor";

/**
 * Tagesnotizen im Wochenplan: Tagesauswahl (echte Links, per Tastatur bedienbar) und genau
 * ein Editor für den gewählten Tag – keine sieben großen Textfelder. Notizen gehören zum
 * Kalendertag, nicht zur Planversion; sie bleiben beim Veröffentlichen unverändert.
 */
export function DayNotes({
  days,
  selected,
  today,
  noteDates,
  note,
  loadError = false,
  dayHref,
  save,
}: {
  days: readonly LocalDate[];
  selected: LocalDate;
  today: LocalDate;
  noteDates: ReadonlySet<string>;
  note: DailyNoteSnapshot | null;
  loadError?: boolean;
  dayHref: (date: LocalDate) => string;
  save: SaveDailyNote;
}) {
  return (
    <section
      id={DAILY_NOTE_ANCHOR}
      className="section"
      aria-labelledby="tagesnotiz-titel"
      tabIndex={-1}
    >
      <div className="section-head">
        <h2 id="tagesnotiz-titel">Tagesnotiz</h2>
        <p className="small subtle">Gehört zum Tag, nicht zur Planversion.</p>
      </div>
      <div className="daynotes">
        <nav aria-label="Tag für die Notiz wählen">
          <ul className="daypick">
            {days.map((date) => {
              const has = noteDates.has(date);
              return (
                <li key={date}>
                  <Link
                    className="daypick-item"
                    href={dayHref(date)}
                    scroll={false}
                    aria-current={date === selected ? "date" : undefined}
                    aria-label={`${formatLocalDateLong(date)}${date === today ? " (heute)" : ""}${
                      has ? ", Notiz vorhanden" : ""
                    }`}
                  >
                    <span>
                      {formatLocalDateShort(date)}
                      {date === today ? " · heute" : ""}
                    </span>
                    {has ? (
                      <span className="daypick-has">
                        <NotebookPen size={14} aria-hidden="true" className="icon" />
                        Notiz
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {loadError ? (
          <p className="muted" role="alert">
            Die Tagesnotiz konnte nicht geladen werden. Bitte die Seite neu laden – es wurde nichts
            verändert.
          </p>
        ) : (
          <DailyNoteEditor
            key={selected}
            date={selected}
            dateLabel={formatLocalDateLong(selected)}
            initialNote={note}
            save={save}
          />
        )}
      </div>
    </section>
  );
}

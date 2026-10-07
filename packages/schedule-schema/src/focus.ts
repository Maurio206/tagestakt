/**
 * Fokusfläche der Startseite (Web) bzw. der Ansicht „Jetzt“ (App): Welcher Block steht gerade
 * im Mittelpunkt, was liegt unmittelbar davor und danach, und wann muss die Anzeige neu
 * berechnet werden? Reine Funktionen, Planungszeitzone Europe/Berlin (inkl. Zeitumstellung).
 *
 * Regeln:
 *  - Eine tatsächlich laufende Aktivität hat Vorrang vor einem nur geplanten Block.
 *  - Bei Überschneidung steht der zuletzt begonnene Block im Fokus (wie `getCurrentEntry`);
 *    die übrigen gleichzeitig laufenden Blöcke werden als Überschneidung genannt.
 *  - Blöcke sind halboffen [Beginn, Ende): Zur Endzeit ist ein Block vorbei, zur Startzeit
 *    beginnt der nächste.
 *  - „Davor“ ist nur ein Block, der heute (seit 00:00) endete; „Danach“ darf an einem
 *    späteren Tag liegen.
 *  - Es wird nie eine Aktivität „erfunden“ – freie Zeit bleibt freie Zeit.
 */
import {
  type EntryCategory,
  FORGOTTEN_ACTIVITY_MINUTES,
  MAX_ACTIVITY_DURATION_MINUTES,
  SCHEDULE_TIMEZONE,
} from "./constants";
import { formatDuration, formatLocalDateShort, formatTime } from "./format";
import { type TimedBlock, getCurrentEntry, sortEntries } from "./schedule";
import { type LocalDate, addDays, getDayBounds, toLocalDate } from "./time";

const MINUTE_MS = 60_000;

export type FocusKind =
  /** Eine Aktivität läuft (Vorrang vor dem Plan). */
  | "running"
  /** Ein geplanter Block läuft gerade. */
  | "block"
  /** Freie Zeit zwischen zwei Blöcken desselben Tages. */
  | "free"
  /** Vor dem ersten Block des Tages. */
  | "before_first"
  /** Nach dem letzten Block des Tages. */
  | "after_last"
  /** Für heute ist nichts geplant (die Woche hat aber einen veröffentlichten Plan). */
  | "day_empty"
  /** Für diese Woche ist kein Plan veröffentlicht. */
  | "no_plan";

export interface FocusEntry extends TimedBlock {
  id: string;
  category: EntryCategory;
}

export interface FocusSession {
  id: string;
  schedule_entry_id: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface FocusState<E extends FocusEntry, S extends FocusSession = FocusSession> {
  kind: FocusKind;
  /** Laufende Aktivität (nur bei `running`). */
  session?: S;
  /** Gerade laufender Planblock (bei Überschneidung der zuletzt begonnene) – auch bei `running`. */
  current?: E;
  /** Planblock, zu dem die laufende Aktivität gehört (falls im geladenen Plan). */
  linked?: E;
  /** Weitere Blöcke, die jetzt ebenfalls laufen (Überschneidung mit `current`). */
  overlapping: E[];
  /** Unmittelbar vorheriger Block: endete heute, spätestens jetzt. */
  previous?: E;
  /** Nächster Block, der nach jetzt beginnt (auch an einem späteren Tag). */
  next?: E;
  /** Beginnt `next` noch heute? */
  nextIsToday: boolean;
  /** Kalendertag von `now` in der Planungszeitzone. */
  today: LocalDate;
  /**
   * Nächster Zeitpunkt, an dem sich der Zustand ändern kann (Beginn oder Ende eines Blocks,
   * Mitternacht, Hinweisgrenzen einer laufenden Aktivität). Bis dahin ist keine Neuberechnung
   * nötig – nur Zeitwerte wie die Restzeit ändern sich.
   */
  nextChangeAt: Date;
}

function startMs(block: TimedBlock): number {
  return Date.parse(block.start_at);
}

function endMs(block: TimedBlock): number {
  return Date.parse(block.end_at);
}

export function getFocusState<E extends FocusEntry, S extends FocusSession = FocusSession>(input: {
  entries: readonly E[];
  running?: S | null;
  now: Date;
  /** Gibt es für die Woche von `now` einen veröffentlichten Plan? */
  hasPublishedPlan: boolean;
  timeZone?: string;
}): FocusState<E, S> {
  const { now, hasPublishedPlan } = input;
  const timeZone = input.timeZone ?? SCHEDULE_TIMEZONE;
  const t = now.getTime();
  const entries = sortEntries(input.entries);
  const today = toLocalDate(now, timeZone);
  const day = getDayBounds(today, timeZone);
  const dayStart = day.start.getTime();
  const dayEnd = day.end.getTime();

  const active = entries.filter((e) => startMs(e) <= t && t < endMs(e));
  const current = getCurrentEntry(active, now);
  const overlapping = current ? active.filter((e) => e.id !== current.id) : [];

  // Davor: zuletzt beendeter Block des heutigen Tages (Blöcke über Mitternacht zählen mit).
  let previous: E | undefined;
  for (const entry of entries) {
    const end = endMs(entry);
    if (end > t || end <= dayStart) continue;
    if (
      !previous ||
      end > endMs(previous) ||
      (end === endMs(previous) && startMs(entry) > startMs(previous))
    ) {
      previous = entry;
    }
  }

  const next = entries.find((entry) => startMs(entry) > t);
  const nextIsToday = next !== undefined && startMs(next) < dayEnd;
  const touchesToday = entries.some((e) => startMs(e) < dayEnd && endMs(e) > dayStart);

  // Nächste Zustandsänderung: Beginn eines Blocks, Ende eines laufenden Blocks, Mitternacht.
  let nextChange = dayEnd;
  for (const entry of entries) {
    const start = startMs(entry);
    const end = endMs(entry);
    if (start > t && start < nextChange) nextChange = start;
    if (start <= t && end > t && end < nextChange) nextChange = end;
  }

  const running = input.running && input.running.ended_at === null ? input.running : undefined;
  if (running) {
    // Hinweise „vermutlich vergessen“ (12 h) und „nur per Korrektur beendbar“ (24 h).
    const started = Date.parse(running.started_at);
    for (const minutes of [FORGOTTEN_ACTIVITY_MINUTES, MAX_ACTIVITY_DURATION_MINUTES]) {
      const at = started + minutes * MINUTE_MS;
      if (at > t && at < nextChange) nextChange = at;
    }
  }

  const base = {
    current,
    overlapping,
    previous,
    next,
    nextIsToday,
    today,
    nextChangeAt: new Date(nextChange),
  };

  if (running) {
    const linked = running.schedule_entry_id
      ? entries.find((e) => e.id === running.schedule_entry_id)
      : undefined;
    return { kind: "running", session: running, linked, ...base };
  }
  if (current) return { kind: "block", ...base };
  if (!touchesToday) return { kind: hasPublishedPlan ? "day_empty" : "no_plan", ...base };
  if (!previous && nextIsToday) return { kind: "before_first", ...base };
  if (previous && !nextIsToday) return { kind: "after_last", ...base };
  return { kind: "free", ...base };
}

/** Stabiler Schlüssel des Fokus – ändert sich genau dann, wenn ein anderer Inhalt in den Fokus rückt. */
export function getFocusKey(state: FocusState<FocusEntry>): string {
  return [state.kind, state.session?.id ?? state.current?.id ?? state.next?.id ?? "-"].join(":");
}

/** Ganze Minuten bis zu einem Zeitpunkt (aufgerundet, nie negativ). */
export function minutesUntil(iso: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / MINUTE_MS));
}

/** „in 20 Min.“, „in 1 Std. 55 Min.“, „jetzt“ */
export function formatStartsIn(iso: string, now: Date): string {
  const minutes = minutesUntil(iso, now);
  return minutes === 0 ? "jetzt" : `in ${formatDuration(minutes)}`;
}

/** Beginn relativ zu heute: „20:00“, „morgen 07:00“ bzw. „Do 15.10. 07:00“. */
export function formatStartLabel(
  iso: string,
  now: Date,
  timeZone: string = SCHEDULE_TIMEZONE,
): string {
  const date = toLocalDate(new Date(iso), timeZone);
  const today = toLocalDate(now, timeZone);
  const time = formatTime(iso, timeZone);
  if (date === today) return time;
  if (date === addDays(today, 1)) return `morgen ${time}`;
  return `${formatLocalDateShort(date)} ${time}`;
}

/** Verzögerung bis zur nächsten Neuberechnung (mindestens 0, gedeckelt für lange Wartezeiten). */
export function msUntilFocusChange(
  state: Pick<FocusState<FocusEntry>, "nextChangeAt">,
  now: Date,
  maxDelayMs = 60 * MINUTE_MS,
): number {
  return Math.min(maxDelayMs, Math.max(0, state.nextChangeAt.getTime() - now.getTime()));
}

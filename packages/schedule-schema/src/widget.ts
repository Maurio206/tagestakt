/**
 * Android-Startbildschirm-Widget („Jetzt und danach“): bereinigter Zeitplan für das native
 * Widget. Das Widget hat keinen Netzwerkzugang und keine eigene Datenquelle – die App rechnet
 * aus dem bereits geladenen Plan-Snapshot eine kurze Zeitleiste vor, das Widget wählt nur noch
 * per Zeitvergleich das passende Segment aus.
 *
 * Regeln:
 *  - Nur veröffentlichte Wochen; Entwürfe und archivierte Stände werden ignoriert.
 *  - Auswahl von aktuellem und nächstem Block exakt wie „Jetzt“ (`getFocusState`): halboffene
 *    Blöcke, bei Überschneidung der zuletzt begonnene, Zeiten in Europe/Berlin (inkl.
 *    Sommer-/Winterzeit). Laufende Aktivitäten fließen nicht ein – das Widget zeigt den Plan.
 *  - Segmentgrenzen: Beginn und Ende von Blöcken sowie Mitternacht (Beschriftung „morgen“).
 *  - Keine Notizen, Orte oder IDs. Bei aktiver App-Sperre statt des Titels nur die Kategorie.
 *  - Gültig höchstens `WIDGET_MAX_AGE_HOURS` ab dem Abruf des Plans; danach zeigt das Widget
 *    einen neutralen Zustand statt veralteter Inhalte.
 */
import {
  CATEGORY_LABELS,
  type EntryCategory,
  SCHEDULE_TIMEZONE,
  TITLE_MAX_LENGTH,
} from "./constants";
import { type FocusEntry, formatStartLabel, getFocusState } from "./focus";
import { formatTime, formatTimeRange } from "./format";

const HOUR_MS = 60 * 60_000;

/** Version des Formats zwischen App und nativem Widget. */
export const WIDGET_PAYLOAD_VERSION = 1;
/** So lange nach dem letzten erfolgreichen Abruf zeigt das Widget Planinhalte. */
export const WIDGET_MAX_AGE_HOURS = 48;
/** Obergrenze gegen ungewöhnlich große Pläne (48 h haben üblicherweise < 100 Segmente). */
export const WIDGET_MAX_SEGMENTS = 400;

/** Feste Texte des Widgets – das Config-Plugin übernimmt sie als Android-Ressourcen. */
export const WIDGET_TEXTS = {
  label: "Jetzt und danach",
  description: "Aktueller und nächster Block aus deinem veröffentlichten Wochenplan.",
  now: "Jetzt",
  next: "Danach",
  free: "Freie Zeit",
  nothingMoreToday: "Heute nichts mehr geplant",
  nothingNext: "nichts mehr geplant",
  noPlan: "Kein aktueller Wochenplan",
  stale: "Plan nicht aktuell",
  signedOut: "Nicht angemeldet",
  open: "TagesTakt öffnen",
} as const;

export interface WidgetBlockSource extends FocusEntry {
  title: string;
}

export interface WidgetWeekSource<E extends WidgetBlockSource = WidgetBlockSource> {
  status: string;
  schedule_entries: readonly E[];
}

/** Aktueller Block bzw. freie Zeit. `meta` = Kategorie und Zeit bzw. „bis 14:00“. */
export type WidgetCurrent =
  | { kind: "block"; category: EntryCategory; title: string; meta: string }
  | { kind: "free"; title: string; meta: string };

/** Nächster Block: Beginn („14:00“, „morgen 07:00“) und Text (Titel · Kategorie). */
export interface WidgetNext {
  category: EntryCategory;
  time: string;
  text: string;
}

interface SegmentRange {
  /** Beginn (ms seit Epoche, inklusive). */
  from: number;
  /** Ende (ms seit Epoche, exklusive). */
  until: number;
  /** Vorlesetext für Bedienungshilfen. */
  description: string;
}

export type WidgetSegment =
  | (SegmentRange & { kind: "plan"; current: WidgetCurrent; next: WidgetNext | null })
  | (SegmentRange & { kind: "empty" });

export interface WidgetTimeline {
  version: typeof WIDGET_PAYLOAD_VERSION;
  generatedAt: number;
  /** Ab hier gelten die Daten als veraltet (exklusive). */
  validUntil: number;
  segments: WidgetSegment[];
}

/** Was das Widget zu einem Zeitpunkt zeigt – dieselbe Auswahl trifft der native Provider. */
export type WidgetView =
  | { state: "signed_out" }
  | { state: "stale" }
  | { state: "empty"; segment: Extract<WidgetSegment, { kind: "empty" }> }
  | { state: "plan"; segment: Extract<WidgetSegment, { kind: "plan" }> };

/** Einzeilig, ohne Steuerzeichen, begrenzte Länge. */
function cleanTitle(title: string): string {
  const printable = Array.from(title, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : char;
  }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_LENGTH);
}

/** Titel nur, wenn erlaubt, vorhanden und nicht bloß die Kategorie. */
function visibleTitle(entry: WidgetBlockSource, showTitles: boolean): string | null {
  if (!showTitles) return null;
  const title = cleanTitle(entry.title);
  return title && title !== CATEGORY_LABELS[entry.category] ? title : null;
}

function describeSegment(current: WidgetCurrent, next: WidgetNext | null): string {
  const now =
    current.kind === "block"
      ? `${WIDGET_TEXTS.now}: ${current.title}, ${current.meta.replace(" · ", ", ")}.`
      : `${WIDGET_TEXTS.now}: ${current.title}, ${current.meta}.`;
  const after = next
    ? `${WIDGET_TEXTS.next}: ${next.time} ${next.text.replace(" · ", ", ")}.`
    : `${WIDGET_TEXTS.next} ${WIDGET_TEXTS.nothingNext}.`;
  return `${now} ${after}`.replace(/–/g, " bis ");
}

const EMPTY_DESCRIPTION = `${WIDGET_TEXTS.noPlan}. ${WIDGET_TEXTS.open}.`;

/**
 * Zeitleiste ab `now` bis `fetchedAt + maxAgeHours`. Liefert bei zu altem Plan eine leere
 * Segmentliste (das Widget zeigt dann „Plan nicht aktuell“).
 */
export function buildWidgetTimeline<E extends WidgetBlockSource>(input: {
  weeks: readonly WidgetWeekSource<E>[];
  fetchedAt: string | Date;
  now: Date;
  /** false bei aktiver App-Sperre: nur Kategorie und Zeit, keine Titel. */
  showTitles: boolean;
  timeZone?: string;
  maxAgeHours?: number;
}): WidgetTimeline {
  const timeZone = input.timeZone ?? SCHEDULE_TIMEZONE;
  const generatedAt = input.now.getTime();
  const fetchedAt = new Date(input.fetchedAt).getTime();
  const validUntil = fetchedAt + (input.maxAgeHours ?? WIDGET_MAX_AGE_HOURS) * HOUR_MS;
  const entries = input.weeks
    .filter((week) => week.status === "published")
    .flatMap((week) => week.schedule_entries);

  const segments: WidgetSegment[] = [];
  let t = generatedAt;
  while (Number.isFinite(validUntil) && t < validUntil && segments.length < WIDGET_MAX_SEGMENTS) {
    const now = new Date(t);
    const focus = getFocusState({ entries, now, hasPublishedPlan: true, timeZone });
    const until = Math.min(focus.nextChangeAt.getTime(), validUntil);

    let segment: WidgetSegment;
    if (!focus.current && !focus.next) {
      segment = { from: t, until, kind: "empty", description: EMPTY_DESCRIPTION };
    } else {
      let current: WidgetCurrent;
      if (focus.current) {
        const label = CATEGORY_LABELS[focus.current.category];
        const range = formatTimeRange(focus.current.start_at, focus.current.end_at, timeZone);
        const title = visibleTitle(focus.current, input.showTitles);
        current = {
          kind: "block",
          category: focus.current.category,
          title: title ?? label,
          meta: title ? `${label} · ${range}` : range,
        };
      } else {
        current = {
          kind: "free",
          title: WIDGET_TEXTS.free,
          meta:
            focus.next && focus.nextIsToday
              ? `bis ${formatTime(focus.next.start_at, timeZone)}`
              : WIDGET_TEXTS.nothingMoreToday,
        };
      }
      let next: WidgetNext | null = null;
      if (focus.next) {
        const label = CATEGORY_LABELS[focus.next.category];
        const title = visibleTitle(focus.next, input.showTitles);
        next = {
          category: focus.next.category,
          time: formatStartLabel(focus.next.start_at, now, timeZone),
          text: title ? `${title} · ${label}` : label,
        };
      }
      segment = {
        from: t,
        until,
        kind: "plan",
        current,
        next,
        description: describeSegment(current, next),
      };
    }

    // Gleiche Anzeige wie das vorige Segment (z. B. Ende eines überlappten Blocks): verlängern.
    const previous = segments[segments.length - 1];
    if (previous && displayKey(previous) === displayKey(segment)) previous.until = until;
    else segments.push(segment);
    t = until;
  }

  return { version: WIDGET_PAYLOAD_VERSION, generatedAt, validUntil, segments };
}

function displayKey(segment: WidgetSegment): string {
  return JSON.stringify({ ...segment, from: 0, until: 0 });
}

/**
 * Anzeige zu einem Zeitpunkt. Ohne Daten (abgemeldet) neutral; außerhalb der Segmente oder nach
 * Ablauf „veraltet“ – nie ein altes Segment.
 */
export function resolveWidgetView(timeline: WidgetTimeline | null, now: Date): WidgetView {
  if (!timeline) return { state: "signed_out" };
  const t = now.getTime();
  if (timeline.version !== WIDGET_PAYLOAD_VERSION || t >= timeline.validUntil) {
    return { state: "stale" };
  }
  const segment = timeline.segments.find((s) => s.from <= t && t < s.until);
  if (!segment) return { state: "stale" };
  return segment.kind === "plan" ? { state: "plan", segment } : { state: "empty", segment };
}

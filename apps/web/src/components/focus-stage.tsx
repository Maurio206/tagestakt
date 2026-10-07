"use client";

import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  CATEGORY_LABELS,
  type CompletionStatus,
  type EntryCategory,
  type FocusState,
  GOAL_KEYS,
  GOAL_LABELS,
  type GoalKey,
  formatDuration,
  formatLocalDateLong,
  formatStartLabel,
  formatStartsIn,
  formatTime,
  formatTimeRange,
  getEntryProgress,
  getFocusKey,
  getFocusState,
  getRemainingMinutes,
  getSessionMinutes,
  getWeekStart,
  isGoalKey,
  isLikelyForgotten,
  minutesUntil,
  msUntilFocusChange,
  requiresCorrectionToStop,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { Check, Link2, Play, RotateCcw, Square, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { ActionState, FormAction } from "@/lib/form";
import { evaluationPath } from "@/lib/paths";

import { ActionButton } from "./action-button";
import { CategoryBadge } from "./category-badge";
import { ToneIcon } from "./icons";
import { LiveTimer } from "./live-timer";
import { buttonClass } from "./ui";
import { MinuteClock, useMinuteNow, usePrefersReducedMotion } from "./use-clock";

/** Planblock in der Form, die die Fokusfläche braucht (ohne Notizen). */
export interface FocusStageEntry {
  id: string;
  title: string;
  category: EntryCategory;
  start_at: string;
  end_at: string;
  location: string | null;
  completion_status: CompletionStatus;
}

/** Server Actions der Übersicht; die Seite reicht sie durch (Komponenten importieren nichts aus src/server). */
export interface FocusStageServerActions {
  start: (goal: GoalKey, entryId: string | null) => Promise<ActionState>;
  stop: (sessionId: string) => Promise<ActionState>;
  discard: (sessionId: string) => Promise<ActionState>;
  switchTo: (runningId: string, goal: GoalKey, entryId: string | null) => Promise<ActionState>;
  setCompletion: (entryId: string, status: CompletionStatus) => Promise<ActionState>;
}

interface BoundActions {
  start: (goal: GoalKey, entryId: string | null) => FormAction;
  stop: (sessionId: string) => FormAction;
  discard: (sessionId: string) => FormAction;
  switchTo: (runningId: string, goal: GoalKey, entryId: string | null) => FormAction;
  setCompletion: (entryId: string, status: CompletionStatus) => FormAction;
}

type Focus = FocusState<FocusStageEntry, ActivitySession>;

function bindActions(actions: FocusStageServerActions): BoundActions {
  return {
    start: (goal, entryId) => actions.start.bind(null, goal, entryId),
    stop: (id) => actions.stop.bind(null, id),
    discard: (id) => actions.discard.bind(null, id),
    switchTo: (runningId, goal, entryId) => actions.switchTo.bind(null, runningId, goal, entryId),
    setCompletion: (entryId, status) => actions.setCompletion.bind(null, entryId, status),
  };
}

function GoalChip({ goal, children }: { goal: GoalKey; children: ReactNode }) {
  const tone = categoryTone[goal];
  return (
    <span className={`chip tone-${tone}`}>
      <ToneIcon tone={tone} size={15} />
      {children}
    </span>
  );
}

function dayPrefix(iso: string, now: Date): string {
  const date = toLocalDate(new Date(iso));
  return date === toLocalDate(now) ? "" : `${formatLocalDateLong(date)}, `;
}

// ---------------------------------------------------------------------------
// Zeitwerte mit Minutentakt (nur diese Teile rendern minütlich neu)
// ---------------------------------------------------------------------------

/** Restzeit groß in Ziffern („1:55“ bzw. „35“) mit Einheit; Screenreader lesen einen Satz. */
function RemainingBig({ entry }: { entry: FocusStageEntry }) {
  const now = useMinuteNow();
  const minutes = getRemainingMinutes(entry, now);
  const hours = Math.floor(minutes / 60);
  const digits = hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : String(minutes);
  return (
    <>
      <p className="focus-big">
        <span className="focus-digits" aria-hidden="true">
          {digits}
        </span>
        <span className="focus-unit" aria-hidden="true">
          {hours > 0 ? "Std. übrig" : "Min. übrig"} · endet um {formatTime(entry.end_at)}
        </span>
        <span className="visually-hidden">
          noch {formatDuration(minutes)}, endet um {formatTime(entry.end_at)} Uhr
        </span>
      </p>
      <div className="track" aria-hidden="true">
        <span style={{ width: `${Math.round(getEntryProgress(entry, now) * 100)}%` }} />
      </div>
    </>
  );
}

/** Countdown bis zum nächsten Block („20 Min. bis zum nächsten Block“). */
function CountdownBig({ target, label }: { target: FocusStageEntry; label: string }) {
  const now = useMinuteNow();
  const minutes = minutesUntil(target.start_at, now);
  const hours = Math.floor(minutes / 60);
  const digits = hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : String(minutes);
  return (
    <p className="focus-big">
      <span className="focus-digits" aria-hidden="true">
        {digits}
      </span>
      <span className="focus-unit" aria-hidden="true">
        {hours > 0 ? "Std." : "Min."} {label}
      </span>
      <span className="visually-hidden">
        noch {formatDuration(minutes)} {label}
      </span>
    </p>
  );
}

function StartsIn({ entry }: { entry: FocusStageEntry }) {
  const now = useMinuteNow();
  return <>{formatStartsIn(entry.start_at, now)}</>;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/**
 * Davor/Danach als lesbarer Text im Fokusblock – die unscharfen Nachbarblöcke sind nur
 * Dekoration (für Screenreader verborgen) und nie der einzige Informationsträger.
 */
function Around({ focus, now }: { focus: Focus; now: Date }) {
  const { previous, next } = focus;
  return (
    <ul className="focus-around" aria-label="Davor und danach">
      <li>
        Davor:{" "}
        {previous ? (
          <>
            <b>{previous.title}</b> bis {formatTime(previous.end_at)}
          </>
        ) : (
          "heute noch nichts"
        )}
      </li>
      <li>
        Danach:{" "}
        {next ? (
          <>
            <b>
              {formatStartLabel(next.start_at, now)} {next.title}
            </b>
            {focus.nextIsToday ? (
              <>
                {" "}
                · <StartsIn entry={next} />
              </>
            ) : null}
          </>
        ) : (
          "nichts mehr geplant"
        )}
      </li>
    </ul>
  );
}

function SpontaneousStart({ actions, size }: { actions: BoundActions; size: "lg" | "sm" }) {
  return (
    <div className="stack-tight">
      <p className="field-label">Aktivität starten</p>
      <div className="button-row">
        {GOAL_KEYS.map((goal) => (
          <ActionButton
            key={goal}
            action={actions.start(goal, null)}
            label={GOAL_LABELS[goal]}
            icon={<ToneIcon tone={categoryTone[goal]} />}
            size={size}
            variant={size === "lg" ? "secondary" : "ghost"}
            ariaLabel={`Aktivität ${GOAL_LABELS[goal]} starten`}
            pendingLabel="Wird gestartet …"
          />
        ))}
      </div>
    </div>
  );
}

/** Dekorativer, unscharfer Nachbarblock: keine Bedienelemente, für Screenreader verborgen. */
function Ghost({
  entry,
  position,
  now,
  later,
}: {
  entry: FocusStageEntry;
  position: "prev" | "next";
  now: Date;
  later?: boolean;
}) {
  const tone = categoryTone[entry.category];
  const range =
    position === "next" && later
      ? formatStartLabel(entry.start_at, now)
      : formatTimeRange(entry.start_at, entry.end_at);
  return (
    <div
      className={`focus-ghost focus-ghost--${position}${later ? " focus-ghost--later" : ""} tone-${tone}`}
      aria-hidden="true"
      inert
      data-testid={`focus-ghost-${position}`}
    >
      <span className="focus-ghost-time">{range}</span>
      <span className="focus-ghost-title">
        <b>{entry.title}</b>
        <span className="cat">
          <i className="cat-dot" />
          {CATEGORY_LABELS[entry.category]}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zustände des Fokusblocks
// ---------------------------------------------------------------------------

function RunningCard({
  focus,
  session,
  now,
  actions,
}: {
  focus: Focus;
  session: ActivitySession;
  now: Date;
  actions: BoundActions;
}) {
  const { linked, current } = focus;
  // Laufzeitabhängige Texte im Minutentakt (der Fokus selbst ändert sich nur an Grenzen).
  const clock = useMinuteNow();
  const blocked = requiresCorrectionToStop(session, clock);
  const minutes = getSessionMinutes(session, clock);
  const label = GOAL_LABELS[session.goal_category];
  const switchTarget =
    current && isGoalKey(current.category) && session.schedule_entry_id !== current.id
      ? { goal: current.category, entry: current }
      : undefined;

  return (
    <>
      <div className="focus-head">
        <GoalChip goal={session.goal_category}>{label} · Läuft</GoalChip>
        {linked ? (
          <span className="eyebrow">Plan {formatTimeRange(linked.start_at, linked.end_at)}</span>
        ) : null}
      </div>
      <h2 id="fokus-titel" className="focus-title">
        {session.title}
      </h2>
      <div className="focus-big">
        <LiveTimer startedAt={session.started_at} initialNow={now.toISOString()} />
        <span className="focus-unit">
          seit {dayPrefix(session.started_at, clock)}
          {formatTime(session.started_at)} Uhr
          {linked ? ` · Plan bis ${formatTime(linked.end_at)}` : ""}
        </span>
      </div>
      {linked ? (
        <p className="hint">
          <Link2 size={16} aria-hidden="true" className="icon" />
          Zum Planblock „{linked.title}“, {formatTimeRange(linked.start_at, linked.end_at)}
        </p>
      ) : null}
      {isLikelyForgotten(session, clock) ? (
        <p className="hint hint--warning">
          Vermutlich vergessen – bitte das Ende über „Zeit korrigieren“ eintragen.
        </p>
      ) : null}
      <div className="button-row">
        {blocked ? (
          <p className="hint">
            Läuft seit über 24 Stunden: Beenden ist nur noch über „Zeit korrigieren“ möglich.
          </p>
        ) : (
          <ActionButton
            action={actions.stop(session.id)}
            label="Beenden"
            icon={<Square size={18} aria-hidden="true" />}
            variant="primary"
            size="lg"
            pendingLabel="Wird beendet …"
          />
        )}
        <Link
          className={buttonClass("secondary", "lg")}
          href={evaluationPath(getWeekStart(new Date(session.started_at)), {
            correctId: session.id,
          })}
        >
          Zeit korrigieren
        </Link>
        <ActionButton
          action={actions.discard(session.id)}
          label="Abbrechen"
          icon={<X size={18} aria-hidden="true" />}
          variant="ghost"
          size="lg"
          confirmMessage={`Aktivität verwerfen? Die erfasste Zeit (${formatDuration(minutes)}) wird gelöscht.`}
        />
      </div>
      {switchTarget ? (
        <div className="notice">
          <div className="notice-body">
            <p className="notice-title">
              Jetzt geplant: {GOAL_LABELS[switchTarget.goal]} · {switchTarget.entry.title}
            </p>
            <p className="muted">
              {label} läuft noch. Beim Wechsel wird {label} mit der aktuellen Serverzeit beendet.
            </p>
            <div className="button-row">
              <ActionButton
                action={actions.switchTo(session.id, switchTarget.goal, switchTarget.entry.id)}
                label={`${label} beenden, ${GOAL_LABELS[switchTarget.goal]} starten`}
                variant="secondary"
                confirmMessage={`${label} beenden (${formatDuration(minutes)} erfasst) und ${GOAL_LABELS[switchTarget.goal]} starten?`}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function BlockCard({
  focus,
  entry,
  tracked,
  actions,
}: {
  focus: Focus;
  entry: FocusStageEntry;
  tracked: boolean;
  actions: BoundActions;
}) {
  const goal = isGoalKey(entry.category) ? entry.category : undefined;
  const overlapGoals = focus.overlapping.filter((e) => isGoalKey(e.category));
  return (
    <>
      <div className="focus-head">
        {goal ? (
          <GoalChip goal={goal}>{GOAL_LABELS[goal]}</GoalChip>
        ) : (
          <CategoryBadge category={entry.category} />
        )}
        <span className="eyebrow">Jetzt · {formatTimeRange(entry.start_at, entry.end_at)}</span>
      </div>
      <h2 id="fokus-titel" className="focus-title">
        {entry.title}
      </h2>
      {focus.overlapping.length > 0 ? (
        <p className="focus-overlap">
          <TriangleAlert size={16} aria-hidden="true" className="icon" />
          Überschneidung: gleichzeitig{" "}
          {focus.overlapping
            .map((e) => `„${e.title}“ (${formatTimeRange(e.start_at, e.end_at)})`)
            .join(", ")}
        </p>
      ) : null}
      <RemainingBig entry={entry} />
      {entry.location || (goal && !tracked) ? (
        <p className="focus-meta">
          {entry.location ? <span>Ort: {entry.location}</span> : null}
          {goal && !tracked ? <span>Noch nicht erfasst.</span> : null}
        </p>
      ) : null}
      <div className="button-row">
        {goal ? (
          <ActionButton
            action={actions.start(goal, entry.id)}
            label="Fokus starten"
            icon={<Play size={18} aria-hidden="true" />}
            variant="primary"
            size="lg"
            pendingLabel="Wird gestartet …"
          />
        ) : null}
        {overlapGoals.map((other) => (
          <ActionButton
            key={other.id}
            action={actions.start(other.category as GoalKey, other.id)}
            label={`Fokus für „${other.title}“ starten`}
            icon={<ToneIcon tone={categoryTone[other.category]} />}
            variant={goal ? "secondary" : "primary"}
            size="lg"
            pendingLabel="Wird gestartet …"
          />
        ))}
        {entry.completion_status !== "completed" ? (
          <ActionButton
            action={actions.setCompletion(entry.id, "completed")}
            label="Erledigt"
            icon={<Check size={18} aria-hidden="true" />}
            variant={goal || overlapGoals.length > 0 ? "ghost" : "secondary"}
            size="lg"
            ariaLabel={`„${entry.title}“ als erledigt markieren`}
          />
        ) : (
          <span className="tag tag--success">Erledigt</span>
        )}
        {entry.completion_status !== "skipped" ? (
          <ActionButton
            action={actions.setCompletion(entry.id, "skipped")}
            label="Ausgelassen"
            variant="ghost"
            size="lg"
            ariaLabel={`„${entry.title}“ als ausgelassen markieren`}
          />
        ) : null}
      </div>
      {goal ? null : <SpontaneousStart actions={actions} size="sm" />}
    </>
  );
}

function FreeCard({
  focus,
  now,
  actions,
  weekPlanHref,
}: {
  focus: Focus;
  now: Date;
  actions: BoundActions;
  weekPlanHref: string;
}) {
  const { kind, previous, next, nextIsToday } = focus;
  const nextLine = next ? (
    <p className="focus-meta focus-meta--strong">
      <span>
        Als Nächstes: <b>{formatStartLabel(next.start_at, now)}</b> {next.title}
      </span>
      <span className={`cat tone-${categoryTone[next.category]}`}>
        <i className="cat-dot" />
        {CATEGORY_LABELS[next.category]} · {formatTimeRange(next.start_at, next.end_at)}
      </span>
    </p>
  ) : null;

  if (kind === "no_plan") {
    return (
      <>
        <div className="focus-head">
          <span className="eyebrow">Diese Woche</span>
        </div>
        <h2 id="fokus-titel" className="focus-title">
          Für diese Woche ist kein Plan veröffentlicht.
        </h2>
        <p className="focus-meta">
          Lege einen Entwurf an oder übernimm deine Wiederholungen. Erfassen geht trotzdem.
        </p>
        <div className="button-row">
          <Link className={buttonClass("primary", "lg")} href={weekPlanHref}>
            Zum Wochenplan
          </Link>
        </div>
        <SpontaneousStart actions={actions} size="sm" />
      </>
    );
  }

  const eyebrow =
    kind === "before_first"
      ? "Vor dem ersten Block"
      : kind === "after_last"
        ? "Nach dem letzten Block"
        : kind === "day_empty"
          ? "Heute"
          : `Jetzt · ${previous ? formatTime(previous.end_at) : ""}–${next ? formatTime(next.start_at) : ""}`;
  const title =
    kind === "before_first" && next
      ? `Noch frei bis ${formatTime(next.start_at)}`
      : kind === "after_last"
        ? "Heute ist nichts mehr geplant."
        : kind === "day_empty"
          ? "Heute ist nichts geplant."
          : "Freie Zeit";

  return (
    <>
      <div className="focus-head">
        <span className="eyebrow">{eyebrow}</span>
      </div>
      <h2 id="fokus-titel" className="focus-title">
        {title}
      </h2>
      {next && nextIsToday ? (
        <CountdownBig
          target={next}
          label={kind === "before_first" ? "bis zum ersten Block" : "bis zum nächsten Block"}
        />
      ) : null}
      {nextLine ?? <p className="focus-meta">Für die nächsten Tage ist nichts mehr geplant.</p>}
      <SpontaneousStart actions={actions} size={kind === "free" ? "lg" : "sm"} />
    </>
  );
}

function ErrorCard() {
  const router = useRouter();
  return (
    <>
      <div className="focus-head">
        <span className="note-status note-status--error">
          <TriangleAlert size={16} aria-hidden="true" className="icon" />
          Nicht geladen
        </span>
      </div>
      <h2 id="fokus-titel" className="focus-title">
        Der Plan konnte nicht geladen werden.
      </h2>
      <p className="focus-meta">
        Bitte die Verbindung prüfen und erneut versuchen. Ziele und Notizen bleiben unverändert.
      </p>
      <div className="button-row">
        <button
          type="button"
          className={buttonClass("secondary", "lg")}
          onClick={() => router.refresh()}
        >
          <RotateCcw size={18} aria-hidden="true" />
          Erneut versuchen
        </button>
      </div>
      <p className="small subtle">Fehlercode: PLAN_LOAD</p>
    </>
  );
}

function focusTitle(focus: Focus): string {
  if (focus.kind === "running") return focus.session?.title ?? "Aktivität";
  if (focus.kind === "block") return focus.current?.title ?? "Planblock";
  if (focus.kind === "no_plan") return "kein veröffentlichter Plan";
  if (focus.kind === "after_last" || focus.kind === "day_empty") return "nichts mehr geplant";
  return "freie Zeit";
}

// ---------------------------------------------------------------------------
// Fokusfläche
// ---------------------------------------------------------------------------

/**
 * Große, ruhige Fokusfläche der Startseite: Der aktuell relevante Block steht scharf in der
 * Mitte, der vorherige und der nächste Block sind klein, unscharf und angeschnitten darüber
 * bzw. darunter angedeutet. Zur Start- bzw. Endzeit eines Blocks wechselt die Fläche ohne
 * Neuladen; dazwischen aktualisieren sich nur Zeitwerte (Minutentakt, Timer sekündlich).
 */
export function FocusStage({
  entries,
  running,
  trackedEntryIds,
  hasPublishedPlan,
  planError = false,
  serverNow,
  actions,
  weekPlanHref,
}: {
  entries: readonly FocusStageEntry[];
  running: ActivitySession | null;
  trackedEntryIds: readonly string[];
  hasPublishedPlan: boolean;
  planError?: boolean;
  /** Serverzeit beim Rendern – das erste Bild stimmt mit dem Server-HTML überein. */
  serverNow: string;
  actions: FocusStageServerActions;
  weekPlanHref: string;
}) {
  const [now, setNow] = useState(() => new Date(serverNow));
  const reducedMotion = usePrefersReducedMotion();
  const bound = useMemo(() => bindActions(actions), [actions]);
  const tracked = useMemo(() => new Set(trackedEntryIds), [trackedEntryIds]);

  const focus = useMemo(
    () =>
      getFocusState<FocusStageEntry, ActivitySession>({ entries, running, now, hasPublishedPlan }),
    [entries, running, now, hasPublishedPlan],
  );
  const key = planError ? "error" : getFocusKey(focus);

  // Nach dem Laden die Uhr des Geräts übernehmen (das Server-HTML nutzt die Serverzeit) und
  // beim Zurückkehren in den Tab neu bestimmen (Timer schlafen in Hintergrund-Tabs).
  useEffect(() => {
    const adopt = window.setTimeout(() => setNow(new Date()), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(adopt);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Neuberechnung genau an der nächsten Blockgrenze – keine sekündliche Neuberechnung.
  useEffect(() => {
    const boundary = window.setTimeout(
      () => setNow(new Date()),
      msUntilFocusChange(focus, new Date()) + 50,
    );
    return () => window.clearTimeout(boundary);
  }, [focus]);

  // Wechsel des Fokus: kurz einblenden (nicht beim ersten Anzeigen) und höflich ansagen.
  const [shownKey, setShownKey] = useState(key);
  const [changed, setChanged] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  if (key !== shownKey) {
    setShownKey(key);
    setChanged(true);
    setAnnouncement(`Jetzt im Fokus: ${planError ? "Fehler beim Laden" : focusTitle(focus)}`);
  }

  const { kind, previous, next, nextIsToday } = focus;
  const showGhosts = !planError && kind !== "no_plan";
  const card = planError ? (
    <ErrorCard />
  ) : kind === "running" && focus.session ? (
    <RunningCard focus={focus} session={focus.session} now={now} actions={bound} />
  ) : kind === "block" && focus.current ? (
    <BlockCard
      focus={focus}
      entry={focus.current}
      tracked={tracked.has(focus.current.id)}
      actions={bound}
    />
  ) : (
    <FreeCard focus={focus} now={now} actions={bound} weekPlanHref={weekPlanHref} />
  );

  // Farbe = Kategorie (wie der Block im Wochenplan), nie Status; ohne Kategorie bleibt sie neutral.
  const tone = planError
    ? undefined
    : kind === "running" && focus.session
      ? categoryTone[focus.session.goal_category]
      : kind === "block" && focus.current
        ? categoryTone[focus.current.category]
        : undefined;
  const cardClass = [
    "focus-card",
    planError ? "is-error" : "",
    kind === "running" ? "is-running" : "",
    !planError && kind !== "running" && kind !== "block" ? "is-free" : "",
    tone ? `is-tinted tone-${tone}` : "",
    changed && !reducedMotion ? "focus-card--enter" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <MinuteClock initialNow={serverNow}>
      <section
        className="focus-stage"
        aria-labelledby="fokus-titel"
        data-focus={kind}
        data-motion={reducedMotion ? "reduced" : "full"}
      >
        {showGhosts && previous ? <Ghost entry={previous} position="prev" now={now} /> : null}
        <article key={key} className={cardClass} data-testid="focus-card">
          {card}
          {!planError ? <Around focus={focus} now={now} /> : null}
        </article>
        {showGhosts && next ? (
          <Ghost entry={next} position="next" now={now} later={!nextIsToday} />
        ) : null}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </section>
    </MinuteClock>
  );
}

import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  GOAL_LABELS,
  formatTime,
  requiresCorrectionToStop,
} from "@tagestakt/schedule-schema";
import { Square } from "lucide-react";
import Link from "next/link";

import type { FormAction } from "@/lib/form";

import { ActionButton } from "./action-button";
import { LiveTimer } from "./live-timer";

/** Laufende Aktivität in der Seitenleiste (kompakte Karte). */
export function ActiveSessionCard({
  session,
  now,
  stopAction,
}: {
  session: ActivitySession;
  now: Date;
  stopAction: FormAction;
}) {
  const tone = categoryTone[session.goal_category];
  const blocked = requiresCorrectionToStop(session, now);
  return (
    <section className={`session-card tone-${tone}`} aria-label="Laufende Aktivität">
      <div className="row">
        <span className="session-dot" aria-hidden="true" />
        <span className="small muted">
          {GOAL_LABELS[session.goal_category]} · seit {formatTime(session.started_at)}
        </span>
      </div>
      <p className="list-title">{session.title}</p>
      <LiveTimer startedAt={session.started_at} size="md" initialNow={now.toISOString()} />
      {blocked ? (
        <Link className="btn btn--secondary" href="/auswertung">
          Zeit korrigieren
        </Link>
      ) : (
        <ActionButton
          action={stopAction}
          label="Beenden"
          icon={<Square size={16} aria-hidden="true" />}
          variant="primary"
          pendingLabel="Wird beendet …"
        />
      )}
    </section>
  );
}

/** Kompakter Hinweis in der Kopfzeile (schmale Bildschirme). */
export function ActiveSessionChip({ session, now }: { session: ActivitySession; now: Date }) {
  const tone = categoryTone[session.goal_category];
  return (
    <Link
      href="/"
      className={`timer-chip tone-${tone}`}
      aria-label={`${GOAL_LABELS[session.goal_category]} läuft – zur Übersicht`}
    >
      <span className="session-dot" aria-hidden="true" />
      <LiveTimer startedAt={session.started_at} size="sm" initialNow={now.toISOString()} />
    </Link>
  );
}

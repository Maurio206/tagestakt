import {
  GOAL_KEYS,
  GOAL_LABELS,
  type GoalKey,
  type LocalDate,
  type PlanCheck,
  WEEKDAY_SHORT_LABELS,
  evaluatePlanDraft,
  findPlanningConflicts,
  formatTime,
  formatWeekLabel,
  getMissingPlanningRequirements,
  isoWeekdayOfLocalDate,
  overlappingEntryIds,
  plannableWeekStarts,
  toLocalDate,
  toLocalTime,
} from "@tagestakt/schedule-schema";
import { CalendarCheck, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { Notice } from "@/components/notice";
import { PlanStartForm, PublishPlanForm } from "@/components/planner-forms";
import { WeekGrid } from "@/components/week-grid";
import { WeekGridFrame } from "@/components/week-grid-frame";
import { noticeText, planPath, weekPlanPath } from "@/lib/paths";
import { publishPlannedWeekAction, startPlanningAction } from "@/server/actions/planner";
import { requireUser } from "@/server/auth";
import { getWeekFingerprint, loadPlanningContext } from "@/server/data/planner";
import { getWeekWithEntries, listWeekVersions } from "@/server/data/schedule";
import { readPlannerConfig } from "@/server/planner/config";
import { getPlanningJob } from "@/server/planner/jobs";

export const metadata: Metadata = { title: "Wochenplaner" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** „X Stunden Y Minuten“ – ausgeschrieben für die Prüfübersicht. */
function hoursAndMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)} Stunden ${total % 60} Minuten`;
}

function yesNo(ok: boolean): string {
  return ok ? "ja" : "nein";
}

/** Zeilen der Prüfübersicht in fester Reihenfolge (fehlende Prüfung = nicht erfüllt). */
function summaryRows(checks: readonly PlanCheck[], businessMinutes: number) {
  const byKey = new Map(checks.map((check) => [check.key, check]));
  const ok = (key: string) => byKey.get(key)?.ok ?? false;
  return [
    { label: "Dienst vollständig", value: yesNo(ok("duty")), ok: ok("duty") },
    { label: "Trainingstage erfüllt", value: yesNo(ok("sport-slots")), ok: ok("sport-slots") },
    {
      label: `${GOAL_LABELS.relationship}-Tage erfüllt`,
      value: yesNo(ok("relationship-slots")),
      ok: ok("relationship-slots"),
    },
    { label: "Gewerbe geplant", value: hoursAndMinutes(businessMinutes), ok: true },
    {
      label: "Gewerbe-Minimum erreicht",
      value: yesNo(ok("business-minimum")),
      ok: ok("business-minimum"),
    },
    {
      label: "Überschneidungen",
      value: byKey.get("overlaps")?.value ?? "?",
      ok: ok("overlaps"),
    },
  ];
}

const SUMMARY_KEYS = new Set([
  "duty",
  "sport-slots",
  "relationship-slots",
  "business-planned",
  "business-minimum",
  "overlaps",
]);

function targetOf(
  goal: GoalKey,
  targets: { business: number; sport: number | null; relationship: number | null },
): number | null {
  return goal === "business" ? targets.business : targets[goal];
}

export default async function PlannerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await requireUser();
  const now = new Date();
  const weeks = plannableWeekStarts(now);
  const job = getPlanningJob(user.id);
  const requested = single(params.woche);
  const weekStart: LocalDate =
    requested && weeks.includes(requested)
      ? requested
      : job && weeks.includes(job.weekStart)
        ? job.weekStart
        : (weeks[0] ?? toLocalDate(now));
  const notice = noticeText(single(params.hinweis));
  const config = readPlannerConfig();

  const [context, versions] = await Promise.all([
    loadPlanningContext(weekStart, now),
    listWeekVersions(weekStart),
  ]);
  const draftMeta = versions.find((v) => v.status === "draft");
  const published = versions.find((v) => v.status === "published");
  const [draft, fingerprint] = draftMeta
    ? await Promise.all([getWeekWithEntries(draftMeta.id), getWeekFingerprint(draftMeta.id)])
    : [null, null];

  const missing = getMissingPlanningRequirements(context).filter((m) => m.key !== "week");
  const conflicts = missing.length === 0 ? findPlanningConflicts(context) : [];
  const weekJob = job?.weekStart === weekStart ? job : undefined;
  const running = job?.status === "running";
  const canStart = config.ok && missing.length === 0 && conflicts.length === 0 && !running;

  const entries = draft?.schedule_entries ?? [];
  const evaluation = draft ? evaluatePlanDraft(context, entries) : null;
  const targets = {
    business: context.settings.businessTargetMinutes,
    sport: context.settings.sportTargetMinutes,
    relationship: context.settings.relationshipTargetMinutes,
  };
  const dutyCount = context.fixed.filter((f) => f.category === "duty").length;
  const today = toLocalDate(now);

  return (
    <>
      {running ? <AutoRefresh intervalSeconds={5} /> : null}
      <header className="page-header">
        <div>
          <p className="eyebrow">Wochenplaner</p>
          <h1>Woche mit Claude planen</h1>
        </div>
      </header>

      {notice ? (
        <Notice tone="success" role="status">
          {notice}
        </Notice>
      ) : null}

      <nav aria-label="Woche wählen" className="version-list">
        {weeks.map((week) => (
          <Link
            key={week}
            href={planPath(week)}
            className="vchip"
            aria-current={week === weekStart ? "page" : undefined}
          >
            {formatWeekLabel(week)}
          </Link>
        ))}
      </nav>

      {!config.ok ? (
        <Notice tone="error" title="Wochenplaner nicht eingerichtet" role="alert">
          <p>{config.message}</p>
          <p className="small">
            Das Secret wird ausschließlich auf dem Server hinterlegt (Coolify), nie im Browser oder
            in der App.
          </p>
        </Notice>
      ) : null}

      {missing.length > 0 ? (
        <Notice tone="warning" title="Es fehlen Angaben – ohne sie wird nicht geplant">
          <ol className="stack-tight">
            {missing.map((item) => (
              <li key={item.key}>
                {item.message} <Link href={item.href}>Jetzt ergänzen</Link>
              </li>
            ))}
          </ol>
        </Notice>
      ) : null}

      {conflicts.length > 0 ? (
        <Notice tone="error" title="Mit den gespeicherten Regeln nicht vollständig planbar">
          <ul className="stack-tight">
            {conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
          <p>
            Bitte entscheide: Regeln in den{" "}
            <Link href="/einstellungen#planungsregeln">Einstellungen</Link> bzw.{" "}
            <Link href="/wiederholungen">Wiederholungen</Link> anpassen oder eine andere Woche
            wählen. Es wird nichts still gekürzt.
          </p>
        </Notice>
      ) : null}

      {running ? (
        <Notice tone="info" title="Claude plant gerade" role="status">
          <p>
            {weekJob
              ? `Seit ${formatTime(new Date(weekJob.startedAt).toISOString())} Uhr. Die Seite aktualisiert sich selbst; das dauert meist ein bis drei Minuten.`
              : `Gerade wird ${formatWeekLabel(job.weekStart)} geplant.`}
          </p>
        </Notice>
      ) : null}
      {weekJob?.status === "failed" ? (
        <Notice tone="error" title="Planung nicht übernommen" role="alert">
          <p>{weekJob.message}</p>
          {weekJob.details.length > 0 ? (
            <ul className="stack-tight">
              {weekJob.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
          <p className="small">
            Ein vorhandener Entwurf und der veröffentlichte Plan sind unverändert.
          </p>
        </Notice>
      ) : null}
      {weekJob?.status === "succeeded" && weekJob.draftId === draft?.id ? (
        <Notice tone="success" title="Neuer Entwurf erstellt" role="status">
          <p>Bitte prüfen. Veröffentlicht wird erst nach deiner ausdrücklichen Freigabe.</p>
        </Notice>
      ) : null}

      <section className="section" aria-labelledby="grundlage-titel">
        <div className="section-head">
          <h2 id="grundlage-titel">Grundlage für {formatWeekLabel(weekStart)}</h2>
        </div>
        <ul className="stack-tight muted">
          <li>
            {context.fixed.length} feste Termine aus aktiven Wiederholungen, davon {dutyCount}{" "}
            Dienst – sie werden unverändert übernommen.
          </li>
          <li>
            Training: {context.slots.filter((s) => s.goal === "sport").length} Tage mit Zeitfenster;{" "}
            {GOAL_LABELS.relationship}:{" "}
            {context.slots.filter((s) => s.goal === "relationship").length} Tage.
          </li>
          <li>Gewerbe mindestens {hoursAndMinutes(targets.business)} (Dienst zählt nicht).</li>
          <li>
            An Claude gehen nur Zeiten und neutrale Bezeichnungen – keine Titel, Notizen, Orte,
            Namen, Tagesnotizen oder Kontodaten.
          </li>
        </ul>
        <PlanStartForm
          action={startPlanningAction.bind(null, weekStart)}
          draft={
            draft && fingerprint ? { id: draft.id, fingerprint, version: draft.version } : null
          }
          disabled={!canStart}
        />
        {published ? (
          <p className="small muted">
            Veröffentlicht ist Version {published.version}. Sie bleibt in Web, App und Widget
            sichtbar, bis du einen neuen Entwurf veröffentlichst.
          </p>
        ) : null}
      </section>

      {draft && evaluation && fingerprint ? (
        <section className="section" aria-labelledby="entwurf-titel">
          <div className="section-head">
            <h2 id="entwurf-titel">Entwurf prüfen</h2>
            <span className="vchip vchip--draft">
              Version {draft.version} · Entwurf – noch nicht veröffentlicht
            </span>
          </div>

          <dl className="details-list check-list">
            {summaryRows(evaluation.checks, evaluation.minutes.business).map((row) => (
              <div key={row.label} className={row.ok ? "check-row" : "check-row is-open"}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
            <div
              className={evaluation.openDecisions.length === 0 ? "check-row" : "check-row is-open"}
            >
              <dt>Offene Entscheidungen</dt>
              <dd>
                {evaluation.openDecisions.length === 0 ? (
                  "keine"
                ) : (
                  <ul className="stack-tight">
                    {evaluation.openDecisions.map((decision) => (
                      <li key={decision}>{decision}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>

          <details className="disclosure">
            <summary>Weitere Prüfungen</summary>
            <ul className="stack-tight">
              {evaluation.checks
                .filter((check) => !SUMMARY_KEYS.has(check.key))
                .map((check) => (
                  <li key={check.key}>
                    {check.label}: {check.value ?? yesNo(check.ok)}
                    {check.hard ? "" : " (Hinweis)"}
                  </li>
                ))}
            </ul>
          </details>

          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Geplante Minuten je Ziel</caption>
              <thead>
                <tr>
                  <th scope="col">Ziel</th>
                  <th scope="col" className="r">
                    Geplant
                  </th>
                  <th scope="col" className="r">
                    Wochenziel
                  </th>
                  <th scope="col" className="r">
                    Fehlt
                  </th>
                </tr>
              </thead>
              <tbody>
                {GOAL_KEYS.map((goal) => {
                  const target = targetOf(goal, targets);
                  const planned = evaluation.minutes[goal];
                  return (
                    <tr key={goal}>
                      <td>{GOAL_LABELS[goal]}</td>
                      <td className="r">{hoursAndMinutes(planned)}</td>
                      <td className="r">{target ? hoursAndMinutes(target) : "kein Ziel"}</td>
                      <td className="r">
                        {target ? hoursAndMinutes(Math.max(0, target - planned)) : "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {draft.planning_note ? (
            <div className="planner-note">
              <h3>Zusammenfassung und Hinweise</h3>
              <p className="pre-line">{draft.planning_note}</p>
            </div>
          ) : null}

          <WeekGridFrame>
            <WeekGrid
              weekStart={weekStart}
              entries={entries}
              overlapIds={overlappingEntryIds(entries)}
              today={today}
              now={now}
              editHref={(entry) =>
                weekPlanPath(weekStart, { versionId: draft.id, editEntryId: entry.id })
              }
              linkAction="bearbeiten"
            />
          </WeekGridFrame>

          <details className="disclosure">
            <summary>Alle {entries.length} Blöcke als Liste</summary>
            <ul className="list">
              {entries.map((entry) => {
                const date = toLocalDate(new Date(entry.start_at));
                return (
                  <li key={entry.id}>
                    <span className="list-time">
                      {WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(date)]}{" "}
                      {toLocalTime(new Date(entry.start_at))}–{toLocalTime(new Date(entry.end_at))}
                    </span>
                    <span className="list-main">
                      <span className="list-title">{entry.title}</span>
                      {entry.note ? <span className="list-meta">{entry.note}</span> : null}
                    </span>
                    <span className="list-meta">
                      {entry.source === "agent" ? "von Claude vorgeschlagen" : "feste Wiederholung"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>

          <div className="button-row">
            <Link
              className="btn btn--secondary btn--lg"
              href={weekPlanPath(weekStart, { versionId: draft.id })}
            >
              <PenLine size={18} aria-hidden="true" />
              Entwurf bearbeiten
            </Link>
            <PublishPlanForm
              action={publishPlannedWeekAction.bind(null, draft.id, weekStart)}
              fingerprint={fingerprint}
              disabled={!evaluation.publishable || running}
            />
          </div>
          {!evaluation.publishable ? (
            <p className="small muted">
              Veröffentlichen ist erst möglich, wenn alle Pflichtregeln erfüllt sind und keine
              Entscheidung offen ist.
            </p>
          ) : null}
        </section>
      ) : !running ? (
        <section className="empty">
          <CalendarCheck size={28} aria-hidden="true" className="icon" />
          <h2>Noch kein Entwurf für diese Woche</h2>
          <p className="muted">
            Claude erstellt einen Entwurf. Veröffentlicht wird erst nach deiner Prüfung und
            Freigabe.
          </p>
        </section>
      ) : null}
    </>
  );
}

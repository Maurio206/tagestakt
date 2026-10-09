import "server-only";

import { type LocalDate } from "@tagestakt/schedule-schema";

/**
 * Planungsaufträge im Speicher des Web-Servers (ein Prozess, genau ein Benutzer). Ein Auftrag
 * läuft nach dem Absenden im Hintergrund weiter; die Seite fragt den Zustand regelmäßig ab.
 * Nach einem Neustart ist der Zustand weg – gespeichert wird ein Entwurf ohnehin nur atomar.
 * Gespeichert werden ausschließlich Zustand, Zeiten und geprüfte Meldungen – keine Inhalte.
 */

export type PlanningJob =
  | { status: "running"; weekStart: LocalDate; startedAt: number }
  | {
      status: "succeeded";
      weekStart: LocalDate;
      startedAt: number;
      finishedAt: number;
      draftId: string;
      warnings: string[];
    }
  | {
      status: "failed";
      weekStart: LocalDate;
      startedAt: number;
      finishedAt: number;
      message: string;
      details: string[];
    };

/** Höchstens so viele Planungen je Stunde (Kostenschutz, auch gegen Doppelklicks). */
export const PLANNER_MAX_STARTS_PER_HOUR = 8;
/** Ein „laufender“ Auftrag gilt danach als hängen geblieben. */
export const PLANNER_STALE_AFTER_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;

const jobs = new Map<string, PlanningJob>();
const starts = new Map<string, number[]>();

export function getPlanningJob(ownerId: string, now = Date.now()): PlanningJob | undefined {
  const job = jobs.get(ownerId);
  if (job?.status === "running" && now - job.startedAt > PLANNER_STALE_AFTER_MS) {
    const failed: PlanningJob = {
      status: "failed",
      weekStart: job.weekStart,
      startedAt: job.startedAt,
      finishedAt: now,
      message: "Die Planung hat zu lange gedauert und wurde abgebrochen. Bitte erneut planen.",
      details: [],
    };
    jobs.set(ownerId, failed);
    return failed;
  }
  return job;
}

export type ReserveResult =
  | { ok: true; job: PlanningJob }
  | { ok: false; reason: "running" | "rate-limit"; job?: PlanningJob };

/**
 * Reserviert synchron einen Auftrag (kein `await` zwischen Prüfen und Setzen): Ein zweiter
 * Klick, während ein Auftrag läuft, startet keinen weiteren.
 */
export function reservePlanningJob(
  ownerId: string,
  weekStart: LocalDate,
  now = Date.now(),
): ReserveResult {
  const current = getPlanningJob(ownerId, now);
  if (current?.status === "running") return { ok: false, reason: "running", job: current };
  const recent = (starts.get(ownerId) ?? []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= PLANNER_MAX_STARTS_PER_HOUR) {
    starts.set(ownerId, recent);
    return { ok: false, reason: "rate-limit" };
  }
  starts.set(ownerId, [...recent, now]);
  const job: PlanningJob = { status: "running", weekStart, startedAt: now };
  jobs.set(ownerId, job);
  return { ok: true, job };
}

/** Schließt den Auftrag ab – nur, wenn er noch derselbe ist (kein Überschreiben neuerer). */
export function finishPlanningJob(
  ownerId: string,
  startedAt: number,
  result:
    | { status: "succeeded"; draftId: string; warnings: string[] }
    | { status: "failed"; message: string; details: string[] },
  now = Date.now(),
): void {
  const current = jobs.get(ownerId);
  if (!current || current.startedAt !== startedAt) return;
  jobs.set(ownerId, { ...result, weekStart: current.weekStart, startedAt, finishedAt: now });
}

/** Nur für Tests. */
export function resetPlanningJobs(): void {
  jobs.clear();
  starts.clear();
}

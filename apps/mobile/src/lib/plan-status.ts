import { type PlanSnapshot } from "@tagestakt/schedule-schema";

/** Ab diesem Alter gilt ein geladener Plan als veraltet. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export type PlanOrigin = "network" | "cache";

export interface PlanResult {
  snapshot: PlanSnapshot;
  origin: PlanOrigin;
  /** Fehlermeldung des letzten Netzwerkversuchs, falls der Cache verwendet wird. */
  errorMessage?: string;
}

export function isFetchedAtStale(fetchedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(fetchedAt) > STALE_AFTER_MS;
}

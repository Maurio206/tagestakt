import { type CompletionStatus, type GoalKey } from "@tagestakt/schedule-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useAuth } from "@/auth/auth-context";
import { correctActivity, discardActivity, startActivity, stopActivity } from "@/lib/activity-api";
import { setEntryCompletion } from "@/lib/plan-edit-api";
import { OFFLINE_MESSAGE, toWriteError } from "@/lib/write-errors";

/**
 * Schreibende Aktionen der Zeiterfassung. Ohne Verbindung (Plan aus dem Cache) wird nichts
 * gesendet und keine Warteschlange angelegt – die Oberfläche erklärt das stattdessen.
 */
export function useActivityActions(canWrite: boolean) {
  const { supabase } = useAuth();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (operation: () => Promise<unknown>): Promise<boolean> => {
      if (!canWrite) {
        setError(OFFLINE_MESSAGE);
        return false;
      }
      setPending(true);
      setError(null);
      try {
        await operation();
        return true;
      } catch (cause) {
        setError(toWriteError(cause).message);
        return false;
      } finally {
        setPending(false);
        // Immer neu laden: auch nach einem Fehler (z. B. „läuft bereits“) den Serverstand zeigen.
        await queryClient.invalidateQueries({ queryKey: ["plan"] });
      }
    },
    [canWrite, queryClient],
  );

  return {
    pending,
    error,
    clearError: () => setError(null),
    start: (goal: GoalKey, scheduleEntryId: string | null) =>
      run(() => startActivity(supabase, { goal, scheduleEntryId })),
    stop: (sessionId: string) => run(() => stopActivity(supabase, sessionId)),
    /** Wechsel: laufende Aktivität beenden, dann die neue starten. */
    switchTo: (runningId: string, goal: GoalKey, scheduleEntryId: string | null) =>
      run(async () => {
        await stopActivity(supabase, runningId);
        await startActivity(supabase, { goal, scheduleEntryId });
      }),
    discard: (sessionId: string) => run(() => discardActivity(supabase, sessionId)),
    correct: (sessionId: string, startedAt: string, endedAt: string | null) =>
      run(() => correctActivity(supabase, { sessionId, startedAt, endedAt })),
    setCompletion: (entryId: string, status: CompletionStatus) =>
      run(() => setEntryCompletion(supabase, entryId, status)),
  };
}

export type ActivityActions = ReturnType<typeof useActivityActions>;

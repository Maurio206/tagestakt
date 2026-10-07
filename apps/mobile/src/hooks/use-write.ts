import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { OFFLINE_MESSAGE, toWriteError } from "@/lib/write-errors";

/**
 * Einzelne Schreibaktion mit Zustand (läuft / Fehler / gespeichert). Ohne Verbindung wird
 * nichts gesendet und nichts zwischengespeichert; danach wird der Plan neu geladen.
 */
export function useWrite(canWrite: boolean) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = useCallback(
    async (operation: () => Promise<unknown>): Promise<boolean> => {
      setSaved(false);
      if (!canWrite) {
        setError(OFFLINE_MESSAGE);
        return false;
      }
      setPending(true);
      setError(null);
      try {
        await operation();
        setSaved(true);
        return true;
      } catch (cause) {
        setError(toWriteError(cause).message);
        return false;
      } finally {
        setPending(false);
        await queryClient.invalidateQueries({ queryKey: ["plan"] });
      }
    },
    [canWrite, queryClient],
  );

  const reset = useCallback(() => {
    setError(null);
    setSaved(false);
  }, []);

  return { run, pending, error, saved, reset };
}

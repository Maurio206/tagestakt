import {
  type DailyNoteSaveInput,
  type DailyNoteSaveResult,
  type DailyNoteSnapshot,
  type LocalDate,
} from "@tagestakt/schedule-schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/auth/auth-context";
import { NoteLoadError, fetchDailyNote, saveDailyNote } from "@/lib/daily-notes-api";

/** Ladezustand einer Tagesnotiz, wie ihn Jetzt, Tag und der Editor anzeigen. */
export type DailyNoteState =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "error" }
  | { status: "ready"; note: DailyNoteSnapshot | null };

/**
 * Tagesnotiz eines Tages – nur online und nur im Arbeitsspeicher (React Query, ohne
 * Persistenz). Ohne Verbindung wird nichts vorgetäuscht: Der Zustand heißt dann „offline“.
 */
export function useDailyNote(date: LocalDate, options: { enabled?: boolean } = {}) {
  const { supabase, session } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["daily-note", session?.user.id, date] as const;

  const query = useQuery({
    queryKey,
    enabled: Boolean(session) && (options.enabled ?? true),
    networkMode: "always",
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: () => fetchDailyNote(supabase, date),
  });

  const save = useCallback(
    async (input: DailyNoteSaveInput): Promise<DailyNoteSaveResult> => {
      const key = ["daily-note", session?.user.id, input.date];
      const result = await saveDailyNote(supabase, input);
      if (result.status === "saved") {
        // Eine noch laufende (ältere) Abfrage darf den gerade gespeicherten Stand nicht ersetzen.
        await queryClient.cancelQueries({ queryKey: key });
        queryClient.setQueryData(key, result.note);
      }
      return result;
    },
    [supabase, queryClient, session?.user.id],
  );

  let state: DailyNoteState;
  if (query.data !== undefined) state = { status: "ready", note: query.data };
  else if (query.isError)
    state = {
      status:
        query.error instanceof NoteLoadError && query.error.kind === "failed" ? "error" : "offline",
    };
  else state = { status: "loading" };

  return { state, save, refetch: query.refetch, isFetching: query.isFetching };
}

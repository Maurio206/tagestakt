import { type PlanSnapshot } from "@tagestakt/schedule-schema";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useAuth } from "@/auth/auth-context";
import { fetchPlanSnapshot } from "@/lib/plan-api";
import { loadCachedPlan, saveCachedPlan } from "@/lib/plan-cache";
import { type PlanResult } from "@/lib/plan-status";

function messageOf(error: unknown): string {
  return error instanceof Error && error.name === "PlanFetchError"
    ? error.message
    : "Keine Verbindung zum Server.";
}

/**
 * Lädt den veröffentlichten Plan. Schlägt das Netzwerk fehl, wird der zuletzt
 * erfolgreich geladene Plan aus dem lokalen Cache angezeigt.
 */
export function usePlan() {
  const { supabase, session } = useAuth();
  const [cached, setCached] = useState<PlanSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    void loadCachedPlan().then((snapshot) => {
      if (active) setCached(snapshot);
    });
    return () => {
      active = false;
    };
  }, []);

  const query = useQuery({
    queryKey: ["plan", session?.user.id],
    enabled: Boolean(session),
    networkMode: "always",
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<PlanResult> => {
      try {
        const snapshot = await fetchPlanSnapshot(supabase);
        await saveCachedPlan(snapshot);
        return { snapshot, origin: "network" };
      } catch (error) {
        const fallback = await loadCachedPlan();
        if (fallback)
          return { snapshot: fallback, origin: "cache", errorMessage: messageOf(error) };
        throw new Error(messageOf(error));
      }
    },
  });

  // Bis die erste Antwort da ist, sofort den Cache zeigen.
  const result: PlanResult | undefined =
    query.data ?? (cached ? { snapshot: cached, origin: "cache" } : undefined);

  return {
    result,
    isLoading: query.isLoading && !result,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

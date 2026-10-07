import { useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";

import { type NowActions, NowView } from "@/components/now-view";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { useActivityActions } from "@/hooks/use-activity";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { useTheme } from "@/theme";

export default function NowScreen() {
  const now = useNow();
  const theme = useTheme();
  const router = useRouter();
  const { result, isLoading, isFetching, error, refetch } = usePlan();
  const activity = useActivityActions(result?.origin === "network");

  const actions: NowActions = {
    start: (goal, entryId) => void activity.start(goal, entryId),
    stop: (sessionId) => void activity.stop(sessionId),
    switchTo: (runningId, goal, entryId) => void activity.switchTo(runningId, goal, entryId),
    discard: (sessionId) => void activity.discard(sessionId),
    setCompletion: (entryId, status) => void activity.setCompletion(entryId, status),
    openCorrection: (sessionId) =>
      router.push({ pathname: "/korrigieren", params: { id: sessionId } }),
    openGoals: () => router.push("/ziele"),
  };

  return (
    <Screen refreshing={isFetching} onRefresh={() => void refetch()}>
      {result ? (
        <NowView
          result={result}
          now={now}
          actions={actions}
          pending={activity.pending}
          error={activity.error}
        />
      ) : isLoading ? (
        <ActivityIndicator color={theme.text} accessibilityLabel="Plan wird geladen" />
      ) : (
        <PlanError message={error?.message} onRetry={() => void refetch()} />
      )}
    </Screen>
  );
}

import { ActivityIndicator } from "react-native";

import { NowView } from "@/components/now-view";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { useTheme } from "@/theme";

export default function NowScreen() {
  const now = useNow();
  const theme = useTheme();
  const { result, isLoading, isFetching, error, refetch } = usePlan();

  return (
    <Screen refreshing={isFetching} onRefresh={() => void refetch()}>
      {result ? (
        <NowView result={result} now={now} />
      ) : isLoading ? (
        <ActivityIndicator color={theme.accent} accessibilityLabel="Plan wird geladen" />
      ) : (
        <PlanError message={error?.message} onRetry={() => void refetch()} />
      )}
    </Screen>
  );
}

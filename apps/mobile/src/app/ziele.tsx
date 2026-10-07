import {
  formatWeekLabel,
  getWeekGoals,
  getWeekStart,
  getWeekSummarySentence,
} from "@tagestakt/schedule-schema";
import { useRouter } from "expo-router";
import { Settings2 } from "lucide-react-native";
import { ActivityIndicator } from "react-native";

import { GoalLegend, GoalList } from "@/components/goal-progress";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { StackHeader } from "@/components/stack-header";
import { StatusBanner } from "@/components/status-banner";
import { RunningTimerBar } from "@/components/timer-bar";
import { Body, Button, Muted, Section } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { useTheme } from "@/theme";

export default function GoalsScreen() {
  const now = useNow(60_000);
  const theme = useTheme();
  const router = useRouter();
  const { result, isLoading, isFetching, error, refetch } = usePlan();
  const weekStart = getWeekStart(now);

  if (!result) {
    return (
      <Screen>
        <StackHeader title="Ziele" />
        {isLoading ? (
          <ActivityIndicator color={theme.text} accessibilityLabel="Ziele werden geladen" />
        ) : (
          <PlanError message={error?.message} onRetry={() => void refetch()} />
        )}
      </Screen>
    );
  }

  const { snapshot } = result;
  const week = snapshot.weeks.find((w) => w.week_start === weekStart);
  const goals = getWeekGoals({
    targets: snapshot.goalTargets,
    entries: week?.schedule_entries ?? [],
    sessions: snapshot.sessions,
    weekStart,
    now,
  });

  return (
    <Screen
      refreshing={isFetching}
      onRefresh={() => void refetch()}
      footer={<RunningTimerBar />}
      edges={["top", "bottom", "left", "right"]}
    >
      <StackHeader title="Ziele" subtitle={formatWeekLabel(weekStart)} />
      <StatusBanner
        origin={result.origin}
        fetchedAt={snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />
      <Body bold>{getWeekSummarySentence(goals)}</Body>
      <GoalList goals={goals} />
      <GoalLegend />
      <Section title="So wird gezählt">
        <Muted small>
          Es zählt nur tatsächlich erfasste Zeit („Fokus starten“ bis „Beenden“). Geplante Zeit
          zeigt, was in dieser Woche noch möglich ist. Ohne festgelegtes Ziel wird nichts bewertet.
        </Muted>
      </Section>
      <Button
        label="Wochenziele ändern"
        icon={Settings2}
        onPress={() => router.push("/einstellungen")}
      />
    </Screen>
  );
}

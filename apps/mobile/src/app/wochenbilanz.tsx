import { categoryTone } from "@tagestakt/design-tokens";
import {
  type GoalProgress,
  addDays,
  formatGoalAmount,
  formatSignedHours,
  formatWeekLabel,
  getWeekBounds,
  getWeekGoals,
  getWeekStart,
  getWeekSummarySentence,
} from "@tagestakt/schedule-schema";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { GoalStatusChip } from "@/components/goal-progress";
import { ToneIcon } from "@/components/icons";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { SessionList } from "@/components/session-list";
import { StackHeader } from "@/components/stack-header";
import { StatusBanner } from "@/components/status-banner";
import { Body, ChoiceChips, Section, Surface } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { spacing, useTheme } from "@/theme";

function Row({ progress, first }: { progress: GoalProgress; first: boolean }) {
  const theme = useTheme();
  const tone = categoryTone[progress.goal];
  const target =
    progress.targetMinutes === null ? "kein Ziel" : formatGoalAmount(progress.targetMinutes);
  const difference =
    progress.differenceMinutes === null ? "–" : formatSignedHours(progress.differenceMinutes);
  return (
    <View
      style={[
        styles.row,
        first ? null : { borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth },
      ]}
      accessible
      accessibilityLabel={`${progress.label}: Ziel ${target}, geplant ${formatGoalAmount(progress.plannedMinutes)}, erfasst ${formatGoalAmount(progress.trackedMinutes)}, Differenz ${difference}`}
    >
      <View style={styles.rowHead}>
        <ToneIcon tone={tone} color={theme[tone]} size={20} />
        <Text style={[styles.name, { color: theme.text }]}>{progress.label}</Text>
        <GoalStatusChip status={progress.status} />
      </View>
      <View style={styles.cells}>
        {[
          ["Ziel", target],
          ["Geplant", formatGoalAmount(progress.plannedMinutes)],
          ["Erfasst", formatGoalAmount(progress.trackedMinutes)],
          ["Differenz", difference],
        ].map(([label, value]) => (
          <View key={label} style={styles.cell}>
            <Text style={[styles.cellLabel, { color: theme.textMuted }]}>{label}</Text>
            <Text style={[styles.cellValue, { color: theme.text }]}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function WeekReviewScreen() {
  const now = useNow(60_000);
  const theme = useTheme();
  const router = useRouter();
  const [offset, setOffset] = useState<0 | -7>(0);
  const { result, isLoading, isFetching, error, refetch } = usePlan();
  const weekStart = addDays(getWeekStart(now), offset);

  if (!result) {
    return (
      <Screen>
        <StackHeader title="Wochenbilanz" />
        {isLoading ? (
          <ActivityIndicator color={theme.text} accessibilityLabel="Bilanz wird geladen" />
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
  const bounds = getWeekBounds(weekStart);
  const sessions = snapshot.sessions.filter(
    (s) =>
      Date.parse(s.started_at) < bounds.end.getTime() &&
      (s.ended_at === null || Date.parse(s.ended_at) > bounds.start.getTime()),
  );

  return (
    <Screen
      refreshing={isFetching}
      onRefresh={() => void refetch()}
      edges={["top", "bottom", "left", "right"]}
    >
      <StackHeader title="Wochenbilanz" subtitle={formatWeekLabel(weekStart)} />
      <ChoiceChips
        label="Woche wählen"
        options={[
          { value: 0, label: "Diese Woche" },
          { value: -7, label: "Letzte Woche" },
        ]}
        value={offset}
        onChange={setOffset}
      />
      <StatusBanner
        origin={result.origin}
        fetchedAt={snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />
      <Body bold>{getWeekSummarySentence(goals)}</Body>
      <Surface>
        {goals.map((progress, index) => (
          <Row key={progress.goal} progress={progress} first={index === 0} />
        ))}
      </Surface>
      <Section title="Erfasste Aktivitäten">
        <SessionList
          sessions={sessions}
          now={now}
          showDate
          canWrite={result.origin === "network"}
          onCorrect={(id) => router.push({ pathname: "/korrigieren", params: { id } })}
          emptyText="In dieser Woche wurde noch keine Zeit erfasst."
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { padding: spacing.lg, gap: spacing.md },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { flex: 1, fontSize: 16, fontWeight: "700" },
  cells: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm },
  cell: { width: "50%", gap: 2 },
  cellLabel: { fontSize: 12, fontWeight: "600" },
  cellValue: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
});

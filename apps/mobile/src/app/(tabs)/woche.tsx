import {
  type ScheduleEntry,
  addDays,
  blocksOverlap,
  detectOverlaps,
  formatWeekLabel,
  getWeekGoals,
  getWeekStart,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { useRouter } from "expo-router";
import { ChartColumn, PencilLine } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { BlockDetailsSheet } from "@/components/block-details";
import { GoalList } from "@/components/goal-progress";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { StatusBanner } from "@/components/status-banner";
import { RunningTimerBar } from "@/components/timer-bar";
import { Button, ChoiceChips, Muted, Notice, Section, Title } from "@/components/ui";
import { WeekGridFrame } from "@/components/week-grid-frame";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { spacing, useTheme } from "@/theme";

export default function WeekScreen() {
  const now = useNow(60_000);
  const theme = useTheme();
  const router = useRouter();
  const [offset, setOffset] = useState<0 | 7>(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const { result, isLoading, isFetching, error, refetch } = usePlan();

  if (!result) {
    return (
      <Screen>
        {isLoading ? (
          <ActivityIndicator color={theme.text} accessibilityLabel="Plan wird geladen" />
        ) : (
          <PlanError message={error?.message} onRetry={() => void refetch()} />
        )}
      </Screen>
    );
  }

  const { snapshot } = result;
  const canWrite = result.origin === "network";
  const weekStart = addDays(getWeekStart(now), offset);
  // Ausschließlich die veröffentlichte Version (der Cache enthält nie Entwürfe).
  const week = snapshot.weeks.find((w) => w.week_start === weekStart && w.status === "published");
  const entries = week?.schedule_entries ?? [];
  const overlapIds = new Set(detectOverlaps(entries).flatMap((o) => [o.first.id, o.second.id]));
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const goals = getWeekGoals({
    targets: snapshot.goalTargets,
    entries,
    sessions: snapshot.sessions,
    weekStart,
    now,
  });

  const openDay = (entry: ScheduleEntry) => {
    setDetailsOpen(false);
    setFullscreen(false);
    router.push({ pathname: "/tag", params: { date: toLocalDate(new Date(entry.start_at)) } });
  };

  return (
    <Screen refreshing={isFetching} onRefresh={() => void refetch()} footer={<RunningTimerBar />}>
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: theme.textSubtle }]}>
          {offset === 0 ? "DIESE WOCHE" : "NÄCHSTE WOCHE"}
        </Text>
        <Title>{formatWeekLabel(weekStart)}</Title>
        <Muted small>
          {week ? `Veröffentlicht · Version ${week.version}` : "Noch keine Version veröffentlicht"}
        </Muted>
      </View>

      <ChoiceChips
        label="Woche wählen"
        options={[
          { value: 0, label: "Diese Woche" },
          { value: 7, label: "Nächste Woche" },
        ]}
        value={offset}
        onChange={(value) => {
          setOffset(value);
          setSelectedId(null);
          setDetailsOpen(false);
        }}
      />

      <StatusBanner
        origin={result.origin}
        fetchedAt={snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />

      {!week ? (
        <Notice tone="info" title="Für diese Woche ist noch kein Plan veröffentlicht.">
          Über „Plan bearbeiten“ lässt sich ein Entwurf anlegen und veröffentlichen.
        </Notice>
      ) : (
        <WeekGridFrame
          title={formatWeekLabel(weekStart)}
          weekStart={weekStart}
          entries={entries}
          overlapIds={overlapIds}
          now={now}
          selectedId={selectedId}
          onSelect={(entry) => {
            setSelectedId(entry.id);
            setDetailsOpen(true);
          }}
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
          overlay={
            detailsOpen ? (
              <BlockDetailsSheet
                entry={selected}
                overlapping={
                  selected && overlapIds.has(selected.id)
                    ? entries.filter((e) => e.id !== selected.id && blocksOverlap(e, selected))
                    : []
                }
                now={now}
                onClose={() => setDetailsOpen(false)}
                onOpenDay={openDay}
              />
            ) : null
          }
        />
      )}

      <View style={styles.actions}>
        <Button
          label="Plan bearbeiten"
          icon={PencilLine}
          flex
          disabled={!canWrite}
          accessibilityHint="Öffnet den Entwurf dieser Woche. Veröffentlicht wird erst nach Bestätigung."
          onPress={() => router.push({ pathname: "/bearbeiten", params: { week: weekStart } })}
        />
        <Button
          label="Wochenbilanz"
          icon={ChartColumn}
          flex
          onPress={() => router.push("/wochenbilanz")}
        />
      </View>
      {!canWrite ? (
        <Muted small>
          Bearbeiten ist nur mit Verbindung möglich – offline wird nichts gespeichert.
        </Muted>
      ) : null}

      <Section title="Ziele">
        <GoalList goals={goals} compact />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  eyebrow: { fontSize: 12, fontWeight: "600", letterSpacing: 1 },
  actions: { flexDirection: "row", gap: spacing.sm },
});

import { categoryTone } from "@tagestakt/design-tokens";
import {
  WEEKDAY_SHORT_LABELS,
  addDays,
  formatLocalDateLong,
  getDayBounds,
  getEntriesForDay,
  getWeekDays,
  getWeekStart,
  isGoalKey,
  isValidLocalDate,
  isoWeekdayOfLocalDate,
  parseLocalDate,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { SessionList } from "@/components/session-list";
import { StatusBanner } from "@/components/status-banner";
import { RunningTimerBar } from "@/components/timer-bar";
import { Timeline } from "@/components/timeline";
import { Muted, Notice, Section, Title } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { spacing, useTheme } from "@/theme";

export default function DayScreen() {
  const now = useNow(30_000);
  const theme = useTheme();
  const router = useRouter();
  const today = toLocalDate(now);
  const params = useLocalSearchParams<{ date?: string }>();
  const requested =
    typeof params.date === "string" && isValidLocalDate(params.date) ? params.date : null;
  const [selected, setSelected] = useState(requested ?? today);
  // Aus der Wochenansicht geöffnet: gewünschten Tag übernehmen (einmal je neuem Parameter).
  const [seenRequest, setSeenRequest] = useState(requested);
  if (requested !== seenRequest) {
    setSeenRequest(requested);
    if (requested) setSelected(requested);
  }
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
  const all = snapshot.weeks.flatMap((week) => week.schedule_entries);
  const entries = getEntriesForDay(all, selected);
  const weekStart = getWeekStart(selected);
  const thisWeek = getWeekStart(now);
  const bounds = getDayBounds(selected);
  const daySessions = snapshot.sessions.filter(
    (s) =>
      Date.parse(s.started_at) < bounds.end.getTime() &&
      (s.ended_at === null || Date.parse(s.ended_at) > bounds.start.getTime()),
  );

  return (
    <Screen refreshing={isFetching} onRefresh={() => void refetch()} footer={<RunningTimerBar />}>
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: theme.textSubtle }]}>
          {selected === today ? "HEUTE" : selected === addDays(today, 1) ? "MORGEN" : "TAG"}
        </Text>
        <Title>{formatLocalDateLong(selected)}</Title>
      </View>

      <View style={styles.weekNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Vorherige Woche"
          disabled={weekStart <= addDays(thisWeek, -7)}
          onPress={() => setSelected(addDays(weekStart, -7))}
          style={[styles.arrow, { opacity: weekStart <= addDays(thisWeek, -7) ? 0.35 : 1 }]}
        >
          <ChevronLeft color={theme.text} size={22} />
        </Pressable>
        <View style={styles.days} accessibilityRole="tablist">
          {getWeekDays(weekStart).map((date) => {
            const isSelected = date === selected;
            const goals = [
              ...new Set(
                getEntriesForDay(all, date)
                  .map((e) => e.category)
                  .filter(isGoalKey),
              ),
            ];
            return (
              <Pressable
                key={date}
                accessibilityRole="tab"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${formatLocalDateLong(date)}${date === today ? ", heute" : ""}`}
                onPress={() => setSelected(date)}
                style={[styles.day, isSelected ? { backgroundColor: theme.inverse } : null]}
              >
                <Text
                  style={[
                    styles.dayName,
                    { color: isSelected ? theme.onInverse : theme.textMuted },
                  ]}
                >
                  {WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(date)]}
                </Text>
                <Text
                  style={[styles.dayNumber, { color: isSelected ? theme.onInverse : theme.text }]}
                >
                  {parseLocalDate(date).day}
                </Text>
                <View style={styles.marks}>
                  {goals.map((goal) => (
                    <View
                      key={goal}
                      style={[styles.mark, { backgroundColor: theme[categoryTone[goal]] }]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Nächste Woche"
          disabled={weekStart >= addDays(thisWeek, 7)}
          onPress={() => setSelected(addDays(weekStart, 7))}
          style={[styles.arrow, { opacity: weekStart >= addDays(thisWeek, 7) ? 0.35 : 1 }]}
        >
          <ChevronRight color={theme.text} size={22} />
        </Pressable>
      </View>

      <StatusBanner
        origin={result.origin}
        fetchedAt={snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />

      {entries.length === 0 ? (
        <Notice tone="info" title="Für diesen Tag ist nichts veröffentlicht." />
      ) : (
        <Timeline date={selected} entries={entries} sessions={snapshot.sessions} now={now} />
      )}

      <Section title={selected === today ? "Erfasst heute" : "Erfasst an diesem Tag"}>
        <SessionList
          sessions={daySessions}
          now={now}
          canWrite={result.origin === "network"}
          onCorrect={(id) => router.push({ pathname: "/korrigieren", params: { id } })}
          emptyText="Noch keine Zeit erfasst."
        />
        {result.origin === "cache" ? (
          <Muted small>Korrigieren ist erst wieder mit Verbindung möglich.</Muted>
        ) : null}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  eyebrow: { fontSize: 12, fontWeight: "600", letterSpacing: 1 },
  weekNav: { flexDirection: "row", alignItems: "center", gap: 2 },
  arrow: { width: 32, height: 56, alignItems: "center", justifyContent: "center" },
  days: { flex: 1, flexDirection: "row", gap: 2 },
  day: {
    flex: 1,
    minHeight: 60,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: spacing.xs,
  },
  dayName: { fontSize: 12, fontWeight: "600" },
  dayNumber: { fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] },
  marks: { flexDirection: "row", gap: 2, height: 4 },
  mark: { width: 4, height: 4, borderRadius: 2 },
});

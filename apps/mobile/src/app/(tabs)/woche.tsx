import { categoryTone } from "@tagestakt/design-tokens";
import {
  WEEKDAY_SHORT_LABELS,
  addDays,
  detectOverlaps,
  formatLocalDateShort,
  formatTime,
  formatWeekLabel,
  getWeekGoals,
  getWeekStart,
  groupEntriesByDay,
  isoWeekdayOfLocalDate,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { useRouter } from "expo-router";
import { ChartColumn, PencilLine } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { GoalList } from "@/components/goal-progress";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { StatusBanner } from "@/components/status-banner";
import { RunningTimerBar } from "@/components/timer-bar";
import { Button, ChoiceChips, Muted, Notice, Section, Title } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { spacing, tint, useTheme } from "@/theme";

const MAX_PER_DAY = 4;

export default function WeekScreen() {
  const now = useNow(60_000);
  const theme = useTheme();
  const router = useRouter();
  const [offset, setOffset] = useState<0 | 7>(0);
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
  const today = toLocalDate(now);
  // Ausschließlich die veröffentlichte Version (der Cache enthält nie Entwürfe).
  const week = snapshot.weeks.find((w) => w.week_start === weekStart && w.status === "published");
  const entries = week?.schedule_entries ?? [];
  const days = groupEntriesByDay(entries, weekStart);
  const overlapIds = new Set(detectOverlaps(entries).flatMap((o) => [o.first.id, o.second.id]));
  const goals = getWeekGoals({
    targets: snapshot.goalTargets,
    entries,
    sessions: snapshot.sessions,
    weekStart,
    now,
  });

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
        onChange={setOffset}
      />

      <StatusBanner
        origin={result.origin}
        fetchedAt={snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />

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

      {!week ? (
        <Notice tone="info" title="Für diese Woche ist noch kein Plan veröffentlicht.">
          Über „Plan bearbeiten“ lässt sich ein Entwurf anlegen und veröffentlichen.
        </Notice>
      ) : (
        <Section title="Tage">
          <View style={styles.days}>
            {days.map((day) => {
              const isToday = day.date === today;
              const shown = day.entries.slice(0, MAX_PER_DAY);
              const more = day.entries.length - shown.length;
              return (
                <Pressable
                  key={day.date}
                  accessibilityRole="button"
                  accessibilityLabel={`${WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(day.date)]} ${formatLocalDateShort(day.date)}${isToday ? ", heute" : ""}, ${day.entries.length === 0 ? "nichts geplant" : `${day.entries.length} Blöcke`}`}
                  accessibilityHint="Öffnet den Tag"
                  onPress={() => router.push({ pathname: "/tag", params: { date: day.date } })}
                  style={({ pressed }) => [
                    styles.day,
                    {
                      backgroundColor: pressed ? theme.surface2 : theme.surface1,
                      borderColor: isToday ? theme.lineStrong : theme.line,
                    },
                  ]}
                >
                  <View style={styles.dayHead}>
                    <Text style={[styles.dayName, { color: theme.text }]}>
                      {WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(day.date)]}
                    </Text>
                    <Text style={[styles.dayDate, { color: theme.textMuted }]}>
                      {formatLocalDateShort(day.date)}
                    </Text>
                    {isToday ? (
                      <Text
                        style={[
                          styles.today,
                          { color: theme.onInverse, backgroundColor: theme.inverse },
                        ]}
                      >
                        heute
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.blocks}>
                    {shown.length === 0 ? (
                      <Text style={[styles.empty, { color: theme.textSubtle }]}>frei</Text>
                    ) : (
                      shown.map((entry) => {
                        const color = theme[categoryTone[entry.category]];
                        return (
                          <View
                            key={entry.id}
                            style={[
                              styles.block,
                              { backgroundColor: tint(color, 0.1), borderLeftColor: color },
                            ]}
                          >
                            <Text style={[styles.blockTime, { color: theme.textMuted }]}>
                              {toLocalDate(new Date(entry.start_at)) === day.date
                                ? formatTime(entry.start_at)
                                : "↳"}
                            </Text>
                            <Text
                              style={[
                                styles.blockTitle,
                                {
                                  color: theme.text,
                                  textDecorationLine:
                                    entry.completion_status === "skipped" ? "line-through" : "none",
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {entry.title}
                            </Text>
                            {overlapIds.has(entry.id) ? (
                              <Text style={[styles.overlap, { color: theme.warning }]}>
                                Überschneidung
                              </Text>
                            ) : null}
                          </View>
                        );
                      })
                    )}
                    {more > 0 ? (
                      <Text style={[styles.more, { color: theme.textMuted }]}>
                        + {more} weitere
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  eyebrow: { fontSize: 12, fontWeight: "600", letterSpacing: 1 },
  actions: { flexDirection: "row", gap: spacing.sm },
  days: { gap: spacing.sm },
  day: { borderWidth: 1, borderRadius: 14, padding: spacing.md, gap: spacing.sm },
  dayHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dayName: { fontSize: 15, fontWeight: "700" },
  dayDate: { fontSize: 13, fontVariant: ["tabular-nums"] },
  today: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
    overflow: "hidden",
  },
  blocks: { gap: 4 },
  block: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  blockTime: { width: 40, fontSize: 13, fontVariant: ["tabular-nums"] },
  blockTitle: { flex: 1, fontSize: 14, fontWeight: "600" },
  overlap: { fontSize: 12, fontWeight: "700" },
  empty: { fontSize: 13, fontStyle: "italic" },
  more: { fontSize: 13, fontWeight: "600", paddingLeft: spacing.sm },
});

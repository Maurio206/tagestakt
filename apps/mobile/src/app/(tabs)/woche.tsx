import {
  addDays,
  formatLocalDateLong,
  formatWeekLabel,
  getEntryTimeState,
  getWeekStart,
  groupEntriesByDay,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { EntryRow } from "@/components/entry-row";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { StatusBanner } from "@/components/status-banner";
import { Body, Button, Card, Eyebrow, Muted } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { spacing, useTheme } from "@/theme";

export default function WeekScreen() {
  const now = useNow(60_000);
  const theme = useTheme();
  const [nextWeek, setNextWeek] = useState(false);
  const { result, isLoading, isFetching, error, refetch } = usePlan();

  if (!result) {
    return (
      <Screen>
        {isLoading ? (
          <ActivityIndicator color={theme.accent} accessibilityLabel="Plan wird geladen" />
        ) : (
          <PlanError message={error?.message} onRetry={() => void refetch()} />
        )}
      </Screen>
    );
  }

  const weekStart = addDays(getWeekStart(now), nextWeek ? 7 : 0);
  // Ausschließlich die veröffentlichte Version (der Cache enthält nie Entwürfe).
  const week = result.snapshot.weeks.find(
    (w) => w.week_start === weekStart && w.status === "published",
  );
  const today = toLocalDate(now);

  return (
    <Screen refreshing={isFetching} onRefresh={() => void refetch()}>
      <View>
        <Eyebrow>{nextWeek ? "Nächste Woche" : "Diese Woche"}</Eyebrow>
        <Body bold>{formatWeekLabel(weekStart)}</Body>
        {week ? <Muted>Veröffentlichte Version {week.version}</Muted> : null}
      </View>
      <View style={styles.nav}>
        <View style={styles.navItem}>
          <Button
            label="Diese Woche"
            variant={nextWeek ? "secondary" : "primary"}
            onPress={() => setNextWeek(false)}
          />
        </View>
        <View style={styles.navItem}>
          <Button
            label="Nächste Woche"
            variant={nextWeek ? "primary" : "secondary"}
            onPress={() => setNextWeek(true)}
          />
        </View>
      </View>
      <StatusBanner
        origin={result.origin}
        fetchedAt={result.snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />
      {!week ? (
        <Card>
          <Body>Für diese Woche ist noch kein Plan veröffentlicht.</Body>
        </Card>
      ) : (
        groupEntriesByDay(week.schedule_entries, weekStart).map((day) => (
          <View key={day.date} style={styles.day}>
            <Text
              accessibilityRole="header"
              style={[
                styles.dayTitle,
                {
                  color: day.date === today ? theme.accent : theme.text,
                  borderColor: theme.border,
                },
              ]}
            >
              {formatLocalDateLong(day.date)}
              {day.date === today ? " · Heute" : ""}
            </Text>
            {day.entries.length === 0 ? (
              <Muted>Keine Einträge.</Muted>
            ) : (
              day.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} state={getEntryTimeState(entry, now)} />
              ))
            )}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  navItem: {
    flex: 1,
  },
  day: {
    gap: spacing.sm,
  },
  dayTitle: {
    fontSize: 18,
    fontWeight: "700",
    borderBottomWidth: 1,
    paddingBottom: spacing.xs,
  },
});

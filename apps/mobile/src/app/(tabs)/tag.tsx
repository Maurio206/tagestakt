import {
  addDays,
  formatLocalDateLong,
  getEntriesForDay,
  getEntryTimeState,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { EntryRow } from "@/components/entry-row";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { StatusBanner } from "@/components/status-banner";
import { Body, Button, Card, Eyebrow } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { spacing, useTheme } from "@/theme";

export default function DayScreen() {
  const now = useNow(30_000);
  const theme = useTheme();
  const today = toLocalDate(now);
  const [offset, setOffset] = useState(0);
  const date = addDays(today, offset);
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

  const entries = getEntriesForDay(
    result.snapshot.weeks.flatMap((week) => week.schedule_entries),
    date,
  );

  return (
    <Screen refreshing={isFetching} onRefresh={() => void refetch()}>
      <View>
        <Eyebrow>
          {offset === 0 ? "Heute" : offset === 1 ? "Morgen" : offset === -1 ? "Gestern" : "Tag"}
        </Eyebrow>
        <Body bold>{formatLocalDateLong(date, true)}</Body>
      </View>
      <View style={styles.nav}>
        <View style={styles.navItem}>
          <Button
            label="← Vortag"
            variant="secondary"
            onPress={() => setOffset((o) => o - 1)}
            disabled={offset <= -7}
          />
        </View>
        <View style={styles.navItem}>
          <Button
            label="Heute"
            variant="secondary"
            onPress={() => setOffset(0)}
            disabled={offset === 0}
          />
        </View>
        <View style={styles.navItem}>
          <Button
            label="Folgetag →"
            variant="secondary"
            onPress={() => setOffset((o) => o + 1)}
            disabled={offset >= 13}
          />
        </View>
      </View>
      <StatusBanner
        origin={result.origin}
        fetchedAt={result.snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />
      {entries.length === 0 ? (
        <Card>
          <Body>Für diesen Tag ist nichts veröffentlicht.</Body>
        </Card>
      ) : (
        <View style={styles.list} accessibilityRole="list">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} state={getEntryTimeState(entry, now)} />
          ))}
        </View>
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
  list: {
    gap: spacing.sm,
  },
});

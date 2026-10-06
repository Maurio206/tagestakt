import {
  COMPLETION_STATUS_LABELS,
  type EntryTimeState,
  type ScheduleEntry,
  formatTimeRange,
} from "@tagestakt/schedule-schema";
import { StyleSheet, Text, View } from "react-native";

import { spacing, useTheme } from "@/theme";

import { CategoryPill } from "./ui";

const STATE_LABELS: Record<EntryTimeState, string> = {
  past: "vorbei",
  current: "läuft gerade",
  future: "geplant",
};

/** Ein Block in Tages-/Wochenansicht; vergangen, aktuell und zukünftig sind klar unterscheidbar. */
export function EntryRow({ entry, state }: { entry: ScheduleEntry; state: EntryTimeState }) {
  const theme = useTheme();
  const isCurrent = state === "current";
  return (
    <View
      accessible
      accessibilityLabel={`${formatTimeRange(entry.start_at, entry.end_at)}, ${entry.title}, ${STATE_LABELS[state]}`}
      style={[
        styles.row,
        {
          backgroundColor: theme.surface,
          borderColor: isCurrent ? theme.accent : theme.border,
          borderWidth: isCurrent ? 2 : 1,
          opacity: state === "past" ? 0.55 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.time, { color: theme.text }]}>
          {formatTimeRange(entry.start_at, entry.end_at)}
        </Text>
        {isCurrent ? (
          <Text style={[styles.badge, { color: theme.accentText, backgroundColor: theme.accent }]}>
            JETZT
          </Text>
        ) : null}
        {state === "past" ? (
          <Text style={[styles.stateText, { color: theme.textMuted }]}>vorbei</Text>
        ) : null}
      </View>
      <Text
        style={[
          styles.title,
          {
            color: theme.text,
            textDecorationLine: entry.completion_status === "skipped" ? "line-through" : "none",
          },
        ]}
      >
        {entry.title}
      </Text>
      <View style={styles.meta}>
        <CategoryPill category={entry.category} />
        {entry.completion_status !== "planned" ? (
          <Text style={{ color: theme.textMuted }}>
            {COMPLETION_STATUS_LABELS[entry.completion_status]}
          </Text>
        ) : null}
      </View>
      {entry.location ? (
        <Text style={{ color: theme.textMuted }}>Ort: {entry.location}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  time: {
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  badge: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
  stateText: {
    fontSize: 13,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
});

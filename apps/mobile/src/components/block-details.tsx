import {
  COMPLETION_STATUS_LABELS,
  type ScheduleEntry,
  formatDuration,
  formatLocalDateLong,
  formatTimeRange,
  getEntryDurationMinutes,
  getEntryTimeState,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { CalendarDays } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { spacing, useTheme } from "@/theme";

import { Sheet } from "./sheet";
import { Button, CategoryPill, Notice } from "./ui";

/**
 * Details eines Planblocks als Blatt über dem Wochenraster – das Raster bleibt dahinter an
 * seiner Position. Weiter geht es in die vorhandene Tagesansicht („Tag öffnen“).
 */
export function BlockDetailsSheet({
  entry,
  overlapping,
  now,
  onClose,
  onOpenDay,
}: {
  entry: ScheduleEntry | null;
  /** Gleichzeitig geplante Blöcke (Überschneidung). */
  overlapping: readonly ScheduleEntry[];
  now: Date;
  onClose: () => void;
  onOpenDay: (entry: ScheduleEntry) => void;
}) {
  const theme = useTheme();
  if (!entry) return null;
  const state = getEntryTimeState(entry, now);
  const date = toLocalDate(new Date(entry.start_at));
  const rows: [string, string][] = [
    ["Tag", formatLocalDateLong(date)],
    [
      "Zeit",
      `${formatTimeRange(entry.start_at, entry.end_at)} · ${formatDuration(getEntryDurationMinutes(entry))}`,
    ],
    [
      "Status",
      state === "current"
        ? `läuft gerade · ${COMPLETION_STATUS_LABELS[entry.completion_status]}`
        : COMPLETION_STATUS_LABELS[entry.completion_status],
    ],
  ];
  if (entry.location) rows.push(["Ort", entry.location]);

  return (
    <Sheet visible title={entry.title} onClose={onClose}>
      <View testID="block-details" style={styles.body}>
        <CategoryPill category={entry.category} />
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
            <Text style={[styles.label, { color: theme.textSubtle }]}>{label}</Text>
            <Text style={[styles.value, { color: theme.text }]}>{value}</Text>
          </View>
        ))}
        {overlapping.length > 0 ? (
          <Notice tone="warning" title="Überschneidung">
            {`Gleichzeitig geplant: ${overlapping
              .map((other) => `„${other.title}“ (${formatTimeRange(other.start_at, other.end_at)})`)
              .join(", ")}`}
          </Notice>
        ) : null}
      </View>
      <Button
        label="Tag öffnen"
        icon={CalendarDays}
        accessibilityHint="Zeigt den Tag mit Zeitstrahl und erfasster Zeit"
        onPress={() => onOpenDay(entry)}
      />
      <Button label="Schließen" variant="ghost" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  row: { gap: 2 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  value: { fontSize: 16, fontVariant: ["tabular-nums"] },
});

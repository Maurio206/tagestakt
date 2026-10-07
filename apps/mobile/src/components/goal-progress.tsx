import { categoryTone, goalStatusStyle } from "@tagestakt/design-tokens";
import {
  GOAL_STATUS_LABELS,
  type GoalProgress,
  type GoalStatus,
  formatGoalAmount,
} from "@tagestakt/schedule-schema";
import { StyleSheet, Text, View } from "react-native";

import { type Theme, spacing, tint, type, useTheme } from "@/theme";

import { GoalStatusIcon, ToneIcon } from "./icons";

function statusColors(theme: Theme, status: GoalStatus) {
  switch (goalStatusStyle[status].tone) {
    case "warning":
      return { fg: theme.warning, bg: theme.warningBg, border: "transparent" };
    case "success":
      return { fg: theme.success, bg: theme.successBg, border: "transparent" };
    case "unset":
      return { fg: theme.textMuted, bg: "transparent", border: theme.lineStrong };
    default:
      return { fg: theme.text, bg: theme.surface3, border: "transparent" };
  }
}

/** Status als Wort + Symbol (nie nur Farbe). */
export function GoalStatusChip({ status }: { status: GoalStatus }) {
  const theme = useTheme();
  const colors = statusColors(theme, status);
  return (
    <View
      style={[
        styles.status,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          borderStyle: status === "unset" ? "dashed" : "solid",
        },
      ]}
    >
      <GoalStatusIcon status={status} color={colors.fg} size={15} />
      <Text style={[styles.statusText, { color: colors.fg }]}>{GOAL_STATUS_LABELS[status]}</Text>
    </View>
  );
}

/** Balken: gestrichelt = geplant, gefüllt = erfasst, Strich = Ziel (dekorativ). */
export function GoalBar({ progress }: { progress: GoalProgress }) {
  const theme = useTheme();
  const color = theme[categoryTone[progress.goal]];
  const target = progress.targetMinutes;
  if (target === null) {
    return (
      <View
        style={[
          styles.bar,
          {
            backgroundColor: theme.surface3,
            borderColor: theme.lineStrong,
            borderStyle: "dashed",
            borderWidth: 1,
          },
        ]}
      />
    );
  }
  const max = Math.max(target, progress.plannedMinutes, progress.trackedMinutes, 1);
  const pct = (value: number) => `${Math.min(100, (value / max) * 100)}%` as const;
  return (
    <View style={[styles.bar, { backgroundColor: theme.surface3 }]}>
      <View
        style={[
          styles.fill,
          {
            width: pct(progress.plannedMinutes),
            borderColor: color,
            borderStyle: "dashed",
            borderWidth: 1.5,
          },
        ]}
      />
      <View
        style={[styles.fill, { width: pct(progress.trackedMinutes), backgroundColor: color }]}
      />
      <View style={[styles.target, { left: pct(target), backgroundColor: theme.text }]} />
    </View>
  );
}

export function GoalLegend() {
  const theme = useTheme();
  return (
    <View
      style={styles.legend}
      accessible
      accessibilityLabel="Legende: gefüllt erfasst, gestrichelt geplant, Strich Wochenziel"
    >
      <View style={styles.legendItem}>
        <View style={[styles.legendAct, { backgroundColor: theme.textMuted }]} />
        <Text style={[styles.legendText, { color: theme.textSubtle }]}>erfasst</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendPlan, { borderColor: theme.textMuted }]} />
        <Text style={[styles.legendText, { color: theme.textSubtle }]}>geplant</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendTarget, { backgroundColor: theme.text }]} />
        <Text style={[styles.legendText, { color: theme.textSubtle }]}>Wochenziel</Text>
      </View>
    </View>
  );
}

/** Zielzeile: Name, Status, Werte, Balken und (optional) sachlicher Satz. */
export function GoalRow({ progress, compact }: { progress: GoalProgress; compact?: boolean }) {
  const theme = useTheme();
  const tone = categoryTone[progress.goal];
  const values = `${formatGoalAmount(progress.trackedMinutes)} erfasst · ${formatGoalAmount(progress.plannedMinutes)} geplant${
    progress.targetMinutes !== null ? ` · Ziel ${formatGoalAmount(progress.targetMinutes)}` : ""
  }`;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${progress.label}, ${GOAL_STATUS_LABELS[progress.status]}, ${values}. ${progress.sentence}`}
    >
      <View style={styles.top}>
        <View style={styles.name}>
          <ToneIcon tone={tone} color={theme[tone]} size={19} />
          <Text style={[styles.nameText, { color: theme.text }]}>{progress.label}</Text>
        </View>
        <GoalStatusChip status={progress.status} />
      </View>
      <Text style={[styles.values, { color: theme.textMuted }]}>{values}</Text>
      <GoalBar progress={progress} />
      {compact ? null : (
        <Text style={[styles.sentence, { color: theme.textMuted }]}>{progress.sentence}</Text>
      )}
    </View>
  );
}

export function GoalList({
  goals,
  compact,
}: {
  goals: readonly GoalProgress[];
  compact?: boolean;
}) {
  return (
    <View style={styles.list}>
      {goals.map((goal) => (
        <GoalRow key={goal.goal} progress={goal} compact={compact} />
      ))}
    </View>
  );
}

/** Ton-Hintergrund für Zeilen mit Ziel-Bezug (z. B. Timer-Leiste). */
export function goalTint(theme: Theme, goal: GoalProgress["goal"], alpha = 0.14): string {
  return tint(theme[categoryTone[goal]], alpha);
}

const styles = StyleSheet.create({
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: { fontSize: 13, fontWeight: "700" },
  bar: { height: 12, borderRadius: 6, overflow: "visible", position: "relative" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 6 },
  target: { position: "absolute", top: -4, bottom: -4, width: 2, marginLeft: -1, borderRadius: 1 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendAct: { width: 14, height: 8, borderRadius: 4 },
  legendPlan: { width: 14, height: 8, borderRadius: 4, borderWidth: 1.5, borderStyle: "dashed" },
  legendTarget: { width: 2, height: 12 },
  legendText: { fontSize: 12 },
  row: { gap: spacing.sm },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  name: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameText: { fontSize: 17, fontWeight: "700" },
  values: { ...type.small, fontVariant: ["tabular-nums"] },
  sentence: { ...type.small },
  list: { gap: spacing.xl },
});

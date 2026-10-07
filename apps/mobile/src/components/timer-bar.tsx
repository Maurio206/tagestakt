import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  GOAL_LABELS,
  getRunningSession,
  requiresCorrectionToStop,
} from "@tagestakt/schedule-schema";
import { Square } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useActivityActions } from "@/hooks/use-activity";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { spacing, tint, useTheme } from "@/theme";

import { FocusTimer } from "./focus-timer";

/** Kompakte Leiste der laufenden Aktivität über der Tab-Leiste (alle Tabs außer „Jetzt“). */
export function TimerBar({
  session,
  canStop,
  onStop,
  pending,
}: {
  session: ActivitySession;
  canStop: boolean;
  onStop: () => void;
  pending: boolean;
}) {
  const theme = useTheme();
  const color = theme[categoryTone[session.goal_category]];
  return (
    <View
      style={[styles.bar, { backgroundColor: theme.surface2, borderColor: theme.line }]}
      accessibilityLabel={`${GOAL_LABELS[session.goal_category]} läuft: ${session.title}`}
    >
      <View style={[styles.dot, { backgroundColor: color, borderColor: tint(color, 0.3) }]} />
      <View style={styles.what}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
          {session.title}
        </Text>
        <Text style={[styles.goal, { color: theme.textMuted }]}>
          {GOAL_LABELS[session.goal_category]}
        </Text>
      </View>
      <FocusTimer startedAt={session.started_at} size="sm" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${GOAL_LABELS[session.goal_category]} beenden`}
        accessibilityState={{ disabled: !canStop || pending }}
        disabled={!canStop || pending}
        onPress={onStop}
        style={[
          styles.stop,
          { backgroundColor: theme.inverse, opacity: !canStop || pending ? 0.45 : 1 },
        ]}
      >
        <Square color={theme.onInverse} size={18} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

/** Verbundene Variante: liest den Plan und beendet über die Server-RPC. */
export function RunningTimerBar() {
  const { result } = usePlan();
  const now = useNow(30_000);
  const canWrite = result?.origin === "network";
  const actions = useActivityActions(canWrite);
  const session = result ? getRunningSession(result.snapshot.sessions) : undefined;
  if (!session) return null;
  return (
    <TimerBar
      session={session}
      canStop={canWrite && !requiresCorrectionToStop(session, now)}
      pending={actions.pending}
      onStop={() => void actions.stop(session.id)}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3 },
  what: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "700" },
  goal: { fontSize: 13 },
  stop: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});

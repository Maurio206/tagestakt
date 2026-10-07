import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  GOAL_LABELS,
  formatDuration,
  formatLocalDateShort,
  formatTime,
  getSessionMinutes,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { Pencil } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { spacing, useTheme } from "@/theme";

import { ToneIcon } from "./icons";
import { Muted } from "./ui";

/** Erfasste Aktivitäten mit „Zeit korrigieren“ (neueste zuerst). */
export function SessionList({
  sessions,
  now,
  onCorrect,
  canWrite,
  showDate = false,
  emptyText,
}: {
  sessions: readonly ActivitySession[];
  now: Date;
  onCorrect: (sessionId: string) => void;
  canWrite: boolean;
  showDate?: boolean;
  emptyText: string;
}) {
  const theme = useTheme();
  if (sessions.length === 0) return <Muted>{emptyText}</Muted>;
  return (
    <View style={[styles.list, { borderColor: theme.line, backgroundColor: theme.surface1 }]}>
      {[...sessions].reverse().map((session, index) => {
        const tone = categoryTone[session.goal_category];
        const start = new Date(session.started_at);
        const when = `${showDate ? `${formatLocalDateShort(toLocalDate(start))} ` : ""}${formatTime(start)}–${
          session.ended_at ? formatTime(session.ended_at) : "läuft"
        }`;
        const duration = formatDuration(getSessionMinutes(session, now));
        return (
          <View
            key={session.id}
            style={[
              styles.row,
              index > 0
                ? { borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth }
                : null,
            ]}
          >
            <ToneIcon tone={tone} color={theme[tone]} size={20} />
            <View
              style={styles.body}
              accessible
              accessibilityLabel={`${GOAL_LABELS[session.goal_category]}, ${session.title}, ${when}, ${duration}${session.corrected_at ? ", korrigiert" : ""}`}
            >
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                {session.title}
              </Text>
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                {when} · {duration}
                {session.corrected_at ? " · korrigiert" : ""}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Zeit von „${session.title}“ korrigieren`}
              accessibilityState={{ disabled: !canWrite }}
              disabled={!canWrite}
              onPress={() => onCorrect(session.id)}
              style={[styles.action, { opacity: canWrite ? 1 : 0.45 }]}
            >
              <Pencil color={theme.text} size={18} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  body: { flex: 1, gap: 2, paddingVertical: spacing.sm },
  title: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 13, fontVariant: ["tabular-nums"] },
  action: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
});

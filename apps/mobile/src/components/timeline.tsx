import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  CATEGORY_LABELS,
  COMPLETION_STATUS_LABELS,
  type LocalDate,
  type ScheduleEntry,
  formatDuration,
  formatTime,
  formatTimeRange,
  getDayBounds,
  getEntryTimeState,
  getSessionMinutes,
  isGoalKey,
} from "@tagestakt/schedule-schema";
import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";

import { blockStyle, monoFamily, spacing, useTheme } from "@/theme";

const MIN_GAP_MINUTES = 30;

/** Erfasste Zeit eines Planblocks: verknüpfte bzw. überlappende Aktivitäten desselben Ziels. */
function trackedFor(entry: ScheduleEntry, sessions: readonly ActivitySession[], now: Date) {
  if (!isGoalKey(entry.category)) return { minutes: 0, running: false };
  const start = Date.parse(entry.start_at);
  const end = Date.parse(entry.end_at);
  let minutes = 0;
  let running = false;
  for (const session of sessions) {
    if (session.goal_category !== entry.category) continue;
    const sStart = Date.parse(session.started_at);
    const sEnd = session.ended_at ? Date.parse(session.ended_at) : now.getTime();
    const linked = session.schedule_entry_id === entry.id;
    const overlap = Math.min(end, sEnd) - Math.max(start, sStart);
    if (linked) {
      minutes += getSessionMinutes(session, now);
    } else if (overlap > 0) {
      minutes += Math.round(overlap / 60_000);
    } else continue;
    if (session.ended_at === null) running = true;
  }
  return { minutes, running };
}

function NowLine({ now }: { now: Date }) {
  const theme = useTheme();
  return (
    <View style={styles.nowLine} accessible accessibilityLabel={`Jetzt, ${formatTime(now)} Uhr`}>
      <Text style={[styles.nowLabel, { color: theme.onInverse, backgroundColor: theme.inverse }]}>
        {formatTime(now)}
      </Text>
      <View style={[styles.nowRule, { backgroundColor: theme.inverse }]} />
    </View>
  );
}

function GapRow({ minutes }: { minutes: number }) {
  const theme = useTheme();
  return (
    <View style={styles.item}>
      <View style={styles.time} />
      <View style={styles.rail}>
        <View style={[styles.railLine, { backgroundColor: theme.line }]} />
      </View>
      <Text style={[styles.gap, { color: theme.textSubtle }]}>
        frei · {formatDuration(minutes)}
      </Text>
    </View>
  );
}

/**
 * Zeitstrahl eines Tages: Zeit · Schiene · Block. Vergangenes ist gedämpft, der aktuelle
 * Block hervorgehoben; gefüllte Chips zeigen die erfasste Zeit (Plan = Umriss, Ist = Fläche).
 */
export function Timeline({
  date,
  entries,
  sessions,
  now,
}: {
  date: LocalDate;
  entries: readonly ScheduleEntry[];
  sessions: readonly ActivitySession[];
  now: Date;
}) {
  const theme = useTheme();
  const bounds = getDayBounds(date);
  const isToday = now >= bounds.start && now < bounds.end;

  // Lücken und die Jetzt-Linie vorab bestimmen (reine Berechnung, keine Seiteneffekte).
  const layout: { gapMinutes: number; showNowBefore: boolean }[] = [];
  let nowPlaced = !isToday;
  let previousEnd: number | null = null;
  for (const entry of entries) {
    const start = Date.parse(entry.start_at);
    const end = Date.parse(entry.end_at);
    const showNowBefore = !nowPlaced && now.getTime() < start;
    if (showNowBefore || getEntryTimeState(entry, now) === "current") nowPlaced = true;
    layout.push({
      gapMinutes: previousEnd !== null ? Math.round((start - previousEnd) / 60_000) : 0,
      showNowBefore,
    });
    previousEnd = Math.max(previousEnd ?? end, end);
  }
  const nowAtEnd = !nowPlaced;

  return (
    <View accessibilityRole="list">
      {entries.map((entry, index) => {
        const start = Date.parse(entry.start_at);
        const state = getEntryTimeState(entry, now);
        const continued = start < bounds.start.getTime();
        const color = theme[categoryTone[entry.category]];
        // Aktueller Block = Hauptphase, kommende regulär, vergangene als Nebenblock.
        const look = blockStyle(theme, entry.category, {
          emphasis: state === "current" ? "strong" : state === "past" ? "muted" : "base",
          skipped: entry.completion_status === "skipped",
        });
        const tracked = trackedFor(entry, sessions, now);
        const { gapMinutes, showNowBefore } = layout[index] ?? {
          gapMinutes: 0,
          showNowBefore: false,
        };

        return (
          <Fragment key={entry.id}>
            {gapMinutes >= MIN_GAP_MINUTES ? <GapRow minutes={gapMinutes} /> : null}
            {showNowBefore ? <NowLine now={now} /> : null}
            <View
              style={styles.item}
              accessible
              accessibilityLabel={`${formatTimeRange(entry.start_at, entry.end_at)}, ${entry.title}, ${CATEGORY_LABELS[entry.category]}${
                state === "current" ? ", läuft gerade" : state === "past" ? ", vorbei" : ""
              }${tracked.minutes > 0 ? `, ${formatDuration(tracked.minutes)} erfasst` : ""}`}
            >
              <Text style={[styles.timeText, { color: theme.textMuted }]}>
                {continued ? "↳" : formatTime(entry.start_at)}
              </Text>
              <View style={styles.rail}>
                <View style={[styles.railLine, { backgroundColor: theme.line }]} />
                <View
                  style={[
                    styles.dot,
                    state === "current" ? styles.dotCurrent : null,
                    {
                      borderColor: color,
                      backgroundColor: state === "future" ? theme.bg : color,
                      opacity: state === "past" ? 0.55 : 1,
                    },
                  ]}
                />
              </View>
              <View testID={`timeline-block-${state}`} style={[styles.block, look.container]}>
                <Text
                  style={[
                    styles.title,
                    {
                      color: look.text,
                      textDecorationLine:
                        entry.completion_status === "skipped" ? "line-through" : "none",
                    },
                  ]}
                >
                  {entry.title}
                </Text>
                <View style={styles.meta}>
                  <Text style={[styles.metaText, { color: look.textMuted }]}>
                    {formatTimeRange(entry.start_at, entry.end_at)} ·{" "}
                    {CATEGORY_LABELS[entry.category]}
                  </Text>
                  {entry.completion_status !== "planned" ? (
                    <Text style={[styles.metaText, { color: look.textMuted }]}>
                      {COMPLETION_STATUS_LABELS[entry.completion_status]}
                    </Text>
                  ) : null}
                </View>
                {tracked.minutes > 0 || tracked.running ? (
                  <View style={[styles.ist, { backgroundColor: color }]}>
                    <Text style={[styles.istText, { color: theme.onInverse }]}>
                      {tracked.running ? "läuft · " : "erfasst · "}
                      {formatDuration(tracked.minutes)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Fragment>
        );
      })}
      {nowAtEnd ? <NowLine now={now} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: "row", columnGap: 10 },
  time: { width: 48 },
  timeText: {
    width: 48,
    textAlign: "right",
    paddingTop: 13,
    fontFamily: monoFamily,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  rail: { width: 18, alignItems: "center" },
  railLine: { position: "absolute", top: 0, bottom: 0, width: 2 },
  dot: { marginTop: 16, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  dotCurrent: { width: 14, height: 14, borderRadius: 7 },
  block: {
    flex: 1,
    marginVertical: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  title: { fontSize: 16, fontWeight: "700" },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  metaText: { fontSize: 13, fontVariant: ["tabular-nums"] },
  ist: {
    alignSelf: "flex-start",
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    justifyContent: "center",
  },
  istText: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  nowLine: { flexDirection: "row", alignItems: "center", columnGap: 10, marginVertical: 2 },
  nowLabel: {
    width: 48,
    textAlign: "center",
    fontFamily: monoFamily,
    fontSize: 12,
    fontWeight: "700",
    borderRadius: 6,
    overflow: "hidden",
    paddingVertical: 2,
  },
  nowRule: { flex: 1, height: 2, borderRadius: 1 },
  gap: { flex: 1, paddingVertical: 8, fontSize: 13, fontStyle: "italic" },
});

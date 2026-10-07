import {
  type ScheduleEntry,
  formatDuration,
  formatHours,
  formatLocalDateLong,
  formatTime,
  formatTimeRange,
  getBusinessProgress,
  getCurrentEntry,
  getEntryProgress,
  getNextEntry,
  getRemainingMinutes,
  getWeekStart,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { StyleSheet, Text, View } from "react-native";

import { type PlanResult } from "@/lib/plan-status";
import { spacing, useTheme } from "@/theme";

import { StatusBanner } from "./status-banner";
import { Body, Card, CategoryPill, Eyebrow, Muted, ProgressBar } from "./ui";

function dayPrefix(entry: ScheduleEntry, now: Date): string {
  const date = toLocalDate(new Date(entry.start_at));
  return date === toLocalDate(now) ? "" : `${formatLocalDateLong(date)}, `;
}

/** Hauptansicht „Jetzt“: rein darstellend, damit sie ohne Netzwerk testbar ist. */
export function NowView({ result, now }: { result: PlanResult; now: Date }) {
  const theme = useTheme();
  const { snapshot } = result;
  const entries = snapshot.weeks.flatMap((week) => week.schedule_entries);
  const current = getCurrentEntry(entries, now);
  const next = getNextEntry(entries, now);
  const currentWeek = snapshot.weeks.find((week) => week.week_start === getWeekStart(now));
  const progress = getBusinessProgress(
    currentWeek?.schedule_entries ?? [],
    snapshot.goalTargets.business ?? 0,
  );

  return (
    <View style={styles.container}>
      <View accessible accessibilityLabel={`Es ist ${formatTime(now)} Uhr`}>
        <Text style={[styles.clock, { color: theme.text }]}>{formatTime(now)}</Text>
        <Muted>{formatLocalDateLong(toLocalDate(now))}</Muted>
      </View>

      <StatusBanner
        origin={result.origin}
        fetchedAt={snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />

      {!currentWeek ? (
        <Card>
          <Body>Für diese Woche ist noch kein Plan veröffentlicht.</Body>
        </Card>
      ) : null}

      <Card highlighted={Boolean(current)}>
        <Eyebrow>Jetzt</Eyebrow>
        {current ? (
          <>
            <Text style={[styles.nowTitle, { color: theme.text }]}>{current.title}</Text>
            <CategoryPill category={current.category} />
            <Body>
              {dayPrefix(current, now)}
              {formatTimeRange(current.start_at, current.end_at)}
            </Body>
            <Text style={[styles.remaining, { color: theme.text }]}>
              noch {formatDuration(getRemainingMinutes(current, now))}
            </Text>
            <ProgressBar
              ratio={getEntryProgress(current, now)}
              label="Fortschritt des aktuellen Blocks"
            />
          </>
        ) : (
          <Text style={[styles.nowTitle, { color: theme.text }]}>Kein geplanter Block</Text>
        )}
      </Card>

      <Card>
        <Eyebrow>Als Nächstes</Eyebrow>
        {next ? (
          <>
            <Text style={[styles.nextTitle, { color: theme.text }]}>{next.title}</Text>
            <CategoryPill category={next.category} />
            <Body>
              {dayPrefix(next, now)}
              {formatTimeRange(next.start_at, next.end_at)}
            </Body>
            <Muted>
              beginnt in{" "}
              {formatDuration(Math.ceil((Date.parse(next.start_at) - now.getTime()) / 60_000))}
            </Muted>
          </>
        ) : (
          <Body>Nichts mehr geplant.</Body>
        )}
      </Card>

      <Card>
        <Eyebrow>Gewerbe diese Woche</Eyebrow>
        <Body bold>
          {formatHours(progress.plannedMinutes)} von {formatHours(progress.targetMinutes)} geplant
        </Body>
        <ProgressBar
          ratio={progress.plannedRatio}
          secondaryRatio={progress.completedRatio}
          label="Geplante Gewerbezeit im Verhältnis zum Wochenziel"
        />
        <Muted>
          {formatHours(progress.completedMinutes)} erledigt
          {progress.missingPlannedMinutes > 0
            ? ` · ${formatHours(progress.missingPlannedMinutes)} fehlen noch in der Planung`
            : " · Ziel vollständig eingeplant"}
        </Muted>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  clock: {
    fontSize: 56,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    lineHeight: 64,
  },
  nowTitle: {
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
  },
  nextTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  remaining: {
    fontSize: 20,
    fontWeight: "700",
  },
});

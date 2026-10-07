import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  type CompletionStatus,
  GOAL_KEYS,
  GOAL_LABELS,
  type GoalKey,
  type ScheduleEntry,
  formatDuration,
  formatLocalDateLong,
  formatTime,
  formatTimeRange,
  formatWeekLabel,
  getCurrentEntry,
  getEntryProgress,
  getRemainingMinutes,
  getRunningSession,
  getSessionMinutes,
  getWeekGoals,
  getWeekStart,
  isGoalKey,
  isLikelyForgotten,
  requiresCorrectionToStop,
  sortEntries,
  toLocalDate,
  trackedEntryIdsFromSessions,
} from "@tagestakt/schedule-schema";
import { Check, Play, Square, X } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { type PlanResult } from "@/lib/plan-status";
import { OFFLINE_MESSAGE } from "@/lib/write-errors";
import { monoFamily, spacing, type, useTheme } from "@/theme";

import { FocusTimer } from "./focus-timer";
import { GoalList } from "./goal-progress";
import { ToneIcon } from "./icons";
import { Sheet } from "./sheet";
import { StatusBanner } from "./status-banner";
import { Button, CategoryPill, Muted, Notice, Section, ToneChip } from "./ui";

/** Aktionen der Jetzt-Ansicht; die Bildschirm-Komponente verbindet sie mit Server und Navigation. */
export interface NowActions {
  start: (goal: GoalKey, entryId: string | null) => void;
  stop: (sessionId: string) => void;
  switchTo: (runningId: string, goal: GoalKey, entryId: string | null) => void;
  discard: (sessionId: string) => void;
  setCompletion: (entryId: string, status: CompletionStatus) => void;
  openCorrection: (sessionId: string) => void;
  openGoals: () => void;
}

function dayPrefix(iso: string, now: Date): string {
  const date = toLocalDate(new Date(iso));
  return date === toLocalDate(now) ? "" : `${formatLocalDateLong(date)}, `;
}

function OfflineHint({ canWrite }: { canWrite: boolean }) {
  return canWrite ? null : <Muted small>{OFFLINE_MESSAGE}</Muted>;
}

function SpontaneousStart({
  actions,
  canWrite,
  pending,
  large,
}: {
  actions: NowActions;
  canWrite: boolean;
  pending: boolean;
  large: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.block}>
      <Text style={[styles.label, { color: theme.textMuted }]}>Aktivität starten</Text>
      <View style={styles.row}>
        {GOAL_KEYS.map((goal) => (
          <Pressable
            key={goal}
            accessibilityRole="button"
            accessibilityLabel={`Aktivität ${GOAL_LABELS[goal]} starten`}
            accessibilityState={{ disabled: !canWrite || pending }}
            disabled={!canWrite || pending}
            onPress={() => actions.start(goal, null)}
            style={[
              styles.goalButton,
              large ? styles.goalButtonLarge : null,
              {
                borderColor: theme.lineStrong,
                backgroundColor: theme.surface2,
                opacity: !canWrite || pending ? 0.45 : 1,
              },
            ]}
          >
            <ToneIcon tone={categoryTone[goal]} color={theme[categoryTone[goal]]} size={20} />
            <Text style={[styles.goalButtonText, { color: theme.text }]}>{GOAL_LABELS[goal]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Restzeit groß in Ziffern mit kleiner Einheit; vorgelesen als Satz. */
function Remaining({ minutes }: { minutes: number }) {
  const theme = useTheme();
  const hours = Math.floor(minutes / 60);
  const digits = hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : String(minutes);
  return (
    <View
      style={styles.remainingRow}
      accessible
      accessibilityLabel={`noch ${formatDuration(minutes)}`}
    >
      <Text style={[styles.remaining, { color: theme.text }]}>{digits}</Text>
      <Text style={[styles.remainingUnit, { color: theme.textMuted }]}>
        {hours > 0 ? "Std. übrig" : "Min. übrig"}
      </Text>
    </View>
  );
}

function ProgressLine({ ratio, color }: { ratio: number; color: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.surface3 }]}>
      <View
        style={[styles.trackFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: color }]}
      />
    </View>
  );
}

/** Bestätigung beim Wechseln: Vorher/Nachher, drei klare Möglichkeiten. */
function SwitchSheet({
  visible,
  running,
  target,
  now,
  onClose,
  onSwitch,
  onStopOnly,
}: {
  visible: boolean;
  running: ActivitySession;
  target: { goal: GoalKey; entry: ScheduleEntry };
  now: Date;
  onClose: () => void;
  onSwitch: () => void;
  onStopOnly: () => void;
}) {
  const theme = useTheme();
  const from = GOAL_LABELS[running.goal_category];
  const to = GOAL_LABELS[target.goal];
  return (
    <Sheet visible={visible} title={`${from} läuft noch`} onClose={onClose}>
      <View style={[styles.compare, { borderColor: theme.line }]}>
        <Text style={[styles.compareLabel, { color: theme.textSubtle }]}>BISHER</Text>
        <Text style={[styles.compareText, { color: theme.text }]}>
          {from} · {running.title} · {formatDuration(getSessionMinutes(running, now))} erfasst
        </Text>
        <Text style={[styles.compareLabel, { color: theme.textSubtle }]}>DANACH</Text>
        <Text style={[styles.compareText, { color: theme.text }]}>
          {to} · {target.entry.title} · ab jetzt
        </Text>
      </View>
      <Button
        label={`${from} beenden, ${to} starten`}
        variant="primary"
        size="lg"
        onPress={onSwitch}
      />
      <Button label={`Nur ${from} beenden`} onPress={onStopOnly} />
      <Button label={`Abbrechen – ${from} läuft weiter`} variant="ghost" onPress={onClose} />
    </Sheet>
  );
}

function RunningPanel({
  session,
  current,
  now,
  actions,
  canWrite,
  pending,
}: {
  session: ActivitySession;
  current: ScheduleEntry | undefined;
  now: Date;
  actions: NowActions;
  canWrite: boolean;
  pending: boolean;
}) {
  const theme = useTheme();
  const [switchOpen, setSwitchOpen] = useState(false);
  const linked = current && session.schedule_entry_id === current.id ? current : undefined;
  const blocked = requiresCorrectionToStop(session, now);
  const label = GOAL_LABELS[session.goal_category];
  const target =
    current && isGoalKey(current.category) && session.schedule_entry_id !== current.id
      ? { goal: current.category, entry: current }
      : undefined;

  const confirmDiscard = () => {
    Alert.alert(
      "Aktivität verwerfen?",
      `Die erfasste Zeit (${formatDuration(getSessionMinutes(session, now))}) wird gelöscht.`,
      [
        { text: "Behalten", style: "cancel" },
        { text: "Verwerfen", style: "destructive", onPress: () => actions.discard(session.id) },
      ],
    );
  };

  return (
    <View style={styles.now}>
      <ToneChip category={session.goal_category} label={`${label} · Läuft`} />
      <Text accessibilityRole="header" style={[styles.nowTitle, { color: theme.text }]}>
        {session.title}
      </Text>
      <FocusTimer startedAt={session.started_at} />
      <Text style={[styles.meta, { color: theme.textMuted }]}>
        seit {dayPrefix(session.started_at, now)}
        {formatTime(session.started_at)} Uhr
        {linked ? ` · Plan bis ${formatTime(linked.end_at)}` : ""}
      </Text>
      {isLikelyForgotten(session, now) ? (
        <Notice tone="warning" title="Vermutlich vergessen">
          Bitte das tatsächliche Ende über „Zeit korrigieren“ eintragen.
        </Notice>
      ) : null}
      {blocked ? (
        <Muted small>
          Läuft seit über 24 Stunden: Beenden ist nur über „Zeit korrigieren“ möglich.
        </Muted>
      ) : (
        <Button
          label="Beenden"
          icon={Square}
          variant="primary"
          size="lg"
          disabled={!canWrite || pending}
          onPress={() => actions.stop(session.id)}
        />
      )}
      <View style={styles.row}>
        <Button
          label="Zeit korrigieren"
          flex
          disabled={!canWrite}
          onPress={() => actions.openCorrection(session.id)}
        />
        <Button
          label="Abbrechen"
          icon={X}
          variant="ghost"
          flex
          disabled={!canWrite || pending}
          onPress={confirmDiscard}
        />
      </View>
      <OfflineHint canWrite={canWrite} />
      {target ? (
        <>
          <Notice tone="info" title={`Jetzt geplant: ${GOAL_LABELS[target.goal]}`}>
            {`${target.entry.title} · ${formatTimeRange(target.entry.start_at, target.entry.end_at)}`}
          </Notice>
          <Button
            label={`Zu ${GOAL_LABELS[target.goal]} wechseln`}
            disabled={!canWrite || pending}
            onPress={() => setSwitchOpen(true)}
          />
          <SwitchSheet
            visible={switchOpen}
            running={session}
            target={target}
            now={now}
            onClose={() => setSwitchOpen(false)}
            onSwitch={() => {
              setSwitchOpen(false);
              actions.switchTo(session.id, target.goal, target.entry.id);
            }}
            onStopOnly={() => {
              setSwitchOpen(false);
              actions.stop(session.id);
            }}
          />
        </>
      ) : null}
    </View>
  );
}

function EntryPanel({
  entry,
  now,
  tracked,
  actions,
  canWrite,
  pending,
}: {
  entry: ScheduleEntry;
  now: Date;
  tracked: boolean;
  actions: NowActions;
  canWrite: boolean;
  pending: boolean;
}) {
  const theme = useTheme();
  const goal = isGoalKey(entry.category) ? entry.category : undefined;
  const color = theme[categoryTone[entry.category]];
  return (
    <View style={styles.now}>
      {goal ? (
        <ToneChip
          category={entry.category}
          label={`${GOAL_LABELS[goal]} · Jetzt · ${formatTimeRange(entry.start_at, entry.end_at)}`}
        />
      ) : (
        <View style={styles.row}>
          <CategoryPill category={entry.category} />
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            Jetzt · {formatTimeRange(entry.start_at, entry.end_at)}
          </Text>
        </View>
      )}
      <Text accessibilityRole="header" style={[styles.nowTitle, { color: theme.text }]}>
        {entry.title}
      </Text>
      <Remaining minutes={getRemainingMinutes(entry, now)} />
      <ProgressLine ratio={getEntryProgress(entry, now)} color={color} />
      {entry.location ? <Muted small>{`Ort: ${entry.location}`}</Muted> : null}
      {goal && !tracked ? <Muted small>Noch nicht erfasst.</Muted> : null}
      {goal ? (
        <Button
          label="Fokus starten"
          icon={Play}
          variant="primary"
          size="lg"
          disabled={!canWrite || pending}
          onPress={() => actions.start(goal, entry.id)}
        />
      ) : null}
      <View style={styles.row}>
        {entry.completion_status !== "completed" ? (
          <Button
            label="Erledigt"
            icon={Check}
            flex
            disabled={!canWrite || pending}
            accessibilityLabel={`„${entry.title}“ als erledigt markieren`}
            onPress={() => actions.setCompletion(entry.id, "completed")}
          />
        ) : null}
        {entry.completion_status !== "skipped" ? (
          <Button
            label="Ausgelassen"
            variant="ghost"
            flex
            disabled={!canWrite || pending}
            accessibilityLabel={`„${entry.title}“ als ausgelassen markieren`}
            onPress={() => actions.setCompletion(entry.id, "skipped")}
          />
        ) : null}
      </View>
      <OfflineHint canWrite={canWrite} />
      {goal ? null : (
        <SpontaneousStart actions={actions} canWrite={canWrite} pending={pending} large={false} />
      )}
    </View>
  );
}

function FreePanel({
  next,
  now,
  actions,
  canWrite,
  pending,
}: {
  next: ScheduleEntry | undefined;
  now: Date;
  actions: NowActions;
  canWrite: boolean;
  pending: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.now}>
      <Text accessibilityRole="header" style={[styles.nowTitle, { color: theme.text }]}>
        Gerade nichts geplant
      </Text>
      <Text style={[styles.meta, { color: theme.textMuted }]}>
        {next
          ? `Als Nächstes: ${next.title} · ${dayPrefix(next.start_at, now)}${formatTime(next.start_at)} Uhr`
          : "Für den Rest der Woche ist nichts mehr geplant."}
      </Text>
      <SpontaneousStart actions={actions} canWrite={canWrite} pending={pending} large />
      <OfflineHint canWrite={canWrite} />
    </View>
  );
}

/** Hauptansicht „Jetzt“: rein darstellend, damit sie ohne Netzwerk testbar ist. */
export function NowView({
  result,
  now,
  actions,
  pending = false,
  error,
}: {
  result: PlanResult;
  now: Date;
  actions: NowActions;
  pending?: boolean;
  error?: string | null;
}) {
  const theme = useTheme();
  const { snapshot } = result;
  const canWrite = result.origin === "network";
  const entries = sortEntries(snapshot.weeks.flatMap((week) => week.schedule_entries));
  const current = getCurrentEntry(entries, now);
  const upcoming = entries.filter((e) => Date.parse(e.start_at) > now.getTime()).slice(0, 2);
  const weekStart = getWeekStart(now);
  const currentWeek = snapshot.weeks.find((week) => week.week_start === weekStart);
  const running = getRunningSession(snapshot.sessions);
  const tracked = trackedEntryIdsFromSessions(entries, snapshot.sessions, now);
  const goals = getWeekGoals({
    targets: snapshot.goalTargets,
    entries: currentWeek?.schedule_entries ?? [],
    sessions: snapshot.sessions,
    weekStart,
    now,
  });

  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityLabel={`Es ist ${formatTime(now)} Uhr, ${formatLocalDateLong(toLocalDate(now))}`}
      >
        <Text style={[styles.date, { color: theme.textMuted }]}>
          {formatLocalDateLong(toLocalDate(now))} · {formatWeekLabel(weekStart).split(" · ")[0]}
        </Text>
        <Text style={[styles.clock, { color: theme.text }]}>{formatTime(now)}</Text>
      </View>

      <StatusBanner
        origin={result.origin}
        fetchedAt={snapshot.fetchedAt}
        now={now}
        errorMessage={result.errorMessage}
      />
      {error ? (
        <Notice tone="error" title="Nicht gespeichert">
          {error}
        </Notice>
      ) : null}
      {!currentWeek ? (
        <Notice tone="info" title="Für diese Woche ist noch kein Plan veröffentlicht.">
          Die Planung erfolgt auf der Website oder unter „Woche“ → „Bearbeiten“.
        </Notice>
      ) : null}

      {running ? (
        <RunningPanel
          session={running}
          current={current}
          now={now}
          actions={actions}
          canWrite={canWrite}
          pending={pending}
        />
      ) : current ? (
        <EntryPanel
          entry={current}
          now={now}
          tracked={tracked.has(current.id)}
          actions={actions}
          canWrite={canWrite}
          pending={pending}
        />
      ) : (
        <FreePanel
          next={upcoming[0]}
          now={now}
          actions={actions}
          canWrite={canWrite}
          pending={pending}
        />
      )}

      {upcoming.length > 0 ? (
        <Section title="Als Nächstes">
          {upcoming.map((entry) => (
            <View
              key={entry.id}
              style={[styles.next, { backgroundColor: theme.surface1, borderColor: theme.line }]}
              accessible
              accessibilityLabel={`${dayPrefix(entry.start_at, now)}${formatTimeRange(entry.start_at, entry.end_at)}, ${entry.title}`}
            >
              <Text style={[styles.nextTime, { color: theme.textMuted }]}>
                {formatTime(entry.start_at)}
              </Text>
              <View style={styles.nextBody}>
                <Text style={[styles.nextTitle, { color: theme.text }]}>{entry.title}</Text>
                <CategoryPill category={entry.category} />
              </View>
            </View>
          ))}
        </Section>
      ) : null}

      <Section
        title="Diese Woche"
        action={
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Alle Ziele anzeigen"
            onPress={actions.openGoals}
            style={styles.link}
          >
            <Text style={[styles.linkText, { color: theme.text }]}>Ziele</Text>
          </Pressable>
        }
      >
        <GoalList goals={goals} compact />
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xl },
  date: { ...type.small },
  clock: { fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  now: { gap: spacing.md },
  nowTitle: { ...type.nowTitle, fontWeight: "700" },
  meta: { ...type.body },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  block: { gap: spacing.sm },
  label: { fontSize: 13, fontWeight: "600" },
  goalButton: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: 12,
  },
  goalButtonLarge: { minHeight: 56 },
  goalButtonText: { fontSize: 16, fontWeight: "700" },
  remainingRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  remaining: {
    ...type.remaining,
    fontFamily: monoFamily,
    fontVariant: ["tabular-nums"],
    fontWeight: "500",
  },
  remainingUnit: { fontSize: 16, fontWeight: "500" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  trackFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 3 },
  compare: { gap: 4, borderWidth: 1, borderRadius: 14, padding: spacing.lg },
  compareLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  compareText: { fontSize: 16, marginBottom: spacing.sm },
  next: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 14,
    borderWidth: 1,
  },
  nextTime: { width: 52, fontFamily: monoFamily, fontSize: 15, fontVariant: ["tabular-nums"] },
  nextBody: { flex: 1, gap: 4 },
  nextTitle: { fontSize: 16, fontWeight: "700" },
  link: { minHeight: 48, minWidth: 48, justifyContent: "center", alignItems: "flex-end" },
  linkText: { fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
});

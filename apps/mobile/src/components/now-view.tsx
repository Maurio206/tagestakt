import { categoryTone } from "@tagestakt/design-tokens";
import {
  type ActivitySession,
  CATEGORY_LABELS,
  type CompletionStatus,
  type EntryCategory,
  type FocusState,
  GOAL_KEYS,
  GOAL_LABELS,
  type GoalKey,
  type ScheduleEntry,
  formatDuration,
  formatLocalDateLong,
  formatStartLabel,
  formatStartsIn,
  formatTime,
  formatTimeRange,
  formatWeekLabel,
  getEntryProgress,
  getFocusKey,
  getFocusState,
  getRemainingMinutes,
  getRunningSession,
  getSessionMinutes,
  getWeekGoals,
  getWeekStart,
  isGoalKey,
  isLikelyForgotten,
  minutesUntil,
  requiresCorrectionToStop,
  sortEntries,
  toLocalDate,
  trackedEntryIdsFromSessions,
} from "@tagestakt/schedule-schema";
import { Check, Play, Square, TriangleAlert, X } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  useWindowDimensions,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import type { DailyNoteState } from "@/hooks/use-daily-note";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { type PlanResult } from "@/lib/plan-status";
import { OFFLINE_MESSAGE } from "@/lib/write-errors";
import { blockStyle, monoFamily, spacing, type, useTheme } from "@/theme";

import { FocusTimer } from "./focus-timer";
import { GoalList } from "./goal-progress";
import { ToneIcon } from "./icons";
import { NoteRow } from "./note-card";
import { useViewport } from "./screen";
import { Sheet } from "./sheet";
import { StatusBanner } from "./status-banner";
import {
  Button,
  CategoryPill,
  Muted,
  Notice,
  Section,
  TintedSurface,
  ToneChip,
  useOnTint,
} from "./ui";

/** Aktionen der Jetzt-Ansicht; die Bildschirm-Komponente verbindet sie mit Server und Navigation. */
export interface NowActions {
  start: (goal: GoalKey, entryId: string | null) => void;
  stop: (sessionId: string) => void;
  switchTo: (runningId: string, goal: GoalKey, entryId: string | null) => void;
  discard: (sessionId: string) => void;
  setCompletion: (entryId: string, status: CompletionStatus) => void;
  openCorrection: (sessionId: string) => void;
  openGoals: () => void;
  openNote: () => void;
}

type Focus = FocusState<ScheduleEntry, ActivitySession>;

const MAX_BOUNDARY_DELAY_MS = 60 * 60_000;

/**
 * Unschärfe der Nachbarblöcke: React Native unterstützt `filter: blur` nur unter Android
 * (New Architecture). Unter iOS bleiben die Nachbarn deshalb nur blass und angeschnitten.
 */
const GHOST_BLUR: ViewStyle | null = Platform.OS === "android" ? { filter: [{ blur: 2 }] } : null;

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
  const onTint = useOnTint();
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
                borderColor: onTint ? theme.textSubtle : theme.lineStrong,
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

/** Große Ziffern mit kleiner Einheit; vorgelesen wird ein ganzer Satz. */
function BigNumber({ minutes, unit, label }: { minutes: number; unit: string; label: string }) {
  const theme = useTheme();
  const hours = Math.floor(minutes / 60);
  const digits = hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, "0")}` : String(minutes);
  return (
    <View style={styles.remainingRow} accessible accessibilityLabel={label}>
      <Text style={[styles.remaining, { color: theme.text }]}>{digits}</Text>
      <Text style={[styles.remainingUnit, { color: theme.textMuted }]}>
        {hours > 0 ? "Std." : "Min."} {unit}
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

/** Davor/Danach als lesbarer Text – die unscharfen Nachbarn sind nur Dekoration. */
function Around({ focus, now }: { focus: Focus; now: Date }) {
  const theme = useTheme();
  const { previous, next, nextIsToday } = focus;
  const strong = { color: theme.text, fontWeight: "700" as const };
  return (
    <View style={[styles.around, { borderTopColor: theme.line }]}>
      <Text style={[styles.aroundText, { color: theme.textMuted }]}>
        Davor:{" "}
        {previous ? (
          <>
            <Text style={strong}>{previous.title}</Text> bis {formatTime(previous.end_at)}
          </>
        ) : (
          "heute noch nichts"
        )}
      </Text>
      <Text style={[styles.aroundText, { color: theme.textMuted }]}>
        Danach:{" "}
        {next ? (
          <>
            <Text style={strong}>
              {formatStartLabel(next.start_at, now)} {next.title}
            </Text>
            {nextIsToday ? ` · ${formatStartsIn(next.start_at, now)}` : ""}
          </>
        ) : (
          "nichts mehr geplant"
        )}
      </Text>
    </View>
  );
}

/**
 * Weicher Übergang in den Seitenhintergrund: deckt die äußere Kante eines angeschnittenen
 * Nachbarblocks ab, damit weder Block noch Unschärfe rechteckig abgeschnitten wirken.
 */
function EdgeFade({ edge, color }: { edge: "top" | "bottom"; color: string }) {
  const id = `focus-fade-${edge}`;
  const outer = edge === "top" ? "0" : "1";
  const inner = edge === "top" ? "1" : "0";
  return (
    <View testID={id} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1={outer} x2="0" y2={inner}>
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="0.3" stopColor={color} stopOpacity={0.8} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * Unscharfer Nachbarblock, nur teilweise sichtbar (`peek`): läuft zur Bildschirmkante hin weich
 * in den Hintergrund aus. Keine Bedienelemente, für Screenreader verborgen.
 */
function Ghost({
  entry,
  position,
  now,
  later,
  peek,
}: {
  entry: ScheduleEntry;
  position: "prev" | "next";
  now: Date;
  later?: boolean;
  peek: number;
}) {
  const theme = useTheme();
  const look = blockStyle(theme, entry.category, { emphasis: "muted" });
  return (
    <View
      testID={`focus-ghost-${position}`}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.ghostClip,
        { height: peek },
        position === "prev" ? styles.ghostClipPrev : null,
      ]}
    >
      <View
        testID={`focus-ghost-${position}-block`}
        style={[styles.ghost, look.container, { opacity: later ? 0.55 : 0.8 }, GHOST_BLUR]}
      >
        <Text style={[styles.ghostTime, { color: look.textMuted }]}>
          {position === "next" && later
            ? formatStartLabel(entry.start_at, now)
            : formatTimeRange(entry.start_at, entry.end_at)}
        </Text>
        <View style={styles.ghostBody}>
          <Text numberOfLines={1} style={[styles.ghostTitle, { color: look.text }]}>
            {entry.title}
          </Text>
          <Text numberOfLines={1} style={[styles.ghostCat, { color: look.textMuted }]}>
            {CATEGORY_LABELS[entry.category]}
          </Text>
        </View>
      </View>
      <EdgeFade edge={position === "prev" ? "top" : "bottom"} color={theme.bg} />
    </View>
  );
}

/** Sichtbarer Anteil eines Nachbarblocks: aus der Bildschirmhöhe, mit der Schriftgröße wachsend. */
export function ghostPeek(viewportHeight: number, fontScale: number): number {
  const base = viewportHeight > 0 ? Math.min(72, Math.max(36, viewportHeight * 0.08)) : 48;
  return Math.round(base * Math.min(1.4, Math.max(1, fontScale)));
}

/** Fokusblock mit kurzer, ruhiger Einblendung beim Wechsel (nicht bei „Bewegung reduzieren“). */
function FocusCard({
  variant,
  category,
  animate,
  children,
}: {
  variant: "running" | "block" | "free";
  /** Kategorie des Blocks bzw. Ziel der laufenden Aktivität; ohne Kategorie neutral. */
  category: EntryCategory | null;
  animate: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [progress] = useState(() => new Animated.Value(animate ? 0 : 1));
  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, progress]);
  // Hauptphase: kräftigste Stufe der zentralen Blockfarben. Eine laufende Aktivität bekommt
  // zusätzlich den breiteren Rand im vollen Kategorieton – keine eigene Statusfarbe.
  const colors: ViewStyle =
    variant === "free" || !category
      ? { backgroundColor: theme.surface1, borderColor: theme.lineStrong, borderStyle: "dashed" }
      : blockStyle(theme, category, { emphasis: "strong", running: variant === "running" })
          .container;
  return (
    <Animated.View
      testID="focus-card"
      style={[
        styles.card,
        colors,
        animate
          ? {
              opacity: progress,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
              ],
            }
          : null,
      ]}
    >
      <TintedSurface tinted={variant !== "free"}>{children}</TintedSurface>
    </Animated.View>
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
  focus,
  now,
  actions,
  canWrite,
  pending,
}: {
  session: ActivitySession;
  focus: Focus;
  now: Date;
  actions: NowActions;
  canWrite: boolean;
  pending: boolean;
}) {
  const theme = useTheme();
  const [switchOpen, setSwitchOpen] = useState(false);
  const { current, linked } = focus;
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
  focus,
  now,
  tracked,
  actions,
  canWrite,
  pending,
}: {
  entry: ScheduleEntry;
  focus: Focus;
  now: Date;
  tracked: boolean;
  actions: NowActions;
  canWrite: boolean;
  pending: boolean;
}) {
  const theme = useTheme();
  const goal = isGoalKey(entry.category) ? entry.category : undefined;
  const color = theme[categoryTone[entry.category]];
  const minutes = getRemainingMinutes(entry, now);
  const overlapGoals = focus.overlapping.filter((e) => isGoalKey(e.category));
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
      {focus.overlapping.length > 0 ? (
        <View style={styles.overlap}>
          <TriangleAlert color={theme.warning} size={16} />
          <Text style={[styles.overlapText, { color: theme.warning }]}>
            Überschneidung: gleichzeitig{" "}
            {focus.overlapping
              .map((e) => `„${e.title}“ (${formatTimeRange(e.start_at, e.end_at)})`)
              .join(", ")}
          </Text>
        </View>
      ) : null}
      <BigNumber minutes={minutes} unit="übrig" label={`noch ${formatDuration(minutes)}`} />
      <Text style={[styles.meta, { color: theme.textMuted }]}>
        endet um {formatTime(entry.end_at)} Uhr
      </Text>
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
      {overlapGoals.map((other) => (
        <Button
          key={other.id}
          label={`Fokus für „${other.title}“ starten`}
          variant={goal ? "secondary" : "primary"}
          size="lg"
          disabled={!canWrite || pending}
          onPress={() => actions.start(other.category as GoalKey, other.id)}
        />
      ))}
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
  focus,
  now,
  actions,
  canWrite,
  pending,
}: {
  focus: Focus;
  now: Date;
  actions: NowActions;
  canWrite: boolean;
  pending: boolean;
}) {
  const theme = useTheme();
  const { kind, previous, next, nextIsToday } = focus;

  if (kind === "no_plan") {
    return (
      <View style={styles.now}>
        <Text style={[styles.eyebrow, { color: theme.textSubtle }]}>DIESE WOCHE</Text>
        <Text accessibilityRole="header" style={[styles.nowTitleSmall, { color: theme.text }]}>
          Für diese Woche ist noch kein Plan veröffentlicht.
        </Text>
        <Muted small>
          Die Planung erfolgt auf der Website oder unter „Woche“ → „Bearbeiten“. Erfassen geht
          trotzdem.
        </Muted>
        <SpontaneousStart actions={actions} canWrite={canWrite} pending={pending} large />
        <OfflineHint canWrite={canWrite} />
      </View>
    );
  }

  const eyebrow =
    kind === "before_first"
      ? "VOR DEM ERSTEN BLOCK"
      : kind === "after_last"
        ? "NACH DEM LETZTEN BLOCK"
        : kind === "day_empty"
          ? "HEUTE"
          : `JETZT · ${previous ? formatTime(previous.end_at) : ""}–${next ? formatTime(next.start_at) : ""}`;
  const title =
    kind === "before_first" && next
      ? `Noch frei bis ${formatTime(next.start_at)}`
      : kind === "after_last"
        ? "Heute ist nichts mehr geplant."
        : kind === "day_empty"
          ? "Heute ist nichts geplant."
          : "Freie Zeit";
  const until = next && nextIsToday ? minutesUntil(next.start_at, now) : null;
  const untilLabel = kind === "before_first" ? "bis zum ersten Block" : "bis zum nächsten Block";

  return (
    <View style={styles.now}>
      <Text style={[styles.eyebrow, { color: theme.textSubtle }]}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={[styles.nowTitle, { color: theme.text }]}>
        {title}
      </Text>
      {until !== null ? (
        <BigNumber
          minutes={until}
          unit={untilLabel}
          label={`noch ${formatDuration(until)} ${untilLabel}`}
        />
      ) : null}
      <Text style={[styles.meta, { color: theme.text }]}>
        {next
          ? `Als Nächstes: ${formatStartLabel(next.start_at, now)} ${next.title}`
          : "Für die nächsten Tage ist nichts mehr geplant."}
      </Text>
      <SpontaneousStart
        actions={actions}
        canWrite={canWrite}
        pending={pending}
        large={kind === "free"}
      />
      <OfflineHint canWrite={canWrite} />
    </View>
  );
}

function focusTitle(focus: Focus): string {
  if (focus.kind === "running") return focus.session?.title ?? "Aktivität";
  if (focus.kind === "block") return focus.current?.title ?? "Planblock";
  if (focus.kind === "no_plan") return "kein veröffentlichter Plan";
  if (focus.kind === "after_last" || focus.kind === "day_empty") return "nichts mehr geplant";
  return "freie Zeit";
}

/**
 * Neuberechnung genau an der nächsten Blockgrenze (statt bis zu 15 s später mit dem
 * allgemeinen Takt) – keine sekündliche Neuberechnung. Zeitbasis ist die übergebene bzw.
 * zuletzt erreichte Uhrzeit plus die seither vergangene Zeit.
 */
function useBoundaryNow(now: Date, changeAt: number): Date {
  const [boundary, setBoundary] = useState<number | null>(null);
  const nowMs = now.getTime();
  const effectiveMs = boundary !== null && boundary > nowMs ? boundary : nowMs;
  useEffect(() => {
    if (changeAt <= effectiveMs) return;
    const started = Date.now();
    const delay = Math.min(changeAt - effectiveMs, MAX_BOUNDARY_DELAY_MS) + 50;
    const id = setTimeout(() => setBoundary(effectiveMs + (Date.now() - started)), delay);
    return () => clearTimeout(id);
  }, [changeAt, effectiveMs]);
  return effectiveMs === nowMs ? now : new Date(effectiveMs);
}

/** Hauptansicht „Jetzt“: rein darstellend, damit sie ohne Netzwerk testbar ist. */
export function NowView({
  result,
  now: clockNow,
  actions,
  pending = false,
  error,
  todayNote,
}: {
  result: PlanResult;
  now: Date;
  actions: NowActions;
  pending?: boolean;
  error?: string | null;
  /** Kompakter Zugang zur Tagesnotiz (nur Ladezustand und erste Zeile). */
  todayNote?: DailyNoteState;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { snapshot } = result;
  const canWrite = result.origin === "network";
  const entries = sortEntries(snapshot.weeks.flatMap((week) => week.schedule_entries));
  const running = getRunningSession(snapshot.sessions) ?? null;

  const [changeAt, setChangeAt] = useState(0);
  const now = useBoundaryNow(clockNow, changeAt);
  const weekStart = getWeekStart(now);
  const currentWeek = snapshot.weeks.find((week) => week.week_start === weekStart);
  const focus = getFocusState<ScheduleEntry, ActivitySession>({
    entries,
    running,
    now,
    hasPublishedPlan: Boolean(currentWeek),
  });
  const nextChange = focus.nextChangeAt.getTime();
  if (nextChange !== changeAt) setChangeAt(nextChange);

  // Wechsel des Fokus: kurz einblenden (nicht beim ersten Anzeigen) und ansagen.
  const key = getFocusKey(focus);
  const [shownKey, setShownKey] = useState(key);
  const [changed, setChanged] = useState(false);
  if (key !== shownKey) {
    setShownKey(key);
    setChanged(true);
  }
  const title = focusTitle(focus);
  useEffect(() => {
    if (changed) AccessibilityInfo.announceForAccessibility(`Jetzt im Fokus: ${title}`);
  }, [changed, key, title]);

  const upcoming = entries.filter((e) => Date.parse(e.start_at) > now.getTime()).slice(0, 2);
  const tracked = trackedEntryIdsFromSessions(entries, snapshot.sessions, now);
  const goals = getWeekGoals({
    targets: snapshot.goalTargets,
    entries: currentWeek?.schedule_entries ?? [],
    sessions: snapshot.sessions,
    weekStart,
    now,
  });

  const { kind, previous, next, nextIsToday } = focus;
  const showGhosts = kind !== "no_plan";
  const focusCategory: EntryCategory | null =
    kind === "running" && focus.session
      ? focus.session.goal_category
      : kind === "block" && focus.current
        ? focus.current.category
        : null;

  // Erster Bildschirm = Fokusbereich: Uhrzeit, Nachbarn, aktueller Block und Tagesnotiz füllen
  // die gemessene Höhe; „Als Nächstes“ und alles Weitere beginnt erst darunter (Scrollen).
  const viewport = useViewport();
  const { fontScale } = useWindowDimensions();
  const foldHeight = viewport.height > 0 ? viewport.height - viewport.paddingTop : undefined;
  const peek = ghostPeek(viewport.height, fontScale);

  return (
    <View style={styles.container}>
      <View testID="now-fold" style={[styles.fold, foldHeight ? { minHeight: foldHeight } : null]}>
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
        {!currentWeek && running ? (
          <Notice tone="info" title="Für diese Woche ist noch kein Plan veröffentlicht.">
            Die Planung erfolgt auf der Website oder unter „Woche“ → „Bearbeiten“.
          </Notice>
        ) : null}

        <View style={styles.stage}>
          {showGhosts && previous ? (
            <Ghost entry={previous} position="prev" now={now} peek={peek} />
          ) : null}
          <FocusCard
            key={key}
            variant={kind === "running" ? "running" : kind === "block" ? "block" : "free"}
            category={focusCategory}
            animate={changed && !reducedMotion}
          >
            {kind === "running" && focus.session ? (
              <RunningPanel
                session={focus.session}
                focus={focus}
                now={now}
                actions={actions}
                canWrite={canWrite}
                pending={pending}
              />
            ) : kind === "block" && focus.current ? (
              <EntryPanel
                entry={focus.current}
                focus={focus}
                now={now}
                tracked={tracked.has(focus.current.id)}
                actions={actions}
                canWrite={canWrite}
                pending={pending}
              />
            ) : (
              <FreePanel
                focus={focus}
                now={now}
                actions={actions}
                canWrite={canWrite}
                pending={pending}
              />
            )}
            {kind !== "no_plan" ? <Around focus={focus} now={now} /> : null}
          </FocusCard>
          {showGhosts && next ? (
            <Ghost entry={next} position="next" now={now} later={!nextIsToday} peek={peek} />
          ) : null}
        </View>

        {todayNote ? <NoteRow state={todayNote} onOpen={actions.openNote} /> : null}
      </View>

      {upcoming.length > 0 ? (
        <Section title="Als Nächstes">
          {upcoming.map((entry) => {
            // Nebenblöcke: gedämpfte Variante ihrer Kategorie.
            const look = blockStyle(theme, entry.category, { emphasis: "muted" });
            return (
              <View
                key={entry.id}
                testID="upcoming-block"
                style={[styles.next, look.container]}
                accessible
                accessibilityLabel={`${dayPrefix(entry.start_at, now)}${formatTimeRange(entry.start_at, entry.end_at)}, ${entry.title}`}
              >
                <Text style={[styles.nextTime, { color: look.textMuted }]}>
                  {formatTime(entry.start_at)}
                </Text>
                <View style={styles.nextBody}>
                  <Text style={[styles.nextTitle, { color: look.text }]}>{entry.title}</Text>
                  <CategoryPill category={entry.category} />
                </View>
              </View>
            );
          })}
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
  fold: { gap: spacing.lg },
  date: { ...type.small },
  clock: { fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  stage: { flexGrow: 1, justifyContent: "center", alignItems: "center", gap: spacing.sm },
  card: {
    alignSelf: "stretch",
    gap: spacing.lg,
    padding: spacing.lg + 4,
    borderRadius: 18,
    borderWidth: 1,
  },
  now: { gap: spacing.md },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  nowTitle: { ...type.nowTitle, fontWeight: "700" },
  nowTitleSmall: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
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
  remainingRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: spacing.sm },
  remaining: {
    ...type.remaining,
    fontFamily: monoFamily,
    fontVariant: ["tabular-nums"],
    fontWeight: "500",
  },
  remainingUnit: { fontSize: 16, fontWeight: "500" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  trackFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 3 },
  overlap: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  overlapText: { flex: 1, fontSize: 14, fontWeight: "700" },
  around: { gap: 4, paddingTop: spacing.md, borderTopWidth: 1 },
  aroundText: { fontSize: 14, lineHeight: 20 },
  // Breiter als der Block selbst, damit die Unschärfe seitlich nicht beschnitten wird.
  ghostClip: {
    alignSelf: "stretch",
    alignItems: "center",
    overflow: "hidden",
    justifyContent: "flex-start",
  },
  ghostClipPrev: { justifyContent: "flex-end" },
  ghost: {
    width: "88%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    borderRadius: 14,
    borderWidth: 1,
  },
  ghostTime: { width: 92, fontFamily: monoFamily, fontSize: 13, fontVariant: ["tabular-nums"] },
  ghostBody: { flex: 1, gap: 2 },
  ghostTitle: { fontSize: 15, fontWeight: "700" },
  ghostCat: { fontSize: 12 },
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

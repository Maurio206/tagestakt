import {
  type ActivitySession,
  GOAL_LABELS,
  formatDuration,
  formatLocalDateShort,
  formatTime,
  requiresCorrectionToStop,
  toLocalDate,
  validateActivityTimes,
} from "@tagestakt/schedule-schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, Trash } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";

import { Screen } from "@/components/screen";
import { StackHeader } from "@/components/stack-header";
import { Body, Button, ChoiceChips, Muted, Notice, Stepper, SwitchRow } from "@/components/ui";
import { useActivityActions } from "@/hooks/use-activity";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import { stepTime } from "@/lib/time-step";
import { spacing, useTheme } from "@/theme";

const STEP_OPTIONS = [5, 15] as const;
type Step = (typeof STEP_OPTIONS)[number];

function label(date: Date, now: Date): string {
  const day = toLocalDate(date);
  return day === toLocalDate(now)
    ? formatTime(date)
    : `${formatLocalDateShort(day)} ${formatTime(date)}`;
}

export default function CorrectScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { result } = usePlan();
  const session = result?.snapshot.sessions.find((s) => s.id === id);

  if (!session) {
    return (
      <Screen edges={["top", "bottom", "left", "right"]}>
        <StackHeader title="Zeit korrigieren" modal />
        {result ? (
          <Notice tone="info" title="Aktivität nicht gefunden.">
            Sie wurde vielleicht inzwischen gelöscht oder liegt außerhalb der geladenen Wochen.
          </Notice>
        ) : (
          <ActivityIndicator color={theme.text} accessibilityLabel="Wird geladen" />
        )}
      </Screen>
    );
  }
  return <CorrectForm key={session.id} session={session} canWrite={result?.origin === "network"} />;
}

function CorrectForm({ session, canWrite }: { session: ActivitySession; canWrite: boolean }) {
  const now = useNow(15_000);
  const router = useRouter();
  const activity = useActivityActions(canWrite);
  const [step, setStep] = useState<Step>(5);
  const [start, setStart] = useState(() => new Date(session.started_at));
  const [end, setEnd] = useState<Date | null>(() =>
    session.ended_at ? new Date(session.ended_at) : null,
  );

  const wasRunning = session.ended_at === null;
  const issue = validateActivityTimes(start, end, now);
  const minutes = Math.max(0, Math.round(((end ?? now).getTime() - start.getTime()) / 60_000));
  const unchanged =
    start.getTime() === Date.parse(session.started_at) &&
    (end?.getTime() ?? null) === (session.ended_at ? Date.parse(session.ended_at) : null);

  const save = async () => {
    const ok = await activity.correct(
      session.id,
      start.toISOString(),
      end ? end.toISOString() : null,
    );
    if (ok) router.back();
  };

  const discard = () => {
    Alert.alert(
      "Aktivität verwerfen?",
      `„${session.title}“ (${formatDuration(minutes)}) wird gelöscht und zählt nicht mehr zum Wochenziel.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Verwerfen",
          style: "destructive",
          onPress: () =>
            void activity.discard(session.id).then((ok) => {
              if (ok) router.back();
            }),
        },
      ],
    );
  };

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <StackHeader
        title="Zeit korrigieren"
        subtitle={`${GOAL_LABELS[session.goal_category]} · ${session.title}`}
        modal
      />
      {!canWrite ? (
        <Notice tone="warning" title="Keine Verbindung">
          Korrekturen werden nur mit Verbindung gespeichert – offline wird nichts vorgemerkt.
        </Notice>
      ) : null}
      {wasRunning && requiresCorrectionToStop(session, now) ? (
        <Notice tone="warning" title="Läuft seit über 24 Stunden">
          Bitte ein Ende festlegen – so lange lässt sich die Aktivität nicht einfach beenden.
        </Notice>
      ) : null}

      <ChoiceChips
        label="Schrittweite"
        options={STEP_OPTIONS.map((value) => ({ value, label: `${value} Min.` }))}
        value={step}
        onChange={setStep}
      />
      <Stepper
        label="Beginn"
        value={label(start, now)}
        onDecrease={() => setStart(stepTime(start, -1, step))}
        onIncrease={() => setStart(stepTime(start, 1, step))}
        decreaseLabel={`Beginn ${step} Minuten früher`}
        increaseLabel={`Beginn ${step} Minuten später`}
        disabled={activity.pending}
      />
      {wasRunning ? (
        <SwitchRow
          label="Läuft noch"
          hint="Aus: ein Ende festlegen und die Aktivität damit beenden."
          value={end === null}
          onChange={(running) => setEnd(running ? null : stepTime(now, -1, step))}
          disabled={activity.pending}
        />
      ) : null}
      {end ? (
        <Stepper
          label="Ende"
          value={label(end, now)}
          onDecrease={() => setEnd(stepTime(end, -1, step))}
          onIncrease={() => setEnd(stepTime(end, 1, step))}
          decreaseLabel={`Ende ${step} Minuten früher`}
          increaseLabel={`Ende ${step} Minuten später`}
          disabled={activity.pending}
        />
      ) : null}

      <View style={styles.summary} accessible accessibilityLiveRegion="polite">
        <Body bold>Dauer: {formatDuration(minutes)}</Body>
        <Muted small>Korrigierte Zeiten werden als „korrigiert“ gekennzeichnet.</Muted>
      </View>
      {issue ? <Notice tone="warning" title={issue.message} /> : null}
      {activity.error ? (
        <Notice tone="error" title="Nicht gespeichert">
          {activity.error}
        </Notice>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={activity.pending ? "Speichere …" : "Korrektur speichern"}
          icon={Check}
          variant="primary"
          size="lg"
          disabled={!canWrite || activity.pending || issue !== null || unchanged}
          onPress={() => void save()}
        />
        <Button
          label="Aktivität verwerfen"
          icon={Trash}
          variant="danger"
          disabled={!canWrite || activity.pending}
          onPress={discard}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.xs },
  actions: { gap: spacing.sm },
});

import { categoryTone } from "@tagestakt/design-tokens";
import {
  GOAL_KEYS,
  GOAL_LABELS,
  type GoalKey,
  type GoalTargets,
  MAX_WEEKLY_GOAL_MINUTES,
  formatGoalAmount,
} from "@tagestakt/schedule-schema";
import { Save } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useAuth } from "@/auth/auth-context";
import { useWrite } from "@/hooks/use-write";
import { saveGoalTargets } from "@/lib/settings-api";
import { spacing, useTheme } from "@/theme";

import { ToneIcon } from "./icons";
import { Button, Muted, Notice, Stepper } from "./ui";

const STEP_MINUTES = 30;

type GoalValues = Record<GoalKey, number>;

function toState(targets: GoalTargets): GoalValues {
  return {
    business: targets.business ?? 0,
    sport: targets.sport ?? 0,
    relationship: targets.relationship ?? 0,
  };
}

function sameValues(a: GoalValues, b: GoalValues): boolean {
  return GOAL_KEYS.every((goal) => a[goal] === b[goal]);
}

/** Wochenziele in halben Stunden; 0 = kein Ziel (zählt nie als „erreicht“). */
export function GoalSettings({ targets, canWrite }: { targets: GoalTargets; canWrite: boolean }) {
  const theme = useTheme();
  const { supabase, session } = useAuth();
  const write = useWrite(canWrite);
  const server = toState(targets);
  const [values, setValues] = useState(server);
  // Stand, auf dem die Eingaben beruhen. Ein neuer Serverstand (z. B. auf der Website
  // geändert) überschreibt nur unveränderte Eingaben – nie stillschweigend eigene Änderungen.
  const [base, setBase] = useState(server);
  if (!sameValues(server, base) && (sameValues(values, base) || sameValues(values, server))) {
    setValues(server);
    setBase(server);
  }
  const dirty = !sameValues(values, server);

  const change = (goal: GoalKey, delta: number) => {
    write.reset();
    setValues((current) => ({
      ...current,
      [goal]: Math.min(MAX_WEEKLY_GOAL_MINUTES, Math.max(0, current[goal] + delta)),
    }));
  };

  const save = () => {
    const ownerId = session?.user.id;
    if (!ownerId) return;
    void write.run(() =>
      saveGoalTargets(supabase, ownerId, {
        weeklyBusinessTargetMinutes: values.business,
        weeklySportTargetMinutes: values.sport,
        weeklyRelationshipTargetMinutes: values.relationship,
      }),
    );
  };

  return (
    <View style={styles.container}>
      {GOAL_KEYS.map((goal) => (
        <View key={goal} style={styles.row}>
          <View style={styles.icon}>
            <ToneIcon tone={categoryTone[goal]} color={theme[categoryTone[goal]]} size={20} />
          </View>
          <View style={styles.flex}>
            <Stepper
              label={GOAL_LABELS[goal]}
              value={values[goal] > 0 ? formatGoalAmount(values[goal]) : "Kein Ziel"}
              onDecrease={() => change(goal, -STEP_MINUTES)}
              onIncrease={() => change(goal, STEP_MINUTES)}
              decreaseLabel={`${GOAL_LABELS[goal]}: Ziel um 30 Minuten verringern`}
              increaseLabel={`${GOAL_LABELS[goal]}: Ziel um 30 Minuten erhöhen`}
              disabled={!canWrite || write.pending}
            />
          </View>
        </View>
      ))}
      <Muted small>
        „Kein Ziel“ zeigt nur die erfasste Zeit – ohne Bewertung. Es zählt ausschließlich
        tatsächlich erfasste Zeit, nicht die geplante.
      </Muted>
      {write.error ? (
        <Notice tone="error" title="Nicht gespeichert">
          {write.error}
        </Notice>
      ) : null}
      {write.saved && !dirty ? <Notice tone="success" title="Wochenziele gespeichert." /> : null}
      <Button
        label={write.pending ? "Speichere …" : "Wochenziele speichern"}
        icon={Save}
        variant={dirty ? "primary" : "secondary"}
        disabled={!canWrite || write.pending || !dirty}
        onPress={save}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  icon: { height: 48, justifyContent: "center" },
  flex: { flex: 1 },
});

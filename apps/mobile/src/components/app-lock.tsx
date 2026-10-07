import { zIndex } from "@tagestakt/design-tokens";
import { Fingerprint } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useDeviceSettings } from "@/hooks/device-settings";
import {
  type LockAvailability,
  getLockAvailability,
  isSystemPromptActive,
  requestUnlock,
  shouldLockOnColdStart,
  shouldLockOnResume,
} from "@/lib/app-lock";
import { spacing, type, useTheme } from "@/theme";

import { BrandMark } from "./brand";
import { Button, Muted } from "./ui";

/** Sperrbildschirm: verdeckt alle Inhalte, bis das Gerät die Entsperrung bestätigt. */
export function LockScreen({
  onUnlock,
  onSignOut,
  availability,
  message,
}: {
  onUnlock: () => void;
  onSignOut: () => void;
  availability: LockAvailability;
  message: string | null;
}) {
  const theme = useTheme();
  const canUnlock = availability === "available";
  return (
    <SafeAreaView style={[styles.lock, { backgroundColor: theme.bg }]}>
      <View style={styles.lockBody}>
        <BrandMark size={48} />
        <Text accessibilityRole="header" style={[styles.lockTitle, { color: theme.text }]}>
          TagesTakt ist gesperrt
        </Text>
        <Muted>
          {canUnlock
            ? "Entsperre mit Fingerabdruck, Gesichtserkennung oder deiner Geräte-PIN."
            : "Auf diesem Gerät ist keine Bildschirmsperre eingerichtet. Melde dich ab und wieder mit Passwort an oder richte zuerst eine Bildschirmsperre ein."}
        </Muted>
        {message ? (
          <Text accessibilityRole="alert" style={[styles.message, { color: theme.warning }]}>
            {message}
          </Text>
        ) : null}
      </View>
      <View style={styles.lockActions}>
        {canUnlock ? (
          <Button
            label="Entsperren"
            icon={Fingerprint}
            variant="primary"
            size="lg"
            onPress={onUnlock}
          />
        ) : null}
        <Button label="Abmelden und mit Passwort anmelden" variant="ghost" onPress={onSignOut} />
      </View>
    </SafeAreaView>
  );
}

/**
 * Lokale App-Sperre (Standard aus). Sperrt beim Kaltstart und nach der eingestellten Zeit
 * im Hintergrund. Solange gesperrt, verdeckt der Sperrbildschirm alle Inhalte; sie bleiben
 * gemountet (Navigationszustand), sind aber für Screenreader ausgeblendet.
 */
export function AppLockGate({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut: () => void;
}) {
  const { settings, loaded } = useDeviceSettings();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [availability, setAvailability] = useState<LockAvailability>("available");
  const [message, setMessage] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);
  const lockSettings = settings.appLock;

  // Kaltstart: Entscheidung einmalig, sobald die Geräteeinstellungen geladen sind.
  if (loaded && locked === null) setLocked(shouldLockOnColdStart(lockSettings));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        // Eigene Systemdialoge (PIN-Eingabe, Berechtigung) zählen nicht als Verlassen der App.
        if (!isSystemPromptActive()) backgroundedAt.current = Date.now();
      } else if (state === "active" && backgroundedAt.current !== null) {
        if (shouldLockOnResume(lockSettings, backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => subscription.remove();
  }, [lockSettings]);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const result = await requestUnlock();
    prompting.current = false;
    if (result.success) {
      setMessage(null);
      setLocked(false);
    } else {
      setMessage(result.message ?? null);
    }
  }, []);

  useEffect(() => {
    if (!locked) return;
    let active = true;
    void getLockAvailability().then((value) => {
      if (!active) return;
      setAvailability(value);
      if (value === "available") void unlock();
    });
    return () => {
      active = false;
    };
  }, [locked, unlock]);

  if (locked === null) return null;
  // Inhalte bleiben gemountet (Navigationszustand bleibt erhalten), sind aber vollständig
  // verdeckt und für Screenreader ausgeblendet, solange gesperrt ist.
  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        importantForAccessibility={locked ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={locked}
      >
        {children}
      </View>
      {locked ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]} accessibilityViewIsModal>
          <LockScreen
            availability={availability}
            message={message}
            onUnlock={() => void unlock()}
            onSignOut={onSignOut}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { zIndex: zIndex.lock, elevation: zIndex.lock },
  lock: { flex: 1, padding: spacing.xl, justifyContent: "space-between" },
  lockBody: { flex: 1, justifyContent: "center", gap: spacing.lg },
  lockTitle: { ...type.nowTitle, fontWeight: "700" },
  message: { ...type.body, fontWeight: "600" },
  lockActions: { gap: spacing.sm },
});

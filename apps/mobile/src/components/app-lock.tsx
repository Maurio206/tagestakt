import { zIndex } from "@tagestakt/design-tokens";
import { Fingerprint } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useDeviceSettings } from "@/hooks/device-settings";
import {
  type LockAvailability,
  type LockEvent,
  type LockState,
  getLockAvailability,
  initialLockState,
  isSystemPromptActive,
  nextLockState,
  requestUnlock,
} from "@/lib/app-lock";
import { setScreenPrivacy } from "@/lib/screen-privacy";
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

/** Neutrale Schutzfläche ohne Inhalte – sichtbar, solange die App nicht im Vordergrund ist. */
export function PrivacyShield() {
  const theme = useTheme();
  return (
    <View style={[styles.shield, { backgroundColor: theme.bg }]} testID="privacy-shield">
      <BrandMark size={56} />
      <Text style={[styles.shieldTitle, { color: theme.text }]}>TagesTakt</Text>
    </View>
  );
}

/**
 * Lokale App-Sperre (Standard aus). Sperrt beim Kaltstart und nach der eingestellten Zeit
 * im Hintergrund. Solange gesperrt oder im Hintergrund, verdecken Sperrbildschirm bzw. neutrale
 * Schutzfläche alle Inhalte; sie bleiben gemountet (Navigationszustand), sind aber für
 * Screenreader ausgeblendet. Bei aktiver Sperre bleibt zusätzlich die Vorschau im
 * App-Umschalter leer (`FLAG_SECURE`, siehe `lib/screen-privacy.ts`).
 */
export function AppLockGate({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut: () => void;
}) {
  const { settings, loaded } = useDeviceSettings();
  const [state, setState] = useState<LockState | null>(null);
  const [availability, setAvailability] = useState<LockAvailability>("available");
  const [message, setMessage] = useState<string | null>(null);
  const prompting = useRef(false);
  const lockSettings = settings.appLock;
  const locked = state?.locked ?? false;

  // Kaltstart: Entscheidung einmalig, sobald die Geräteeinstellungen geladen sind.
  if (loaded && state === null) setState(initialLockState(lockSettings));

  // Vorschau im App-Umschalter nur bei eingeschalteter Sperre schützen (blockiert Screenshots).
  useEffect(() => {
    if (!lockSettings.enabled) return;
    void setScreenPrivacy(true);
    return () => void setScreenPrivacy(false);
  }, [lockSettings.enabled]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      const event: LockEvent | null =
        appState === "background"
          ? { type: "background", at: Date.now() }
          : appState === "inactive"
            ? { type: "inactive" }
            : appState === "active"
              ? { type: "active", at: Date.now() }
              : null;
      if (!event) return;
      const systemPrompt = isSystemPromptActive();
      setState((current) =>
        current ? nextLockState(current, event, lockSettings, systemPrompt) : current,
      );
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
      setState((current) =>
        current ? nextLockState(current, { type: "unlocked" }, lockSettings, false) : current,
      );
    } else {
      setMessage(result.message ?? null);
    }
  }, [lockSettings]);

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

  if (state === null) return null;
  const covered = state.locked || state.shielded;
  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={covered}
      >
        {children}
      </View>
      {state.locked ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]} accessibilityViewIsModal>
          <LockScreen
            availability={availability}
            message={message}
            onUnlock={() => void unlock()}
            onSignOut={onSignOut}
          />
        </View>
      ) : state.shielded ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]} accessibilityViewIsModal>
          <PrivacyShield />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { zIndex: zIndex.lock, elevation: zIndex.lock },
  shield: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  shieldTitle: { ...type.section, fontWeight: "700" },
  lock: { flex: 1, padding: spacing.xl, justifyContent: "space-between" },
  lockBody: { flex: 1, justifyContent: "center", gap: spacing.lg },
  lockTitle: { ...type.nowTitle, fontWeight: "700" },
  message: { ...type.body, fontWeight: "600" },
  lockActions: { gap: spacing.sm },
});

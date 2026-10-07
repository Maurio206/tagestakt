import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useDeviceSettings } from "@/hooks/device-settings";
import { getLockAvailability, requestUnlock } from "@/lib/app-lock";
import { LOCK_TIMEOUT_OPTIONS } from "@/lib/device-settings";
import { spacing } from "@/theme";

import { ChoiceChips, Muted, Notice, SwitchRow } from "./ui";

const TIMEOUT_LABELS: Record<(typeof LOCK_TIMEOUT_OPTIONS)[number], string> = {
  0: "Sofort",
  60: "Nach 1 Min.",
  300: "Nach 5 Min.",
};

/**
 * App-Sperre (Standard: aus). Ein- und Ausschalten erfordert eine erfolgreiche Entsperrung,
 * damit niemand die Sperre an einem kurz entsperrten Gerät abschalten kann.
 */
export function AppLockSettings() {
  const { settings, update } = useDeviceSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (enabled: boolean) => {
    setMessage(null);
    setBusy(true);
    try {
      if (enabled) {
        const availability = await getLockAvailability();
        if (availability !== "available") {
          setMessage(
            availability === "no-device-security"
              ? "Auf diesem Gerät ist keine Bildschirmsperre (PIN, Muster, Fingerabdruck) eingerichtet. Bitte zuerst in den Systemeinstellungen einrichten."
              : "Die App-Sperre wird auf diesem Gerät nicht unterstützt.",
          );
          return;
        }
      }
      const result = await requestUnlock(
        enabled ? "App-Sperre einschalten" : "App-Sperre ausschalten",
      );
      if (!result.success) {
        setMessage(result.message ?? "Nicht bestätigt.");
        return;
      }
      await update({ ...settings, appLock: { ...settings.appLock, enabled } });
    } finally {
      setBusy(false);
    }
  };

  const timeout =
    LOCK_TIMEOUT_OPTIONS.find((value) => value === settings.appLock.timeoutSeconds) ?? 60;

  return (
    <View style={styles.container}>
      <SwitchRow
        label="App-Sperre"
        hint="Beim Öffnen mit Fingerabdruck, Gesicht oder Geräte-PIN entsperren."
        value={settings.appLock.enabled}
        disabled={busy}
        onChange={(value) => void toggle(value)}
      />
      {message ? (
        <Notice tone="warning" title="App-Sperre unverändert">
          {message}
        </Notice>
      ) : null}
      {settings.appLock.enabled ? (
        <ChoiceChips
          label="Sperren nach Wechsel in den Hintergrund"
          options={LOCK_TIMEOUT_OPTIONS.map((value) => ({ value, label: TIMEOUT_LABELS[value] }))}
          value={timeout}
          onChange={(timeoutSeconds) =>
            void update({ ...settings, appLock: { ...settings.appLock, timeoutSeconds } })
          }
        />
      ) : null}
      <Muted small>
        Die Prüfung übernimmt das Betriebssystem. TagesTakt erhält keine biometrischen Daten, nur
        „entsperrt“ oder „nicht entsperrt“. Nach jedem Kaltstart wird bei aktiver Sperre neu
        gefragt.
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
});

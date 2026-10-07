import {
  REMINDER_LEAD_OPTIONS,
  REMINDER_SCOPES,
  REMINDER_SCOPE_LABELS,
  type ReminderScope,
  type ReminderSettings as ServerReminderSettings,
} from "@tagestakt/schedule-schema";
import { Save, Settings } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { useAuth } from "@/auth/auth-context";
import { useDeviceSettings } from "@/hooks/device-settings";
import { useWrite } from "@/hooks/use-write";
import { type PermissionState, getPermissionState, requestPermission } from "@/lib/notifications";
import { saveReminderSettings } from "@/lib/settings-api";
import { spacing } from "@/theme";

import { Button, ChoiceChips, Divider, Muted, Notice, SwitchRow } from "./ui";

type Lead = number | "off";

/**
 * Lokale Erinnerungen. Auf diesem Gerät ein-/ausschalten (Berechtigung wird erst beim
 * Einschalten angefragt) und gemeinsame Vorgaben für Web und App (auf dem Server).
 */
export function ReminderSettingsPanel({
  server,
  canWrite,
}: {
  server: ServerReminderSettings;
  canWrite: boolean;
}) {
  const { supabase, session } = useAuth();
  const { settings, update } = useDeviceSettings();
  const write = useWrite(canWrite);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [lead, setLead] = useState<Lead>(server.minutesBefore ?? "off");
  const [atStart, setAtStart] = useState(server.atStart);
  const [ifNotStarted, setIfNotStarted] = useState(server.ifNotStarted);
  const [scope, setScope] = useState<ReminderScope>(server.scope);

  useEffect(() => {
    let active = true;
    void getPermissionState().then((state) => {
      if (active) setPermission(state);
    });
    return () => {
      active = false;
    };
  }, []);

  const dirty =
    lead !== (server.minutesBefore ?? "off") ||
    atStart !== server.atStart ||
    ifNotStarted !== server.ifNotStarted ||
    scope !== server.scope;

  const toggleDevice = async (enabled: boolean) => {
    if (enabled) {
      // Berechtigung im Kontext anfragen – erst jetzt, nicht beim App-Start.
      const state = permission === "granted" ? "granted" : await requestPermission();
      setPermission(state);
      if (state !== "granted") return;
    }
    await update({ ...settings, reminders: { ...settings.reminders, enabled } });
  };

  const save = () => {
    const ownerId = session?.user.id;
    if (!ownerId) return;
    void write.run(() =>
      saveReminderSettings(supabase, ownerId, {
        reminderMinutesBefore: lead === "off" ? null : lead,
        remindAtStart: atStart,
        remindIfNotStarted: ifNotStarted,
        reminderScope: scope,
      }),
    );
  };

  const deviceOn = settings.reminders.enabled && permission === "granted";

  return (
    <View style={styles.container}>
      <SwitchRow
        label="Erinnerungen auf diesem Gerät"
        hint="Lokal geplant – ohne Push-Dienst und ohne Daten an Dritte."
        value={deviceOn}
        onChange={(value) => void toggleDevice(value)}
      />
      {permission === "denied" ? (
        <Notice tone="warning" title="Benachrichtigungen sind blockiert.">
          <Muted small>
            Erinnerungen lassen sich erst nach Freigabe in den Systemeinstellungen zeigen.
          </Muted>
          <Button
            label="Systemeinstellungen öffnen"
            icon={Settings}
            onPress={() => void Linking.openSettings()}
          />
        </Notice>
      ) : null}
      <SwitchRow
        label="Titel in Erinnerungen zeigen"
        hint="Aus: nur „Gewerbe in 10 Min.“ – ohne Titel, Ort oder Notiz auf dem Sperrbildschirm."
        value={settings.reminders.showDetails}
        disabled={!deviceOn}
        onChange={(showDetails) =>
          void update({ ...settings, reminders: { ...settings.reminders, showDetails } })
        }
      />

      <Divider />
      <Muted small>Gilt für alle Geräte:</Muted>
      <ChoiceChips<Lead>
        label="Vorher erinnern"
        options={[
          { value: "off", label: "Aus" },
          ...REMINDER_LEAD_OPTIONS.map((minutes) => ({ value: minutes, label: `${minutes} Min.` })),
        ]}
        value={lead}
        onChange={(value) => {
          write.reset();
          setLead(value);
        }}
      />
      <SwitchRow
        label="Zum Beginn erinnern"
        value={atStart}
        onChange={(value) => {
          write.reset();
          setAtStart(value);
        }}
      />
      <SwitchRow
        label="Erinnern, wenn nicht gestartet"
        hint="10 Minuten nach Beginn eines Ziel-Blocks ohne erfasste Zeit."
        value={ifNotStarted}
        onChange={(value) => {
          write.reset();
          setIfNotStarted(value);
        }}
      />
      <ChoiceChips<ReminderScope>
        label="Für welche Blöcke"
        options={REMINDER_SCOPES.map((value) => ({ value, label: REMINDER_SCOPE_LABELS[value] }))}
        value={scope}
        onChange={(value) => {
          write.reset();
          setScope(value);
        }}
      />
      {write.error ? (
        <Notice tone="error" title="Nicht gespeichert">
          {write.error}
        </Notice>
      ) : null}
      {write.saved && !dirty ? <Notice tone="success" title="Erinnerungen gespeichert." /> : null}
      <Button
        label={write.pending ? "Speichere …" : "Vorgaben speichern"}
        icon={Save}
        variant={dirty ? "primary" : "secondary"}
        disabled={!canWrite || write.pending || !dirty}
        onPress={save}
      />
      <Muted small>
        Android kann Erinnerungen im Energiesparmodus um einige Minuten verzögern. Nach einem
        Neustart des Geräts werden sie beim nächsten Öffnen der App neu geplant.
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
});

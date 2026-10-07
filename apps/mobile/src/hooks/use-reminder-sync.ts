import { useEffect } from "react";
import { AppState } from "react-native";

import { configureNotificationHandler, syncReminders } from "@/lib/notifications";

import { useDeviceSettings } from "./device-settings";
import { usePlan } from "./use-plan";

/**
 * Hält die lokal geplanten Erinnerungen aktuell: nach jedem neuen Planstand (auch nach
 * Starten/Beenden), nach Änderungen der Geräteeinstellungen und bei Rückkehr in die App.
 */
export function useReminderSync(): void {
  const { result } = usePlan();
  const { settings, loaded } = useDeviceSettings();
  const snapshot = result?.snapshot;
  const { enabled, showDetails } = settings.reminders;

  useEffect(() => {
    configureNotificationHandler();
  }, []);

  useEffect(() => {
    if (!loaded || !snapshot) return;
    const sync = () => {
      void syncReminders({ snapshot, enabled, showDetails, now: new Date() }).catch(() => {
        // Erinnerungen sind eine Komfortfunktion – Fehler blockieren die App nicht.
      });
    };
    sync();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => subscription.remove();
  }, [loaded, snapshot, enabled, showDetails]);
}

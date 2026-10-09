import { useEffect } from "react";
import { AppState } from "react-native";

import { updateHomeWidget } from "@/lib/home-widget";

import { useDeviceSettings } from "./device-settings";
import { usePlan } from "./use-plan";

/**
 * Hält das Startbildschirm-Widget aktuell: nach jedem neuen Planstand (Abruf, Offline-Cache,
 * Änderungen), nach Umschalten der App-Sperre und bei Rückkehr in die App. Zwischen zwei
 * App-Starts wechselt das Widget selbst an den vorberechneten Blockgrenzen.
 */
export function useWidgetSync(): void {
  const { result } = usePlan();
  const { settings, loaded } = useDeviceSettings();
  const snapshot = result?.snapshot;
  // Bei aktiver App-Sperre zeigt das Widget keine Titel (die App ist „verdeckt“).
  const showTitles = !settings.appLock.enabled;

  useEffect(() => {
    if (!loaded || !snapshot) return;
    const sync = () => {
      void updateHomeWidget({ snapshot, showTitles, now: new Date() }).catch(() => {
        // Das Widget ist eine Komfortfunktion – Fehler blockieren die App nicht.
        console.warn("widget_sync_failed");
      });
    };
    sync();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => subscription.remove();
  }, [loaded, snapshot, showTitles]);
}

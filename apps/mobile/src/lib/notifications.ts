import {
  type PlanSnapshot,
  planReminders,
  trackedEntryIdsFromSessions,
} from "@tagestakt/schedule-schema";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { withSystemPrompt } from "./app-lock";

/**
 * Lokale Erinnerungen – ausschließlich auf dem Gerät geplant (expo-notifications),
 * ohne Push-Dienst, ohne Push-Token, ohne Firebase. Inhalte standardmäßig ohne Titel,
 * Ort oder Notiz („Gewerbe in 10 Min.“).
 */

export const REMINDER_CHANNEL_ID = "erinnerungen";

export type PermissionState = "granted" | "denied" | "undetermined";

let handlerConfigured = false;

/** Erinnerungen auch im Vordergrund als Banner zeigen (ohne App-Symbolzähler). */
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function getPermissionState(): Promise<PermissionState> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
  } catch {
    return "undetermined";
  }
}

/** Fragt die Berechtigung an – nur aufrufen, wenn der Benutzer Erinnerungen einschaltet. */
export async function requestPermission(): Promise<PermissionState> {
  await ensureChannel();
  try {
    const { status } = await withSystemPrompt(() =>
      Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      }),
    );
    return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
  } catch {
    return "undetermined";
  }
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "Erinnerungen",
    description: "Lokale Erinnerungen an geplante Blöcke",
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: false,
  });
}

export async function cancelAllReminders(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Ohne native Unterstützung (z. B. Tests) gibt es nichts zu löschen.
  }
}

/**
 * Ersetzt alle geplanten Erinnerungen durch den aktuellen Stand (veröffentlichter Plan,
 * Vorgaben vom Server, Geräteeinstellungen). Gibt die Anzahl geplanter Erinnerungen zurück.
 */
export async function syncReminders(options: {
  snapshot: PlanSnapshot;
  enabled: boolean;
  showDetails: boolean;
  now: Date;
}): Promise<number> {
  await cancelAllReminders();
  if (!options.enabled) return 0;
  if ((await getPermissionState()) !== "granted") return 0;
  await ensureChannel();

  const entries = options.snapshot.weeks.flatMap((week) => week.schedule_entries);
  const reminders = planReminders(
    entries,
    { ...options.snapshot.reminderSettings, showDetails: options.showDetails },
    options.now,
    {
      trackedEntryIds: trackedEntryIdsFromSessions(entries, options.snapshot.sessions, options.now),
      timeZone: options.snapshot.timezone,
    },
  );
  for (const reminder of reminders) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.key,
      content: { title: reminder.title, body: reminder.body, data: { kind: reminder.kind } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.fireAt,
        channelId: REMINDER_CHANNEL_ID,
      },
    });
  }
  return reminders.length;
}

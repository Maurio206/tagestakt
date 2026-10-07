import * as SecureStore from "expo-secure-store";
import { z } from "zod";

/**
 * Einstellungen, die nur dieses Gerät betreffen (App-Sperre, lokale Erinnerungen).
 * Liegen klein und ohne Inhalte im sicheren Gerätespeicher (SecureStore) – nie auf dem
 * Server und nie in AsyncStorage. Werden beim Abmelden gelöscht.
 */
export const DEVICE_SETTINGS_KEY = "tagestakt.device-settings";

/** Sperr-Zeitpunkt nach dem Wechsel in den Hintergrund (Sekunden). */
export const LOCK_TIMEOUT_OPTIONS = [0, 60, 300] as const;

const deviceSettingsSchema = z.object({
  appLock: z
    .object({
      enabled: z.boolean(),
      timeoutSeconds: z.number().int().min(0).max(3600),
    })
    .default({ enabled: false, timeoutSeconds: 60 }),
  reminders: z
    .object({
      enabled: z.boolean(),
      /** Blocktitel auf dem Sperrbildschirm zeigen (Standard: nein). */
      showDetails: z.boolean(),
    })
    .default({ enabled: false, showDetails: false }),
});

export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  appLock: { enabled: false, timeoutSeconds: 60 },
  reminders: { enabled: false, showDetails: false },
};

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function loadDeviceSettings(): Promise<DeviceSettings> {
  try {
    const raw = await SecureStore.getItemAsync(DEVICE_SETTINGS_KEY, options);
    if (!raw) return DEFAULT_DEVICE_SETTINGS;
    const parsed = deviceSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_DEVICE_SETTINGS;
  } catch {
    return DEFAULT_DEVICE_SETTINGS;
  }
}

export async function saveDeviceSettings(settings: DeviceSettings): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_SETTINGS_KEY, JSON.stringify(settings), options);
}

export async function clearDeviceSettings(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_SETTINGS_KEY, options);
}

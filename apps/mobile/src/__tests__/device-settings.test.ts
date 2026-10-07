import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  DEFAULT_DEVICE_SETTINGS,
  DEVICE_SETTINGS_KEY,
  clearDeviceSettings,
  loadDeviceSettings,
  saveDeviceSettings,
} from "@/lib/device-settings";

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(async () => {
  store.clear();
  await AsyncStorage.clear();
});

describe("Geräteeinstellungen", () => {
  it("startet mit sicheren Standardwerten (Sperre aus, Erinnerungen aus, ohne Titel)", async () => {
    expect(await loadDeviceSettings()).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(DEFAULT_DEVICE_SETTINGS.reminders.showDetails).toBe(false);
  });

  it("liegt ausschließlich in SecureStore und wird beim Abmelden gelöscht", async () => {
    const next = {
      appLock: { enabled: true, timeoutSeconds: 300 },
      reminders: { enabled: true, showDetails: false },
    };
    await saveDeviceSettings(next);
    expect(store.has(DEVICE_SETTINGS_KEY)).toBe(true);
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(await loadDeviceSettings()).toEqual(next);
    await clearDeviceSettings();
    expect(await loadDeviceSettings()).toEqual(DEFAULT_DEVICE_SETTINGS);
  });

  it("fällt bei beschädigten Daten auf die Standardwerte zurück", async () => {
    store.set(DEVICE_SETTINGS_KEY, "{kaputt");
    expect(await loadDeviceSettings()).toEqual(DEFAULT_DEVICE_SETTINGS);
    store.set(DEVICE_SETTINGS_KEY, JSON.stringify({ appLock: { enabled: "ja" } }));
    expect(await loadDeviceSettings()).toEqual(DEFAULT_DEVICE_SETTINGS);
  });
});

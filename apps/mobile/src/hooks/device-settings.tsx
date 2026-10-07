import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_DEVICE_SETTINGS,
  type DeviceSettings,
  loadDeviceSettings,
  saveDeviceSettings,
} from "@/lib/device-settings";

interface DeviceSettingsValue {
  settings: DeviceSettings;
  loaded: boolean;
  update: (next: DeviceSettings) => Promise<void>;
}

const DeviceSettingsContext = createContext<DeviceSettingsValue | null>(null);

export function DeviceSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DeviceSettings>(DEFAULT_DEVICE_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDeviceSettings().then((value) => {
      if (!active) return;
      setSettings(value);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(async (next: DeviceSettings) => {
    setSettings(next);
    await saveDeviceSettings(next);
  }, []);

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);
  return <DeviceSettingsContext.Provider value={value}>{children}</DeviceSettingsContext.Provider>;
}

export function useDeviceSettings(): DeviceSettingsValue {
  const context = useContext(DeviceSettingsContext);
  if (!context) {
    throw new Error(
      "useDeviceSettings muss innerhalb von DeviceSettingsProvider verwendet werden.",
    );
  }
  return context;
}

/* global jest */
// AsyncStorage: offizielles In-Memory-Mock.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// SecureStore: In-Memory-Ersatz für Tests.
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
    __store: store,
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      if (!/^[A-Za-z0-9._-]+$/.test(key))
        throw new Error(`Ungültiger SecureStore-Schlüssel: ${key}`);
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});

// Lucide-Symbole: schlichte Platzhalter (Darstellung ist nicht Gegenstand der Tests).
jest.mock("lucide-react-native", () => {
  const React = require("react");
  const { View } = require("react-native");
  return new Proxy(
    { __esModule: true },
    {
      get: (target, name) => {
        if (name in target) return target[name];
        if (typeof name !== "string") return undefined;
        const Icon = (props) => React.createElement(View, { testID: `icon-${name}`, ...props });
        Icon.displayName = name;
        target[name] = Icon;
        return Icon;
      },
    },
  );
});

// react-native-svg: einfache Host-Komponenten.
jest.mock("react-native-svg", () => {
  const React = require("react");
  const { View } = require("react-native");
  const make = (name) => {
    const Component = ({ children }) =>
      React.createElement(View, { testID: `svg-${name}` }, children);
    Component.displayName = name;
    return Component;
  };
  return {
    __esModule: true,
    default: make("Svg"),
    Svg: make("Svg"),
    Path: make("Path"),
    Rect: make("Rect"),
    Circle: make("Circle"),
    G: make("G"),
    Line: make("Line"),
  };
});

// Biometrie: steuerbarer Ersatz (Standard: Gerät mit Bildschirmsperre, Entsperren erfolgreich).
jest.mock("expo-local-authentication", () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

// Lokale Benachrichtigungen: In-Memory-Ersatz, der geplante Erinnerungen festhält.
jest.mock("expo-notifications", () => {
  const scheduled = [];
  let permission = "undetermined";
  return {
    __scheduled: scheduled,
    __setPermission: (value) => {
      permission = value;
    },
    AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    AndroidNotificationVisibility: { PRIVATE: 0, PUBLIC: 1, SECRET: -1 },
    SchedulableTriggerInputTypes: { DATE: "date" },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => ({ status: permission })),
    requestPermissionsAsync: jest.fn(async () => {
      permission = "granted";
      return { status: permission };
    }),
    cancelAllScheduledNotificationsAsync: jest.fn(async () => {
      scheduled.length = 0;
    }),
    scheduleNotificationAsync: jest.fn(async (request) => {
      scheduled.push(request);
      return request.identifier ?? String(scheduled.length);
    }),
  };
});

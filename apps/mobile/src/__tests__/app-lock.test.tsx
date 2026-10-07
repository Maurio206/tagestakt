import { fireEvent, render, screen } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Text } from "react-native";

import { AppLockGate } from "@/components/app-lock";
import { DeviceSettingsProvider } from "@/hooks/device-settings";
import {
  getLockAvailability,
  isSystemPromptActive,
  requestUnlock,
  shouldLockOnColdStart,
  shouldLockOnResume,
  withSystemPrompt,
} from "@/lib/app-lock";
import { DEFAULT_DEVICE_SETTINGS, DEVICE_SETTINGS_KEY } from "@/lib/device-settings";

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  store.clear();
  auth.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
  auth.authenticateAsync.mockResolvedValue({ success: true });
});

describe("Sperrlogik", () => {
  const on = { enabled: true, timeoutSeconds: 60 };

  it("ist standardmäßig ausgeschaltet", () => {
    expect(DEFAULT_DEVICE_SETTINGS.appLock.enabled).toBe(false);
    expect(shouldLockOnColdStart(DEFAULT_DEVICE_SETTINGS.appLock)).toBe(false);
  });

  it("sperrt bei aktiver Sperre immer beim Kaltstart", () => {
    expect(shouldLockOnColdStart(on)).toBe(true);
  });

  it("sperrt nach dem eingestellten Hintergrund-Zeitraum", () => {
    expect(shouldLockOnResume(on, 1_000, 30_000)).toBe(false);
    expect(shouldLockOnResume(on, 1_000, 61_000)).toBe(true);
    expect(shouldLockOnResume({ enabled: true, timeoutSeconds: 0 }, 1_000, 1_001)).toBe(true);
    expect(shouldLockOnResume({ ...on, enabled: false }, 1_000, 999_999)).toBe(false);
  });

  it("sperrt vorsichtshalber, wenn der Zeitpunkt unbekannt ist", () => {
    expect(shouldLockOnResume(on, null, 0)).toBe(true);
  });
});

describe("Gerätefunktionen", () => {
  it("erkennt Geräte ohne Bildschirmsperre", async () => {
    auth.getEnrolledLevelAsync.mockResolvedValueOnce(LocalAuthentication.SecurityLevel.NONE);
    expect(await getLockAvailability()).toBe("no-device-security");
    expect(await getLockAvailability()).toBe("available");
  });

  it("erlaubt die Geräte-PIN als Ausweichmöglichkeit", async () => {
    await requestUnlock();
    expect(auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  it("liefert verständliche Meldungen ohne technische Details", async () => {
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: "lockout" });
    expect((await requestUnlock()).message).toMatch(/Zu viele Versuche/);
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: "user_cancel" });
    expect(await requestUnlock()).toEqual({ success: false, message: "Entsperren abgebrochen." });
    auth.authenticateAsync.mockRejectedValueOnce(new Error("native boom"));
    expect((await requestUnlock()).message).not.toMatch(/boom/);
  });

  it("markiert eigene Systemdialoge, damit sie nicht erneut sperren", async () => {
    let during = false;
    await withSystemPrompt(async () => {
      during = isSystemPromptActive();
    });
    expect(during).toBe(true);
    expect(isSystemPromptActive()).toBe(false);
  });
});

describe("AppLockGate", () => {
  function renderGate() {
    return render(
      <DeviceSettingsProvider>
        <AppLockGate onSignOut={jest.fn()}>
          <Text>Geheimer Inhalt (Beispiel)</Text>
        </AppLockGate>
      </DeviceSettingsProvider>,
    );
  }

  it("zeigt ohne aktivierte Sperre direkt die Inhalte", async () => {
    await renderGate();
    expect(await screen.findByText("Geheimer Inhalt (Beispiel)")).toBeOnTheScreen();
    expect(screen.queryByText("TagesTakt ist gesperrt")).toBeNull();
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
  });

  it("verdeckt bei aktiver Sperre alles, bis entsperrt wurde", async () => {
    store.set(
      DEVICE_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_DEVICE_SETTINGS, appLock: { enabled: true, timeoutSeconds: 0 } }),
    );
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: "user_cancel" });
    await renderGate();

    expect(await screen.findByText("TagesTakt ist gesperrt")).toBeOnTheScreen();
    expect(await screen.findByText("Entsperren abgebrochen.")).toBeOnTheScreen();
    // Inhalte sind für Screenreader ausgeblendet, solange gesperrt ist.
    expect(screen.queryByText("Geheimer Inhalt (Beispiel)")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Entsperren" }));
    expect(screen.queryByText("TagesTakt ist gesperrt")).toBeNull();
    expect(screen.getByText("Geheimer Inhalt (Beispiel)")).toBeOnTheScreen();
  });

  it("bietet ohne Bildschirmsperre nur die Abmeldung an", async () => {
    store.set(
      DEVICE_SETTINGS_KEY,
      JSON.stringify({
        ...DEFAULT_DEVICE_SETTINGS,
        appLock: { enabled: true, timeoutSeconds: 60 },
      }),
    );
    auth.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    await renderGate();
    expect(await screen.findByText(/keine Bildschirmsperre eingerichtet/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Entsperren" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Abmelden und mit Passwort anmelden" }),
    ).toBeOnTheScreen();
  });
});

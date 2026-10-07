import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as ScreenCapture from "expo-screen-capture";
import * as SecureStore from "expo-secure-store";
import { AppState, type AppStateStatus, Text } from "react-native";

import { AppLockGate } from "@/components/app-lock";
import { DeviceSettingsProvider } from "@/hooks/device-settings";
import {
  type LockState,
  getLockAvailability,
  initialLockState,
  isSystemPromptActive,
  nextLockState,
  requestUnlock,
  shouldLockOnColdStart,
  shouldLockOnResume,
  withSystemPrompt,
} from "@/lib/app-lock";
import { SCREEN_PRIVACY_KEY } from "@/lib/screen-privacy";
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

describe("Zustandsübergänge (Schutzfläche und Sperre)", () => {
  const on = { enabled: true, timeoutSeconds: 60 };
  const off = { enabled: false, timeoutSeconds: 60 };
  const open: LockState = { locked: false, shielded: false, backgroundedAt: null };

  it("startet bei aktiver Sperre gesperrt, sonst offen", () => {
    expect(initialLockState(on)).toEqual({ locked: true, shielded: false, backgroundedAt: null });
    expect(initialLockState(off)).toEqual(open);
  });

  it("verdeckt Inhalte sofort beim Wechsel in den Hintergrund", () => {
    const next = nextLockState(open, { type: "background", at: 1_000 }, on, false);
    expect(next).toEqual({ locked: false, shielded: true, backgroundedAt: 1_000 });
    // iOS: auch der kurze Zustand „inactive“ (App-Umschalter) zeigt die Schutzfläche.
    expect(nextLockState(open, { type: "inactive" }, on, false).shielded).toBe(true);
  });

  it("entfernt die Schutzfläche bei kurzer Abwesenheit ohne zu sperren", () => {
    const away = nextLockState(open, { type: "background", at: 1_000 }, on, false);
    expect(nextLockState(away, { type: "active", at: 30_000 }, on, false)).toEqual(open);
  });

  it("sperrt nach Ablauf der Zeit; bei „sofort“ schon nach einer Millisekunde", () => {
    const away = nextLockState(open, { type: "background", at: 1_000 }, on, false);
    expect(nextLockState(away, { type: "active", at: 61_000 }, on, false)).toEqual({
      locked: true,
      shielded: false,
      backgroundedAt: null,
    });
    const instant = { enabled: true, timeoutSeconds: 0 };
    const gone = nextLockState(open, { type: "background", at: 5 }, instant, false);
    expect(nextLockState(gone, { type: "active", at: 6 }, instant, false).locked).toBe(true);
  });

  it("zählt den ersten Wechsel in den Hintergrund (kein Zurücksetzen der Frist)", () => {
    const first = nextLockState(open, { type: "background", at: 1_000 }, on, false);
    const second = nextLockState(first, { type: "background", at: 50_000 }, on, false);
    expect(second.backgroundedAt).toBe(1_000);
  });

  it("ohne App-Sperre: keine Schutzfläche, keine Sperre", () => {
    expect(nextLockState(open, { type: "background", at: 1 }, off, false)).toBe(open);
    expect(nextLockState(open, { type: "active", at: 999_999 }, off, false)).toEqual(open);
  });

  it("eigene Systemdialoge (PIN-Eingabe) lösen keine Sperrschleife aus", () => {
    const locked = initialLockState({ enabled: true, timeoutSeconds: 0 });
    // Während der PIN-Eingabe geht die App in den Hintergrund – wird ignoriert …
    const during = nextLockState(locked, { type: "background", at: 10 }, on, true);
    expect(during).toBe(locked);
    // … nach erfolgreicher Entsperrung bleibt die Rückkehr ohne erneute Sperre.
    const unlocked = nextLockState(during, { type: "unlocked" }, on, false);
    expect(nextLockState(unlocked, { type: "active", at: 99_999 }, on, false)).toEqual(open);
    // Reihenfolge umgekehrt (erst „active“, dann „entsperrt“) führt zum selben Ergebnis.
    const activeFirst = nextLockState(during, { type: "active", at: 99_999 }, on, false);
    expect(nextLockState(activeFirst, { type: "unlocked" }, on, false)).toEqual(open);
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
  let emit: (state: AppStateStatus) => void = () => undefined;
  beforeEach(() => {
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      emit = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => jest.restoreAllMocks());

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
    // Ohne App-Sperre bleiben Screenshots erlaubt und es gibt keine Schutzfläche.
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    await act(async () => emit("background"));
    expect(screen.queryByTestId("privacy-shield")).toBeNull();
  });

  it("schützt bei aktiver Sperre die Vorschau und zeigt im Hintergrund nur die Schutzfläche", async () => {
    store.set(
      DEVICE_SETTINGS_KEY,
      JSON.stringify({
        ...DEFAULT_DEVICE_SETTINGS,
        appLock: { enabled: true, timeoutSeconds: 60 },
      }),
    );
    await renderGate();
    // Kaltstart: automatische Entsperrung (Mock: erfolgreich).
    expect(await screen.findByText("Geheimer Inhalt (Beispiel)")).toBeOnTheScreen();
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith(SCREEN_PRIVACY_KEY);

    await act(async () => emit("background"));
    expect(screen.getByTestId("privacy-shield")).toBeOnTheScreen();
    expect(screen.queryByText("Geheimer Inhalt (Beispiel)")).toBeNull();

    // Kurz danach zurück: Schutzfläche weg, keine Sperre.
    await act(async () => emit("active"));
    expect(screen.queryByTestId("privacy-shield")).toBeNull();
    expect(screen.queryByText("TagesTakt ist gesperrt")).toBeNull();
    expect(screen.getByText("Geheimer Inhalt (Beispiel)")).toBeOnTheScreen();
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

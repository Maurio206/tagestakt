import * as ScreenCapture from "expo-screen-capture";
import { Platform } from "react-native";

/**
 * Schutz der Vorschau im App-Umschalter, solange die App-Sperre aktiv ist.
 *
 * Android kennt dafür offiziell nur `FLAG_SECURE` (über `preventScreenCaptureAsync`): Die
 * Vorschau bleibt leer – dabei werden zwangsläufig auch Screenshots und Bildschirmaufnahmen
 * der App blockiert. Deshalb nur bei eingeschalteter App-Sperre. Unter iOS kommt die
 * Unschärfe-Überlagerung für den App-Umschalter hinzu.
 */
export const SCREEN_PRIVACY_KEY = "tagestakt-app-lock";

export async function setScreenPrivacy(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await ScreenCapture.preventScreenCaptureAsync(SCREEN_PRIVACY_KEY);
      if (Platform.OS === "ios") await ScreenCapture.enableAppSwitcherProtectionAsync(0.9);
    } else {
      await ScreenCapture.allowScreenCaptureAsync(SCREEN_PRIVACY_KEY);
      if (Platform.OS === "ios") await ScreenCapture.disableAppSwitcherProtectionAsync();
    }
  } catch {
    // Ohne natives Modul (z. B. Tests) bleibt die neutrale Schutzfläche der einzige Schutz.
  }
}

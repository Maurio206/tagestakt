import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Höhe der eingeblendeten Bildschirmtastatur. Mit Edge-to-Edge (Android) verkleinert das
 * System das Fenster nicht mehr selbst – der Editor rückt seinen Inhalt daher um diese Höhe
 * nach oben, damit Eingabefeld und „Speichern“ sichtbar bleiben.
 */
export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => setHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

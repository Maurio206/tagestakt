import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** Aktuelle Zeit, aktualisiert im Intervall und beim Zurückkehren in die App. */
export function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date());
    });
    return () => {
      clearInterval(id);
      subscription.remove();
    };
  }, [intervalMs]);
  return now;
}

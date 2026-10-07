import { formatDurationSpoken, formatElapsed } from "@tagestakt/schedule-schema";
import { StyleSheet, Text } from "react-native";

import { useNow } from "@/hooks/use-now";
import { monoFamily, type, useTheme } from "@/theme";

/**
 * Laufzeit einer Aktivität – immer aus dem Serverbeginn berechnet. Dadurch stimmt die
 * Anzeige nach App-Neustart, Sperre oder Offline-Phase sofort wieder. Nur die Ziffern
 * ändern sich; Screenreader erhalten eine minutengenaue Beschreibung.
 */
export function FocusTimer({ startedAt, size = "lg" }: { startedAt: string; size?: "lg" | "sm" }) {
  const now = useNow(1000);
  const theme = useTheme();
  const elapsed = Math.max(0, now.getTime() - Date.parse(startedAt));
  return (
    <Text
      accessibilityRole="timer"
      accessibilityLabel={`Läuft seit ${formatDurationSpoken(Math.floor(elapsed / 60_000))}`}
      style={[size === "lg" ? styles.lg : styles.sm, { color: theme.text }]}
    >
      {formatElapsed(elapsed)}
    </Text>
  );
}

const styles = StyleSheet.create({
  lg: {
    ...type.timer,
    fontFamily: monoFamily,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  sm: { fontSize: 18, fontFamily: monoFamily, fontWeight: "500", fontVariant: ["tabular-nums"] },
});

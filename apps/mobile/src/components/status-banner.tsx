import { formatLocalDateShort, formatTime, toLocalDate } from "@tagestakt/schedule-schema";
import { StyleSheet, Text, View } from "react-native";

import { type PlanOrigin, isFetchedAtStale } from "@/lib/plan-status";
import { type Theme, spacing, useTheme } from "@/theme";

function describeFetchedAt(fetchedAt: string, now: Date): string {
  const date = new Date(fetchedAt);
  const sameDay = toLocalDate(date) === toLocalDate(now);
  return sameDay
    ? `heute, ${formatTime(date)} Uhr`
    : `${formatLocalDateShort(toLocalDate(date))} ${formatTime(date)} Uhr`;
}

/** Deutlicher Hinweis, wenn offline der zwischengespeicherte oder ein veralteter Plan angezeigt wird. */
export function StatusBanner({
  origin,
  fetchedAt,
  now,
  errorMessage,
}: {
  origin: PlanOrigin;
  fetchedAt: string;
  now: Date;
  errorMessage?: string;
}) {
  const theme = useTheme();
  const stale = isFetchedAtStale(fetchedAt, now);
  if (origin === "network" && !stale) return null;

  const title =
    origin === "cache" ? "Offline – gespeicherter Plan" : "Plan möglicherweise veraltet";
  return (
    <View accessibilityRole="alert" style={[styles.banner, bannerColors(theme)]}>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={{ color: theme.text }}>
        Zuletzt aktualisiert: {describeFetchedAt(fetchedAt, now)}.
        {errorMessage ? ` ${errorMessage}` : ""}
      </Text>
    </View>
  );
}

function bannerColors(theme: Theme) {
  return { backgroundColor: theme.warningBg, borderColor: theme.warning };
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.xs,
  },
  title: {
    fontWeight: "700",
    fontSize: 16,
  },
});

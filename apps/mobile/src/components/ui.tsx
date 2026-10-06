import { CATEGORY_COLORS, CATEGORY_LABELS, type EntryCategory } from "@tagestakt/schedule-schema";
import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { type Theme, spacing, useTheme } from "@/theme";

export function Card({
  children,
  style,
  highlighted,
}: {
  children: ReactNode;
  style?: ViewStyle;
  highlighted?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: highlighted ? theme.accent : theme.border },
        highlighted ? styles.highlighted : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text style={[styles.eyebrow, { color: theme.textMuted }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.body, { color: theme.textMuted }]}>{children}</Text>;
}

export function Body({ children, bold }: { children: ReactNode; bold?: boolean }) {
  const theme = useTheme();
  return (
    <Text style={[styles.body, { color: theme.text }, bold ? styles.bold : null]}>{children}</Text>
  );
}

/** Kategorie als Text mit zurückhaltendem Farbpunkt (Farbe nie alleiniger Informationsträger). */
export function CategoryPill({ category }: { category: EntryCategory }) {
  const theme = useTheme();
  return (
    <View
      style={styles.pill}
      accessible
      accessibilityLabel={`Kategorie ${CATEGORY_LABELS[category]}`}
    >
      <View style={[styles.dot, { backgroundColor: CATEGORY_COLORS[category] }]} />
      <Text style={[styles.pillText, { color: theme.textMuted }]}>{CATEGORY_LABELS[category]}</Text>
    </View>
  );
}

export function ProgressBar({
  ratio,
  label,
  secondaryRatio,
}: {
  ratio: number;
  label: string;
  secondaryRatio?: number;
}) {
  const theme = useTheme();
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  const secondary = Math.round(Math.min(1, Math.max(0, secondaryRatio ?? 0)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
    >
      <View
        style={[
          styles.fill,
          { width: `${percent}%`, backgroundColor: theme.accent, opacity: 0.45 },
        ]}
      />
      {secondaryRatio !== undefined ? (
        <View style={[styles.fill, { width: `${secondary}%`, backgroundColor: theme.accent }]} />
      ) : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const colors = buttonColors(theme, variant);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function buttonColors(theme: Theme, variant: "primary" | "secondary" | "danger") {
  if (variant === "primary")
    return { bg: theme.accent, border: theme.accent, text: theme.accentText };
  if (variant === "danger") return { bg: "transparent", border: theme.danger, text: theme.danger };
  return { bg: theme.surfaceAlt, border: theme.border, text: theme.text };
}

export const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  highlighted: {
    borderWidth: 2,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
  },
  bold: {
    fontWeight: "700",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pillText: {
    fontSize: 15,
  },
  track: {
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  button: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
  },
});

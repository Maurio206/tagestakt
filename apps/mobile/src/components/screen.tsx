import { type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { spacing, useTheme } from "@/theme";

/**
 * Scrollbarer Bildschirm mit „Ziehen zum Aktualisieren“. `footer` bleibt unten stehen
 * (z. B. die Timer-Leiste über der Tab-Leiste).
 */
export function Screen({
  children,
  refreshing,
  onRefresh,
  footer,
  edges = ["top", "left", "right"],
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  edges?: ("top" | "bottom" | "left" | "right")[];
}) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={edges}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor={theme.text}
              colors={[theme.text]}
              progressBackgroundColor={theme.surface2}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {footer ? <View>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl - 4,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
});

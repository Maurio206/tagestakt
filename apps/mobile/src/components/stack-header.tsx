import { useRouter } from "expo-router";
import { ChevronLeft, X } from "lucide-react-native";
import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { spacing, type, useTheme } from "@/theme";

/** Kopf für Unterseiten: „Zurück“ (bzw. „Schließen“ bei Dialogen) und Seitentitel. */
export function StackHeader({
  title,
  subtitle,
  modal,
  action,
}: {
  title: string;
  subtitle?: string;
  modal?: boolean;
  action?: ReactNode;
}) {
  const theme = useTheme();
  const router = useRouter();
  const Icon = modal ? X : ChevronLeft;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={modal ? "Schließen" : "Zurück"}
          onPress={back}
          hitSlop={4}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: pressed ? theme.surface2 : "transparent" },
          ]}
        >
          <Icon color={theme.text} size={24} />
          {modal ? null : <Text style={[styles.backText, { color: theme.text }]}>Zurück</Text>}
        </Pressable>
        {action}
      </View>
      <View>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 48,
    minWidth: 48,
    paddingRight: spacing.md,
    marginLeft: -spacing.sm,
    paddingLeft: spacing.xs,
    borderRadius: 12,
  },
  backText: { fontSize: 16, fontWeight: "600" },
  title: { ...type.pageTitle, fontWeight: "700" },
  subtitle: { ...type.small },
});

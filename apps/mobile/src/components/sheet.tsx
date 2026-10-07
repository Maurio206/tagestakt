import { type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { radius, spacing, type, useTheme } from "@/theme";

import { TintedSurface } from "./ui";

/**
 * Unteres Blatt (Sheet) als Modal: Fokus bleibt im Dialog, Zurück-Taste schließt.
 * Bei „Bewegung reduzieren“ ohne Animation.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Schließen"
          onPress={onClose}
        />
        <SafeAreaView
          edges={["bottom"]}
          style={[styles.sheet, { backgroundColor: theme.surface1, borderColor: theme.line }]}
          accessibilityViewIsModal
        >
          <View style={[styles.handle, { backgroundColor: theme.lineStrong }]} />
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            {title}
          </Text>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* Das Blatt liegt auf surface1 – auch wenn es aus einem getönten Fokusblock öffnet. */}
            <TintedSurface tinted={false}>{children}</TintedSurface>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(5,4,3,0.62)" },
  sheet: {
    maxHeight: "92%",
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    paddingHorizontal: spacing.xl - 4,
    paddingTop: spacing.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  title: { ...type.section, fontWeight: "700", marginBottom: spacing.md },
  body: { gap: spacing.lg, paddingBottom: spacing.xl },
});

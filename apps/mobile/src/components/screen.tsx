import { type ReactNode, createContext, useContext, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { spacing, useTheme } from "@/theme";

/**
 * Sichtbarer Bereich des Bildschirms (dp): Höhe und Breite des Scrollbereichs – also ohne
 * Statusleiste, Safe Areas, Tab-Leiste und Fußzeile. Ändert sich bei Drehung und Schriftgröße
 * mit; 0, solange noch nicht gemessen (z. B. in Tests).
 */
export interface Viewport {
  height: number;
  width: number;
  /** Innenabstand oben im Scrollinhalt; Inhalte bis zur Falz rechnen ihn heraus. */
  paddingTop: number;
}

const SCREEN_PADDING_TOP = spacing.sm;

const ViewportContext = createContext<Viewport>({
  height: 0,
  width: 0,
  paddingTop: SCREEN_PADDING_TOP,
});

export const ViewportProvider = ViewportContext.Provider;

export function useViewport(): Viewport {
  return useContext(ViewportContext);
}

/**
 * Sperrt das Scrollen der Seite, solange eine eingebettete Fläche eine Geste selbst führt (z. B.
 * das frei verschiebbare Wochenraster). Außerhalb dieser Fläche scrollt die Seite normal.
 */
const PageScrollLockContext = createContext<(locked: boolean) => void>(() => undefined);

export function usePageScrollLock(): (locked: boolean) => void {
  return useContext(PageScrollLockContext);
}

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
  const [scrollLocked, setScrollLocked] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({
    height: 0,
    width: 0,
    paddingTop: SCREEN_PADDING_TOP,
  });
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={edges}>
      <ScrollView
        testID="screen-scroll"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!scrollLocked}
        onLayout={({ nativeEvent }) => {
          const { height, width } = nativeEvent.layout;
          if (height !== viewport.height || width !== viewport.width)
            setViewport({ height, width, paddingTop: SCREEN_PADDING_TOP });
        }}
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
        <PageScrollLockContext.Provider value={setScrollLocked}>
          <ViewportProvider value={viewport}>{children}</ViewportProvider>
        </PageScrollLockContext.Provider>
      </ScrollView>
      {footer ? <View>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl - 4,
    paddingTop: SCREEN_PADDING_TOP,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
});

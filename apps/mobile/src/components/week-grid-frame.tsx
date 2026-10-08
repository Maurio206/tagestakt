import { type LocalDate, type ScheduleEntry } from "@tagestakt/schedule-schema";
import { Maximize2, Minimize2 } from "lucide-react-native";
import { type ReactNode, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { spacing, type, useTheme } from "@/theme";

import { useViewport } from "./screen";
import { Button } from "./ui";
import { type GridOffset, WeekGrid } from "./week-grid";

/** Höhe des eingebetteten Rasters: rund 70 % des sichtbaren Bereichs (wie `70dvh` im Web). */
export function inlineGridHeight(viewportHeight: number): number {
  if (viewportHeight <= 0) return 420;
  return Math.max(Math.min(260, viewportHeight - 24), Math.round(viewportHeight * 0.7));
}

/**
 * Rahmen um das Wochenraster mit Schalter „Vollbild“. Im Vollbild liegt das Raster in einem
 * bildschirmfüllenden Modal (bis in die Systemleisten, Inhalt innerhalb der Safe Areas); die
 * Android-Zurück-Taste beendet zuerst das Vollbild. Die Scrollposition wird in beide Richtungen
 * übernommen. `overlay` (Blockdetails) erscheint jeweils über dem sichtbaren Raster.
 */
export function WeekGridFrame({
  title,
  weekStart,
  entries,
  overlapIds,
  now,
  selectedId,
  onSelect,
  fullscreen,
  onFullscreenChange,
  overlay,
}: {
  title: string;
  weekStart: LocalDate;
  entries: readonly ScheduleEntry[];
  overlapIds: ReadonlySet<string>;
  now: Date;
  selectedId: string | null;
  onSelect: (entry: ScheduleEntry) => void;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  overlay?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const viewport = useViewport();
  // Zuletzt gezeigte Stelle (nur in Ereignissen gelesen) und Startstelle des nächsten Rasters.
  const offset = useRef<GridOffset>({ x: 0, y: 0 });
  const [start, setStart] = useState<GridOffset>({ x: 0, y: 0 });
  // Nach dem Vollbild das eingebettete Raster an der zuletzt gezeigten Stelle neu aufbauen.
  const [inlineKey, setInlineKey] = useState(0);
  const remember = (next: Partial<GridOffset>) => {
    offset.current = { ...offset.current, ...next };
  };
  const open = () => {
    setStart({ ...offset.current });
    onFullscreenChange(true);
  };
  const close = () => {
    setStart({ ...offset.current });
    setInlineKey((key) => key + 1);
    onFullscreenChange(false);
  };
  const grid = {
    weekStart,
    entries,
    overlapIds,
    now,
    selectedId,
    onSelect,
    onOffsetChange: remember,
  };

  return (
    <View style={styles.frame}>
      <View style={styles.toolbar}>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Wischen: Tage seitlich, Stunden nach oben und unten.
        </Text>
        <Button
          label="Vollbild"
          icon={Maximize2}
          accessibilityLabel="Wochenraster im Vollbild anzeigen"
          accessibilityHint="Zurück beendet das Vollbild wieder"
          onPress={open}
        />
      </View>
      <WeekGrid
        key={inlineKey}
        {...grid}
        height={inlineGridHeight(viewport.height)}
        initialOffset={start}
      />
      {fullscreen ? null : overlay}

      <Modal
        testID="week-grid-modal"
        visible={fullscreen}
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={close}
        statusBarTranslucent
        navigationBarTranslucent
        supportedOrientations={["portrait", "landscape"]}
      >
        <View
          testID="week-grid-fullscreen"
          style={[
            styles.full,
            {
              backgroundColor: theme.bg,
              paddingTop: insets.top + spacing.sm,
              paddingBottom: insets.bottom + spacing.sm,
              paddingLeft: insets.left + spacing.sm,
              paddingRight: insets.right + spacing.sm,
            },
          ]}
        >
          <View style={styles.toolbar}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.title, { color: theme.text }]}
            >
              {title}
            </Text>
            <Button
              label="Vollbild beenden"
              icon={Minimize2}
              accessibilityHint="Kehrt zur Wochenansicht zurück"
              onPress={close}
            />
          </View>
          {fullscreen ? <WeekGrid {...grid} initialOffset={start} /> : null}
          {fullscreen ? overlay : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { gap: spacing.sm },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  hint: { flex: 1, ...type.small },
  title: { flex: 1, ...type.section, fontWeight: "700" },
  full: { flex: 1, gap: spacing.sm },
});

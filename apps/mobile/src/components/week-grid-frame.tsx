import { type LocalDate, type ScheduleEntry } from "@tagestakt/schedule-schema";
import { type LucideIcon, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react-native";
import { type ReactNode, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { spacing, touch, type, useTheme } from "@/theme";

import { useViewport } from "./screen";
import { Button } from "./ui";
import { GRID_ZOOM_LEVELS, type GridOffset, WeekGrid } from "./week-grid";

/** Höhe des eingebetteten Rasters: rund 70 % des sichtbaren Bereichs (wie `70dvh` im Web). */
export function inlineGridHeight(viewportHeight: number): number {
  if (viewportHeight <= 0) return 420;
  return Math.max(Math.min(260, viewportHeight - 24), Math.round(viewportHeight * 0.7));
}

/** Zwei Knöpfe für den Stundenzoom mit der aktuellen Stufe dazwischen. */
function ZoomControls({ level, onChange }: { level: number; onChange: (level: number) => void }) {
  const theme = useTheme();
  const percent = Math.round((GRID_ZOOM_LEVELS[level] ?? 1) * 100);
  const button = (label: string, hint: string, Icon: LucideIcon, next: number) => {
    const disabled = next < 0 || next >= GRID_ZOOM_LEVELS.length;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onChange(next)}
        style={({ pressed }) => [
          styles.zoomButton,
          {
            backgroundColor: pressed && !disabled ? theme.surface3 : theme.surface2,
            borderColor: theme.lineStrong,
            opacity: disabled ? 0.45 : 1,
          },
        ]}
      >
        <Icon color={theme.text} size={18} strokeWidth={2} />
      </Pressable>
    );
  };
  return (
    <View style={styles.zoom}>
      {button(
        "Stunden herauszoomen",
        "Zeigt mehr Stunden auf einmal, die Tage bleiben gleich breit",
        ZoomOut,
        level + 1,
      )}
      <Text
        accessibilityLabel={`Stundenzoom ${percent} %`}
        style={[styles.zoomValue, { color: theme.textMuted }]}
      >
        {percent} %
      </Text>
      {button("Stunden hineinzoomen", "Zeigt die Stunden größer", ZoomIn, level - 1)}
    </View>
  );
}

/**
 * Rahmen um das Wochenraster mit Stundenzoom und Schalter „Vollbild“. Im Vollbild liegt das
 * Raster in einem bildschirmfüllenden Modal (bis in die Systemleisten, Inhalt innerhalb der Safe
 * Areas); die Android-Zurück-Taste beendet zuerst das Vollbild. Scrollposition und Zoomstufe
 * werden in beide Richtungen übernommen; beim Zoomen bleibt die oberste sichtbare Stunde oben.
 * `overlay` (Blockdetails) erscheint jeweils über dem sichtbaren Raster.
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
  // Index in GRID_ZOOM_LEVELS; ein Wechsel baut das sichtbare Raster neu auf (siehe `zoomTo`).
  const [zoomLevel, setZoomLevel] = useState(0);
  const zoom = GRID_ZOOM_LEVELS[zoomLevel] ?? 1;
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
  const zoomTo = (level: number) => {
    // Die oberste sichtbare Stunde bleibt oben: senkrechte Position im Verhältnis der Stufen.
    const ratio = (GRID_ZOOM_LEVELS[level] ?? 1) / zoom;
    offset.current = { x: offset.current.x, y: Math.round(offset.current.y * ratio) };
    setStart({ ...offset.current });
    setZoomLevel(level);
  };
  const grid = {
    weekStart,
    entries,
    overlapIds,
    now,
    selectedId,
    onSelect,
    zoom,
  };
  const zoomControls = <ZoomControls level={zoomLevel} onChange={zoomTo} />;

  return (
    <View style={styles.frame}>
      <View style={styles.toolbar}>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Wischen: Tage seitlich, Stunden nach oben und unten.
        </Text>
        <View style={styles.controls}>
          {/* Im Vollbild sitzt der Zoom in dessen Kopfzeile (keine doppelten Knöpfe). */}
          {fullscreen ? null : zoomControls}
          <Button
            label="Vollbild"
            icon={Maximize2}
            accessibilityLabel="Wochenraster im Vollbild anzeigen"
            accessibilityHint="Zurück beendet das Vollbild wieder"
            onPress={open}
          />
        </View>
      </View>
      <WeekGrid
        key={`${inlineKey}-${zoomLevel}`}
        {...grid}
        height={inlineGridHeight(viewport.height)}
        initialOffset={start}
        // Hinter dem Vollbild meldet nur das sichtbare Raster seine Position.
        onOffsetChange={fullscreen ? undefined : remember}
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
            <View style={styles.controls}>
              {zoomControls}
              <Button
                label="Vollbild beenden"
                icon={Minimize2}
                accessibilityHint="Kehrt zur Wochenansicht zurück"
                onPress={close}
              />
            </View>
          </View>
          {fullscreen ? (
            <WeekGrid key={zoomLevel} {...grid} initialOffset={start} onOffsetChange={remember} />
          ) : null}
          {fullscreen ? overlay : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { gap: spacing.sm },
  // Schmal (Hochformat): Hinweis bzw. Titel in der ersten Zeile, Knöpfe rechtsbündig darunter.
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  hint: { flexGrow: 1, flexShrink: 1, flexBasis: 180, ...type.small },
  title: { flexGrow: 1, flexShrink: 1, flexBasis: 160, ...type.section, fontWeight: "700" },
  controls: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginLeft: "auto" },
  zoom: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  zoomButton: {
    width: touch.min,
    height: touch.min,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomValue: {
    minWidth: 44,
    textAlign: "center",
    ...type.small,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  full: { flex: 1, gap: spacing.sm },
});

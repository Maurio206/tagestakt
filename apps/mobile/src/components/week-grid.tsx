import {
  CATEGORY_LABELS,
  type LocalDate,
  type PlacedDaySegment,
  type ScheduleEntry,
  WEEKDAY_SHORT_LABELS,
  formatLocalDateLong,
  formatTimeRange,
  getEntryTimeState,
  getWeekGridLayout,
  isoWeekdayOfLocalDate,
  localMinutesOfDay,
  parseLocalDate,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { Check, TriangleAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { blockStyle, monoFamily, radius, useTheme } from "@/theme";

import { type GridOffset, useGridPan } from "./grid-pan";
import { usePageScrollLock } from "./screen";

export type { GridOffset };

/** Grundmaße (dp) bei Standardschrift; sie wachsen mit der Systemschrift (bis 150 %). */
export const GRID_METRICS = { hourHeight: 52, timeWidth: 48, minDayWidth: 90, minBlock: 24 };

/**
 * Zoomstufen der Stundenachse (100 %, 75 %, 50 %). Gezoomt wird nur die Höhe einer Stunde – die
 * Tagesbreite bleibt, im Hochformat also weiterhin rund vier Tage nebeneinander.
 */
export const GRID_ZOOM_LEVELS = [1, 0.75, 0.5] as const;

/** Maße des Rasters aus Breite, Schriftgröße und Stundenzoom – keine festen Gerätewerte. */
export function gridMetrics(width: number, fontScale: number, zoom = 1) {
  const scale = Math.min(1.5, Math.max(1, fontScale));
  const hourHeight = Math.round(GRID_METRICS.hourHeight * scale * zoom);
  const timeWidth = Math.round(GRID_METRICS.timeWidth * scale);
  const minDay = Math.round(GRID_METRICS.minDayWidth * Math.min(1.3, scale));
  // Passen alle sieben Tage hinein (Querformat, Tablet), teilen sie sich die Breite.
  const dayWidth = width > 0 ? Math.max(minDay, Math.floor((width - timeWidth) / 7)) : minDay;
  return { hourHeight, timeWidth, dayWidth };
}

function statusText(entry: ScheduleEntry, current: boolean, overlap: boolean): string {
  const parts: string[] = [];
  if (current) parts.push("läuft gerade");
  if (entry.completion_status === "completed") parts.push("erledigt");
  if (entry.completion_status === "skipped") parts.push("ausgelassen");
  if (overlap) parts.push("Überschneidung");
  return parts.join(", ");
}

function GridBlock({
  segment,
  date,
  now,
  hourHeight,
  firstHour,
  dayWidth,
  selected,
  overlap,
  onSelect,
}: {
  segment: PlacedDaySegment<ScheduleEntry>;
  date: LocalDate;
  now: Date;
  hourHeight: number;
  firstHour: number;
  dayWidth: number;
  selected: boolean;
  overlap: boolean;
  onSelect: (entry: ScheduleEntry) => void;
}) {
  const theme = useTheme();
  const { entry, from, to, continued, lane, lanes } = segment;
  const state = getEntryTimeState(entry, now);
  const current = state === "current";
  const look = blockStyle(theme, entry.category, {
    // Aktueller Block = Hauptphase, vergangene als Nebenblock, kommende regulär.
    emphasis: current ? "strong" : state === "past" ? "muted" : "base",
    running: current,
    selected,
    skipped: entry.completion_status === "skipped",
    overlap,
  });
  const start = Math.max(from, firstHour * 60);
  const top = ((start - firstHour * 60) / 60) * hourHeight;
  const height = Math.max(GRID_METRICS.minBlock, ((to - start) / 60) * hourHeight - 2);
  const inner = dayWidth - 6;
  const left = 3 + (inner * lane) / lanes;
  const width = inner / lanes - (lanes > 1 ? 2 : 0);
  const status = statusText(entry, current, overlap);
  const range = formatTimeRange(entry.start_at, entry.end_at);

  return (
    <Pressable
      testID={`week-grid-block-${entry.id}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${entry.title}, ${CATEGORY_LABELS[entry.category]}, ${formatLocalDateLong(date)}, ${range}${continued ? " (Fortsetzung vom Vortag)" : ""}${status ? `, ${status}` : ""}`}
      accessibilityHint="Zeigt die Details des Blocks"
      onPress={() => onSelect(entry)}
      style={({ pressed }) => [
        styles.block,
        look.container,
        { top, height, left, width },
        pressed ? styles.pressed : null,
      ]}
    >
      <Text
        numberOfLines={height >= 44 ? 2 : 1}
        style={[
          styles.blockTitle,
          {
            color: look.text,
            textDecorationLine: entry.completion_status === "skipped" ? "line-through" : "none",
          },
        ]}
      >
        {continued ? "↳ " : ""}
        {entry.title}
      </Text>
      {height >= 40 ? (
        <Text numberOfLines={1} style={[styles.blockTime, { color: look.textMuted }]}>
          {range}
        </Text>
      ) : null}
      {/* Zustände auch ohne Farbe: Symbol bzw. Wort (bei kleinen Blöcken nur das Symbol). */}
      {current || entry.completion_status !== "planned" || overlap ? (
        <View style={styles.statusRow}>
          {entry.completion_status === "completed" ? (
            <Check color={look.text} size={12} strokeWidth={2.5} />
          ) : null}
          {overlap ? <TriangleAlert color={theme.warning} size={12} strokeWidth={2.2} /> : null}
          {height >= 64 && status ? (
            <Text numberOfLines={1} style={[styles.blockStatus, { color: look.textMuted }]}>
              {status}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Zeitraster einer Woche wie im mobilen Wochenplan der Website: Zeitachse links, sieben
 * Tagesspalten nebeneinander. Ein Finger verschiebt Tage und Stunden frei in beide Richtungen,
 * auch diagonal; Zeitspalte und Kopfzeile laufen auf ihrer Achse mit und bleiben auf der
 * anderen stehen. `zoom` staucht nur die Stundenachse. Datengrundlage und Geometrie kommen
 * aus `@tagestakt/schedule-schema` (`getWeekGridLayout`) – keine eigene Zeitlogik.
 */
export function WeekGrid({
  weekStart,
  entries,
  overlapIds,
  now,
  selectedId,
  onSelect,
  height,
  initialOffset,
  onOffsetChange,
  zoom = 1,
}: {
  weekStart: LocalDate;
  entries: readonly ScheduleEntry[];
  overlapIds: ReadonlySet<string>;
  now: Date;
  selectedId?: string | null;
  onSelect: (entry: ScheduleEntry) => void;
  /** Feste Höhe (eingebettet); ohne Angabe füllt das Raster seinen Container (Vollbild). */
  height?: number;
  /** Scrollposition beim Einblenden, z. B. beim Wechsel ins bzw. aus dem Vollbild. */
  initialOffset?: GridOffset;
  /** Meldet die Position nach jeder Bewegung (nach dem Loslassen bzw. dem Schwung). */
  onOffsetChange?: (offset: GridOffset) => void;
  /** Stundenzoom (siehe `GRID_ZOOM_LEVELS`); die Tagesbreite bleibt unverändert. */
  zoom?: number;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const { hourHeight, timeWidth, dayWidth } = gridMetrics(width, fontScale, zoom);
  const { days, firstHour, lastHour } = getWeekGridLayout(entries, weekStart);
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const gridHeight = hourHeight * (lastHour - firstHour);
  const contentWidth = dayWidth * days.length;
  const today = toLocalDate(now);
  const nowMinutes = localMinutesOfDay(now);
  const nowTop =
    nowMinutes >= firstHour * 60 && nowMinutes <= lastHour * 60
      ? ((nowMinutes - firstHour * 60) / 60) * hourHeight
      : null;

  // Startposition nur beim Einblenden übernehmen – spätere Neuberechnungen springen nicht.
  const [initial] = useState<GridOffset>(() => ({ x: 0, y: 0, ...initialOffset }));
  // Sichtbarer Ausschnitt der Tagesspalten; daraus die Grenzen beider Achsen (kein Überscrollen).
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  // Die Seite scrollt nicht mit, solange ein Finger auf dem Raster liegt: gesperrt ab der
  // Berührung (sonst kann die Seite eine senkrechte Bewegung übernehmen, bevor das Raster sie
  // beansprucht), gelöst beim Abheben, Abbruch, Gestenende und Ausblenden.
  const lockPageScroll = usePageScrollLock();
  useEffect(() => () => lockPageScroll(false), [lockPageScroll]);
  const { panHandlers, shiftX, shiftY } = useGridPan({
    initial,
    maxX: Math.max(0, contentWidth - viewport.width),
    maxY: Math.max(0, gridHeight - viewport.height),
    onOffsetChange,
    onActiveChange: lockPageScroll,
  });

  return (
    <View
      testID="week-grid"
      accessibilityLabel="Zeitraster der Woche"
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={[
        styles.frame,
        height ? { height } : styles.fill,
        { backgroundColor: theme.surface1, borderColor: theme.line },
      ]}
    >
      <View style={[styles.headRow, { borderBottomColor: theme.line }]}>
        <View style={{ width: timeWidth }} />
        <View style={styles.clip}>
          <Animated.View
            testID="week-grid-heads"
            style={[styles.headDays, { width: contentWidth, transform: [{ translateX: shiftX }] }]}
          >
            {days.map(({ date, segments }) => {
              const isToday = date === today;
              const label = `${formatLocalDateLong(date)}${isToday ? ", heute" : ""}, ${
                segments.length === 1 ? "1 Block" : `${segments.length} Blöcke`
              }`;
              return (
                <View
                  key={date}
                  testID={`week-grid-head-${date}`}
                  accessible
                  accessibilityRole="header"
                  accessibilityLabel={label}
                  style={[
                    styles.head,
                    { width: dayWidth, borderLeftColor: theme.line },
                    isToday ? { backgroundColor: theme.surface2 } : null,
                  ]}
                >
                  <Text style={[styles.headName, { color: theme.textMuted }]}>
                    {WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(date)]}
                  </Text>
                  <Text
                    style={[
                      styles.headDay,
                      isToday
                        ? { color: theme.onInverse, backgroundColor: theme.inverse }
                        : { color: theme.text },
                    ]}
                  >
                    {parseLocalDate(date).day}
                  </Text>
                  {isToday ? (
                    <Text style={[styles.headToday, { color: theme.text }]}>heute</Text>
                  ) : null}
                </View>
              );
            })}
          </Animated.View>
        </View>
      </View>

      {/* Eine Geste verschiebt Tage und Stunden zugleich (auch diagonal), siehe grid-pan.ts. */}
      <View
        testID="week-grid-body"
        style={styles.body}
        onTouchStart={() => lockPageScroll(true)}
        onTouchEnd={() => lockPageScroll(false)}
        onTouchCancel={() => lockPageScroll(false)}
        {...panHandlers}
      >
        <View style={[styles.clip, { width: timeWidth, flex: 0 }]} importantForAccessibility="no">
          <Animated.View
            testID="week-grid-hours"
            style={{ height: gridHeight, transform: [{ translateY: shiftY }] }}
          >
            {hours.map((hour, index) => (
              <Text
                key={hour}
                style={[
                  styles.hourLabel,
                  { top: index * hourHeight + (index === 0 ? 2 : -7), color: theme.textMuted },
                ]}
              >
                {String(hour).padStart(2, "0")}:00
              </Text>
            ))}
          </Animated.View>
        </View>
        <View
          testID="week-grid-viewport"
          style={styles.clip}
          onLayout={({ nativeEvent }) =>
            setViewport({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
          }
        >
          <Animated.View
            testID="week-grid-content"
            style={{
              width: contentWidth,
              height: gridHeight,
              transform: [{ translateX: shiftX }, { translateY: shiftY }],
            }}
          >
            {hours.map((hour, index) => (
              <View
                key={hour}
                style={[styles.hourLine, { top: index * hourHeight, borderTopColor: theme.line }]}
              />
            ))}
            <View style={styles.columns}>
              {days.map(({ date, segments }) => (
                <View
                  key={date}
                  testID={`week-grid-col-${date}`}
                  style={[
                    styles.col,
                    { width: dayWidth, borderLeftColor: theme.line },
                    date === today ? { backgroundColor: theme.surface2 } : null,
                  ]}
                >
                  {segments.map((segment) => (
                    <GridBlock
                      key={`${segment.entry.id}-${date}`}
                      segment={segment}
                      date={date}
                      now={now}
                      hourHeight={hourHeight}
                      firstHour={firstHour}
                      dayWidth={dayWidth}
                      selected={segment.entry.id === selectedId}
                      overlap={overlapIds.has(segment.entry.id)}
                      onSelect={onSelect}
                    />
                  ))}
                  {date === today && nowTop !== null ? (
                    <View
                      testID="week-grid-now"
                      pointerEvents="none"
                      style={[styles.nowLine, { top: nowTop, backgroundColor: theme.inverse }]}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: radius.lg, overflow: "hidden" },
  fill: { flex: 1 },
  headRow: { flexDirection: "row", borderBottomWidth: 1 },
  clip: { flex: 1, overflow: "hidden" },
  headDays: { flexDirection: "row" },
  head: {
    alignItems: "flex-start",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  headName: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  headDay: {
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    paddingHorizontal: 6,
    borderRadius: 8,
    overflow: "hidden",
  },
  headToday: { fontSize: 11, fontWeight: "700" },
  body: { flex: 1, flexDirection: "row" },
  hourLabel: {
    position: "absolute",
    right: 6,
    fontFamily: monoFamily,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  hourLine: { position: "absolute", left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  columns: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row" },
  col: { height: "100%", borderLeftWidth: StyleSheet.hairlineWidth },
  block: {
    position: "absolute",
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
    gap: 1,
  },
  pressed: { opacity: 0.8 },
  blockTitle: { fontSize: 12.5, fontWeight: "700", lineHeight: 16 },
  blockTime: { fontFamily: monoFamily, fontSize: 11, fontVariant: ["tabular-nums"] },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  blockStatus: { fontSize: 11, fontWeight: "600", flexShrink: 1 },
  nowLine: { position: "absolute", left: 0, right: 0, height: 2 },
});

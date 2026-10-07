import { formatTime, notePreview, normalizeNoteContent } from "@tagestakt/schedule-schema";
import { ChevronRight, NotebookPen, RotateCcw } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DailyNoteState } from "@/hooks/use-daily-note";
import { spacing, useTheme } from "@/theme";

import { Button, Notice } from "./ui";

const OFFLINE_TEXT =
  "Tagesnotizen werden nicht auf dem Gerät gespeichert. Lesen und Speichern sind wieder möglich, sobald eine Verbindung besteht.";

/** Notiz nicht verfügbar: offline (nichts wird vorgetäuscht) oder Ladefehler. */
export function NoteUnavailable({
  kind,
  retrying,
  onRetry,
}: {
  kind: "offline" | "error";
  retrying?: boolean;
  onRetry: () => void;
}) {
  return (
    <Notice
      tone={kind === "offline" ? "info" : "error"}
      title={
        kind === "offline"
          ? "Ohne Verbindung nicht verfügbar"
          : "Die Tagesnotiz konnte nicht geladen werden."
      }
      action={
        <Button
          label={retrying ? "Wird versucht …" : "Erneut versuchen"}
          icon={RotateCcw}
          disabled={retrying}
          onPress={onRetry}
        />
      }
    >
      {kind === "offline" ? OFFLINE_TEXT : "Es wurde nichts verändert."}
    </Notice>
  );
}

/** Tagesnotiz in der Tagesansicht: Vorschau und Weg zum Editor. */
export function DayNoteCard({
  state,
  offline,
  retrying,
  onOpen,
  onRetry,
}: {
  state: DailyNoteState;
  /** Plan stammt aus dem Offline-Speicher: Notizen sind dann nicht verfügbar. */
  offline: boolean;
  retrying?: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  if (offline || state.status === "offline" || state.status === "error") {
    return (
      <View style={styles.block}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Tagesnotiz
        </Text>
        <NoteUnavailable
          kind={offline || state.status === "offline" ? "offline" : "error"}
          retrying={retrying}
          onRetry={onRetry}
        />
      </View>
    );
  }
  const note = state.status === "ready" ? state.note : null;
  return (
    <View
      testID="day-note-card"
      style={[styles.card, { backgroundColor: theme.surface1, borderColor: theme.line }]}
    >
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Tagesnotiz
        </Text>
        {note ? (
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            Gespeichert {formatTime(note.updatedAt)}
          </Text>
        ) : null}
      </View>
      {state.status === "loading" ? (
        <Text style={[styles.meta, { color: theme.textMuted }]}>Wird geladen …</Text>
      ) : note ? (
        <Text numberOfLines={4} style={[styles.preview, { color: theme.text }]}>
          {normalizeNoteContent(note.content)}
        </Text>
      ) : (
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          Noch keine Notiz für diesen Tag.
        </Text>
      )}
      <Button
        label={note ? "Notiz bearbeiten" : "Notiz schreiben"}
        icon={NotebookPen}
        disabled={state.status === "loading"}
        onPress={onOpen}
      />
    </View>
  );
}

/** Kompakter Zugang auf „Jetzt“: eine Zeile, öffnet den Editor. */
export function NoteRow({ state, onOpen }: { state: DailyNoteState; onOpen: () => void }) {
  const theme = useTheme();
  const detail =
    state.status === "ready"
      ? state.note
        ? notePreview(state.note.content)
        : "Noch keine Notiz für heute."
      : state.status === "loading"
        ? "Wird geladen …"
        : state.status === "offline"
          ? "Ohne Verbindung nicht verfügbar."
          : "Konnte nicht geladen werden.";
  return (
    <Pressable
      testID="note-row"
      accessibilityRole="button"
      accessibilityLabel={`Tagesnotiz von heute öffnen. ${detail}`}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.surface2 : theme.surface1,
          borderColor: theme.line,
        },
      ]}
    >
      <NotebookPen color={theme.textMuted} size={20} />
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>Tagesnotiz · heute</Text>
        <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted }]}>
          {detail}
        </Text>
      </View>
      <ChevronRight color={theme.textSubtle} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: 14, borderWidth: 1 },
  head: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: "700" },
  meta: { fontSize: 14 },
  preview: { fontSize: 16, lineHeight: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: "700" },
});

import {
  DAILY_NOTE_MAX_LENGTH,
  DAILY_NOTE_MESSAGES,
  type DailyNoteSaveInput,
  type DailyNoteSaveResult,
  type DailyNoteSnapshot,
  type LocalDate,
  type NoteEditorState,
  type NoteStatusTone,
  canSaveNote,
  countNoteCharacters,
  createNoteEditorState,
  describeNoteStatus,
  isNoteDirty,
  normalizeNoteContent,
  noteEditorReducer,
  prepareNoteSave,
} from "@tagestakt/schedule-schema";
import { useEffect, useReducer } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { spacing, useTheme } from "@/theme";

import { Button } from "./ui";

const NUMBER = new Intl.NumberFormat("de-DE");

export type SaveNote = (input: DailyNoteSaveInput) => Promise<DailyNoteSaveResult>;

/** Hat der Editor ungespeicherte Änderungen (inkl. laufendem Speichern oder Konflikt)? */
export function hasUnsavedNote(state: NoteEditorState): boolean {
  return isNoteDirty(state) || state.status === "saving" || state.status === "conflict";
}

/**
 * Tagesnotiz-Editor der App: reiner Text, ausdrückliches Speichern mit sichtbarem Status.
 * Gleicher Zustandsautomat wie auf der Website – eine ältere Antwort überschreibt nie eine
 * neuere Eingabe, bei Fehlern und Konflikten bleibt der Text erhalten.
 */
export function NoteEditor({
  date,
  dateLabel,
  initialNote,
  save,
  onUnsavedChange,
}: {
  date: LocalDate;
  dateLabel: string;
  initialNote: DailyNoteSnapshot | null;
  save: SaveNote;
  onUnsavedChange?: (unsaved: boolean) => void;
}) {
  const theme = useTheme();
  const [state, dispatch] = useReducer(noteEditorReducer, initialNote, createNoteEditorState);

  useEffect(() => {
    dispatch({ type: "server_update", note: initialNote });
  }, [initialNote]);

  const unsaved = hasUnsavedNote(state);
  useEffect(() => {
    onUnsavedChange?.(unsaved);
  }, [unsaved, onUnsavedChange]);

  async function runSave(from: NoteEditorState) {
    const request = prepareNoteSave(from, date);
    if (!request) return;
    dispatch({
      type: "save_started",
      requestId: request.requestId,
      content: request.input.content,
    });
    try {
      const result = await save(request.input);
      if (result.status === "saved") {
        dispatch({
          type: "save_succeeded",
          requestId: request.requestId,
          note: result.note,
          at: result.at,
        });
      } else if (result.status === "conflict") {
        dispatch({ type: "save_conflict", requestId: request.requestId, latest: result.latest });
      } else {
        dispatch({ type: "save_failed", requestId: request.requestId, message: result.message });
      }
    } catch {
      dispatch({
        type: "save_failed",
        requestId: request.requestId,
        message: DAILY_NOTE_MESSAGES.offline,
      });
    }
  }

  const status = describeNoteStatus(state);
  const count = countNoteCharacters(normalizeNoteContent(state.draft));
  const over = count > DAILY_NOTE_MAX_LENGTH;
  const saving = state.status === "saving";
  const toneColor: Record<NoteStatusTone, string> = {
    neutral: theme.textMuted,
    dirty: theme.warning,
    busy: theme.textMuted,
    success: theme.success,
    error: theme.error,
    warning: theme.warning,
  };

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={[styles.dateLabel, { color: theme.textMuted }]}>{dateLabel}</Text>
        <Text
          style={[styles.count, { color: over ? theme.error : theme.textSubtle }]}
          accessibilityLabel={`${NUMBER.format(count)} von ${NUMBER.format(DAILY_NOTE_MAX_LENGTH)} Zeichen`}
        >
          {NUMBER.format(count)} / {NUMBER.format(DAILY_NOTE_MAX_LENGTH)}
        </Text>
      </View>
      <TextInput
        testID="note-input"
        accessibilityLabel={`Tagesnotiz für ${dateLabel}`}
        accessibilityHint="Reiner Text, höchstens 10 000 Zeichen. Leeren und speichern entfernt die Notiz."
        value={state.draft}
        onChangeText={(text) => dispatch({ type: "edit", text })}
        placeholder="Was ist an diesem Tag wichtig? Nur für dich sichtbar."
        placeholderTextColor={theme.textSubtle}
        multiline
        scrollEnabled
        textAlignVertical="top"
        autoCorrect
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.surface2,
            borderColor: status.tone === "error" ? theme.error : theme.lineStrong,
          },
        ]}
      />
      <View style={styles.foot}>
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={
            status.tone === "error" || status.tone === "warning" ? "alert" : "text"
          }
          style={[
            styles.status,
            {
              color: toneColor[status.tone],
              fontWeight: status.tone === "error" || status.tone === "warning" ? "700" : "500",
            },
          ]}
        >
          {status.text}
        </Text>
        {state.status === "conflict" ? (
          <View style={styles.buttons}>
            <Text style={[styles.conflictLabel, { color: theme.textMuted }]}>
              {state.conflict
                ? "Andere gespeicherte Fassung:"
                : "Die Notiz wurde andernorts entfernt."}
            </Text>
            {state.conflict ? (
              <Text
                testID="note-conflict"
                numberOfLines={8}
                style={[
                  styles.conflictText,
                  {
                    color: theme.text,
                    borderColor: theme.lineStrong,
                    backgroundColor: theme.surface2,
                  },
                ]}
              >
                {state.conflict.content}
              </Text>
            ) : null}
            <Button
              label="Meine Fassung speichern"
              variant="primary"
              size="lg"
              onPress={() => {
                const next = noteEditorReducer(state, { type: "keep_mine" });
                dispatch({ type: "keep_mine" });
                void runSave(next);
              }}
            />
            <Button
              label="Gespeicherte Fassung laden"
              onPress={() => dispatch({ type: "use_latest" })}
            />
          </View>
        ) : (
          <Button
            label={
              saving
                ? "Wird gespeichert …"
                : state.status === "error"
                  ? "Erneut speichern"
                  : "Speichern"
            }
            variant={state.status === "error" || isNoteDirty(state) ? "primary" : "secondary"}
            size="lg"
            disabled={!canSaveNote(state)}
            onPress={() => void runSave(state)}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.md },
  head: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  dateLabel: { fontSize: 15, fontWeight: "600" },
  count: { fontSize: 13, fontVariant: ["tabular-nums"] },
  input: {
    flex: 1,
    minHeight: 160,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: 16,
    lineHeight: 24,
  },
  foot: { gap: spacing.sm },
  status: { fontSize: 15 },
  buttons: { gap: spacing.sm },
  conflictLabel: { fontSize: 14, fontWeight: "600" },
  conflictText: {
    fontSize: 15,
    lineHeight: 22,
    padding: spacing.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
  },
});

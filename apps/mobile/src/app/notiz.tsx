import { formatLocalDateLong, isValidLocalDate, toLocalDate } from "@tagestakt/schedule-schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { NoteEditor } from "@/components/note-editor";
import { NoteUnavailable } from "@/components/note-card";
import { StackHeader } from "@/components/stack-header";
import { useDailyNote } from "@/hooks/use-daily-note";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { spacing, useTheme } from "@/theme";

/** Tagesnotiz bearbeiten (eigener Bildschirm, damit die Tastatur genug Platz lässt). */
export default function NoteScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const params = useLocalSearchParams<{ date?: string }>();
  const date =
    typeof params.date === "string" && isValidLocalDate(params.date)
      ? params.date
      : toLocalDate(new Date());
  const dateLabel = formatLocalDateLong(date);
  const { state, save, refetch, isFetching } = useDailyNote(date);
  const [unsaved, setUnsaved] = useState(false);

  const leave = useCallback(() => {
    const back = () => (router.canGoBack() ? router.back() : router.replace("/tag"));
    if (!unsaved) {
      back();
      return;
    }
    Alert.alert("Notiz nicht gespeichert", "Deine Änderungen gehen beim Verlassen verloren.", [
      { text: "Weiter bearbeiten", style: "cancel" },
      { text: "Verwerfen", style: "destructive", onPress: back },
    ]);
  }, [router, unsaved]);

  // Android-Zurück-Taste: gleiche Rückfrage wie „Zurück“ im Kopf.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!unsaved) return false;
      leave();
      return true;
    });
    return () => subscription.remove();
  }, [leave, unsaved]);

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.bg }]}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        testID="note-screen-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(keyboard, insets.bottom) + spacing.lg },
        ]}
      >
        <StackHeader title="Tagesnotiz" subtitle={dateLabel} onBack={leave} />
        {state.status === "ready" ? (
          <View style={styles.editor}>
            <NoteEditor
              key={date}
              date={date}
              dateLabel={dateLabel}
              initialNote={state.note}
              save={save}
              onUnsavedChange={setUnsaved}
            />
          </View>
        ) : state.status === "loading" ? (
          <ActivityIndicator color={theme.text} accessibilityLabel="Tagesnotiz wird geladen" />
        ) : (
          <NoteUnavailable
            kind={state.status}
            retrying={isFetching}
            onRetry={() => void refetch()}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl - 4,
    paddingTop: spacing.sm,
    gap: spacing.xl,
  },
  editor: { flexGrow: 1, minHeight: 280 },
});

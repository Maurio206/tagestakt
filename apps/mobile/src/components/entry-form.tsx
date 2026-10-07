import {
  CATEGORY_LABELS,
  ENTRY_CATEGORIES,
  type EntryCategory,
  type LocalDate,
  type ScheduleEntry,
  WEEKDAY_SHORT_LABELS,
  formatLocalDateShort,
  getWeekDays,
  isoWeekdayOfLocalDate,
  normalizeTimeOfDay,
  toLocalDate,
  toLocalTime,
} from "@tagestakt/schedule-schema";
import { Check, Trash } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { type EntryFormErrors } from "@/lib/plan-edit-api";
import { spacing, useTheme } from "@/theme";

import { Button, ChoiceChips, SwitchRow } from "./ui";

export interface EntryFormValues {
  title: string;
  category: EntryCategory;
  date: LocalDate;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  location: string;
  note: string;
}

export function entryFormDefaults(entry: ScheduleEntry | null, date: LocalDate): EntryFormValues {
  if (!entry) {
    return {
      title: "",
      category: "business",
      date,
      startTime: "09:00",
      endTime: "10:00",
      endsNextDay: false,
      location: "",
      note: "",
    };
  }
  const start = new Date(entry.start_at);
  const end = new Date(entry.end_at);
  return {
    title: entry.title,
    category: entry.category,
    date: toLocalDate(start),
    startTime: toLocalTime(start),
    endTime: toLocalTime(end),
    endsNextDay: toLocalDate(end) !== toLocalDate(start),
    location: entry.location ?? "",
    note: entry.note ?? "",
  };
}

function normalizeOrKeep(value: string): string {
  try {
    return normalizeTimeOfDay(value.trim());
  } catch {
    return value;
  }
}

function Field({
  label,
  value,
  onChange,
  error,
  placeholder,
  multiline,
  keyboardType,
  onBlur,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numbers-and-punctuation";
  onBlur?: () => void;
  maxLength?: number;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={theme.textSubtle}
        multiline={multiline}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCorrect={!keyboardType}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          {
            color: theme.text,
            backgroundColor: theme.surface2,
            borderColor: error ? theme.error : theme.lineStrong,
          },
        ]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Formular für einen Planblock im Entwurf (Prüfung mit dem gemeinsamen Zod-Schema). */
export function EntryForm({
  weekStart,
  initial,
  errors,
  pending,
  onSubmit,
  onDelete,
}: {
  weekStart: LocalDate;
  initial: EntryFormValues;
  errors: EntryFormErrors;
  pending: boolean;
  onSubmit: (values: EntryFormValues) => void;
  onDelete?: () => void;
}) {
  const theme = useTheme();
  const [values, setValues] = useState(initial);
  const set = <K extends keyof EntryFormValues>(key: K, value: EntryFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <View style={styles.form}>
      <Field
        label="Titel"
        value={values.title}
        onChange={(v) => set("title", v)}
        error={errors.title}
        placeholder="z. B. Angebote schreiben (Beispiel)"
        maxLength={120}
      />
      <ChoiceChips
        label="Kategorie"
        options={ENTRY_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
        value={values.category}
        onChange={(v) => set("category", v)}
      />
      <ChoiceChips
        label="Tag"
        options={getWeekDays(weekStart).map((value) => ({
          value,
          label: `${WEEKDAY_SHORT_LABELS[isoWeekdayOfLocalDate(value)]} ${formatLocalDateShort(value)}`,
        }))}
        value={values.date}
        onChange={(v) => set("date", v)}
      />
      <View style={styles.times}>
        <View style={styles.flex}>
          <Field
            label="Beginn"
            value={values.startTime}
            onChange={(v) => set("startTime", v)}
            onBlur={() => set("startTime", normalizeOrKeep(values.startTime))}
            error={errors.startTime}
            placeholder="09:00"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>
        <View style={styles.flex}>
          <Field
            label="Ende"
            value={values.endTime}
            onChange={(v) => set("endTime", v)}
            onBlur={() => set("endTime", normalizeOrKeep(values.endTime))}
            error={errors.endTime}
            placeholder="10:00"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>
      </View>
      <SwitchRow
        label="Endet am Folgetag"
        hint="z. B. Schlaf 22:30–06:30"
        value={values.endsNextDay}
        onChange={(v) => set("endsNextDay", v)}
      />
      <Field
        label="Ort (optional)"
        value={values.location}
        onChange={(v) => set("location", v)}
        error={errors.location}
      />
      <Field
        label="Notiz (optional)"
        value={values.note}
        onChange={(v) => set("note", v)}
        error={errors.note}
        multiline
      />
      {errors.form || errors.date ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>
          {errors.form ?? errors.date}
        </Text>
      ) : null}
      <Button
        label={pending ? "Speichere …" : "Im Entwurf speichern"}
        icon={Check}
        variant="primary"
        size="lg"
        disabled={pending}
        onPress={() =>
          onSubmit({
            ...values,
            startTime: normalizeOrKeep(values.startTime),
            endTime: normalizeOrKeep(values.endTime),
          })
        }
      />
      {onDelete ? (
        <Button
          label="Block löschen"
          icon={Trash}
          variant="danger"
          disabled={pending}
          onPress={onDelete}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  multiline: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: "top" },
  error: { fontSize: 13, fontWeight: "600" },
  times: { flexDirection: "row", gap: spacing.md },
  flex: { flex: 1 },
});

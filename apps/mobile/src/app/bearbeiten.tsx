import {
  type LocalDate,
  type ScheduleEntry,
  WEEKDAY_LABELS,
  detectOverlaps,
  formatLocalDateShort,
  formatTimeRange,
  formatWeekLabel,
  getWeekStart,
  groupEntriesByDay,
  isMonday,
  isoWeekdayOfLocalDate,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CopyPlus, Plus, Send } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/auth/auth-context";
import { EntryForm, type EntryFormValues, entryFormDefaults } from "@/components/entry-form";
import { PlanError } from "@/components/plan-error";
import { Screen } from "@/components/screen";
import { Sheet } from "@/components/sheet";
import { StackHeader } from "@/components/stack-header";
import { Button, CategoryPill, Muted, Notice, Section } from "@/components/ui";
import { usePlan } from "@/hooks/use-plan";
import {
  type EntryFormErrors,
  createDraft,
  deleteEntry,
  getWeekWithEntries,
  listWeekVersions,
  publishDraft,
  saveEntry,
  validateEntry,
} from "@/lib/plan-edit-api";
import { OFFLINE_MESSAGE, toWriteError } from "@/lib/write-errors";
import { spacing, useTheme } from "@/theme";

type Editing = { entry: ScheduleEntry | null; date: LocalDate } | null;

/**
 * „Plan bearbeiten“: Änderungen ausschließlich in einem Entwurf. Die veröffentlichte Version
 * bleibt gültig, bis der Entwurf ausdrücklich veröffentlicht wird. Ohne Verbindung ist der
 * Modus gesperrt – Entwürfe werden weder offline gespeichert noch vorgemerkt.
 */
export default function EditScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { supabase } = useAuth();
  const params = useLocalSearchParams<{ week?: string }>();
  const weekStart =
    typeof params.week === "string" && isMonday(params.week)
      ? params.week
      : getWeekStart(new Date());
  const { result } = usePlan();
  const online = result?.origin === "network";

  const versions = useQuery({
    queryKey: ["edit", weekStart, "versions"],
    queryFn: () => listWeekVersions(supabase, weekStart),
    enabled: online,
    retry: 0,
  });
  const draftMeta = versions.data?.find((v) => v.status === "draft");
  const published = versions.data?.find((v) => v.status === "published");
  const draft = useQuery({
    queryKey: ["edit", weekStart, "draft", draftMeta?.id],
    queryFn: () => getWeekWithEntries(supabase, draftMeta?.id ?? ""),
    enabled: online && Boolean(draftMeta),
    retry: 0,
  });

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [formErrors, setFormErrors] = useState<EntryFormErrors>({});

  const run = useCallback(
    async (operation: () => Promise<unknown>): Promise<boolean> => {
      if (!online) {
        setError(OFFLINE_MESSAGE);
        return false;
      }
      setPending(true);
      setError(null);
      try {
        await operation();
        return true;
      } catch (cause) {
        setError(toWriteError(cause).message);
        return false;
      } finally {
        setPending(false);
        await queryClient.invalidateQueries({ queryKey: ["edit", weekStart] });
      }
    },
    [online, queryClient, weekStart],
  );

  const week = draft.data;
  const entries = week?.schedule_entries ?? [];
  const overlaps = detectOverlaps(entries);
  const overlapIds = new Set(overlaps.flatMap((o) => [o.first.id, o.second.id]));

  const confirmCreate = () => {
    const next = (versions.data?.[0]?.version ?? 0) + 1;
    Alert.alert(
      `Version ${next} anlegen?`,
      published
        ? `Der Entwurf startet als Kopie von Version ${published.version}. Version ${published.version} bleibt gültig, bis du veröffentlichst.`
        : "Der Entwurf startet leer. Sichtbar wird er erst nach dem Veröffentlichen.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Anlegen", onPress: () => void run(() => createDraft(supabase, weekStart)) },
      ],
    );
  };

  const submit = async (values: EntryFormValues) => {
    if (!week || !editing) return;
    const checked = validateEntry(week, values);
    if (!checked.ok) {
      setFormErrors(checked.errors);
      return;
    }
    setFormErrors({});
    const ok = await run(() => saveEntry(supabase, week, checked.columns, editing.entry?.id));
    if (ok) setEditing(null);
  };

  const confirmDelete = (entry: ScheduleEntry) => {
    Alert.alert("Block löschen?", `„${entry.title}“ wird aus dem Entwurf entfernt.`, [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: () =>
          void run(() => deleteEntry(supabase, entry.id)).then((ok) => {
            if (ok) setEditing(null);
          }),
      },
    ]);
  };

  const confirmPublish = () => {
    if (!week) return;
    const replaces = published
      ? ` Sie ersetzt Version ${published.version} auf allen Geräten.`
      : "";
    const warn =
      overlaps.length > 0
        ? `\n\n${overlaps.length === 1 ? "1 Überschneidung" : `${overlaps.length} Überschneidungen`} – sie bleiben als Hinweis sichtbar.`
        : "";
    Alert.alert(
      `Version ${week.version} veröffentlichen?`,
      `${entries.length} Blöcke.${replaces}${warn}`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Veröffentlichen",
          onPress: () =>
            void run(() => publishDraft(supabase, week.id)).then(async (ok) => {
              if (!ok) return;
              await queryClient.invalidateQueries({ queryKey: ["plan"] });
              router.back();
            }),
        },
      ],
    );
  };

  const header = <StackHeader title="Plan bearbeiten" subtitle={formatWeekLabel(weekStart)} />;

  if (!online) {
    return (
      <Screen>
        {header}
        <Notice tone="warning" title="Bearbeiten nur mit Verbindung">
          Ohne Verbindung werden keine Änderungen angenommen oder vorgemerkt. Der veröffentlichte
          Plan bleibt offline lesbar.
        </Notice>
      </Screen>
    );
  }

  if (versions.isLoading || (draftMeta && draft.isLoading)) {
    return (
      <Screen>
        {header}
        <ActivityIndicator color={theme.text} accessibilityLabel="Entwurf wird geladen" />
      </Screen>
    );
  }

  if (versions.error || draft.error) {
    return (
      <Screen>
        {header}
        <PlanError
          message={toWriteError(versions.error ?? draft.error).message}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: ["edit", weekStart] })}
        />
      </Screen>
    );
  }

  const today = toLocalDate(new Date());
  const defaultDate = today >= weekStart && getWeekStart(today) === weekStart ? today : weekStart;

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      footer={
        week ? (
          <View style={[styles.footer, { borderTopColor: theme.line, backgroundColor: theme.bg }]}>
            <Button
              label={`Version ${week.version} veröffentlichen`}
              icon={Send}
              variant="primary"
              size="lg"
              disabled={pending}
              onPress={confirmPublish}
            />
          </View>
        ) : undefined
      }
    >
      {header}
      <Muted small>
        {published
          ? `Veröffentlicht: Version ${published.version}`
          : "Noch keine Version veröffentlicht"}
        {week ? ` · Entwurf: Version ${week.version}` : ""}
      </Muted>
      {error ? (
        <Notice tone="error" title="Nicht gespeichert">
          {error}
        </Notice>
      ) : null}

      {!week ? (
        <>
          <Notice tone="info" title="Änderungen entstehen in einer neuen Version.">
            Die veröffentlichte Version bleibt gültig, bis du den Entwurf veröffentlichst.
          </Notice>
          <Button
            label="Neue Version anlegen"
            icon={CopyPlus}
            variant="primary"
            size="lg"
            disabled={pending}
            onPress={confirmCreate}
          />
        </>
      ) : (
        <>
          {overlaps.length > 0 ? (
            <Notice
              tone="warning"
              title={
                overlaps.length === 1 ? "1 Überschneidung" : `${overlaps.length} Überschneidungen`
              }
            >
              Überschneidungen sind erlaubt und werden nur markiert.
            </Notice>
          ) : null}
          <Button
            label="Block hinzufügen"
            icon={Plus}
            disabled={pending}
            onPress={() => {
              setFormErrors({});
              setEditing({ entry: null, date: defaultDate });
            }}
          />
          {groupEntriesByDay(entries, weekStart).map((day) => (
            <Section
              key={day.date}
              title={`${WEEKDAY_LABELS[isoWeekdayOfLocalDate(day.date)]} ${formatLocalDateShort(day.date)}`}
            >
              {day.entries.length === 0 ? (
                <Muted small>Nichts geplant.</Muted>
              ) : (
                day.entries.map((entry) => (
                  <Pressable
                    key={`${day.date}-${entry.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatTimeRange(entry.start_at, entry.end_at)}, ${entry.title}${overlapIds.has(entry.id) ? ", Überschneidung" : ""}`}
                    accessibilityHint="Block bearbeiten"
                    onPress={() => {
                      setFormErrors({});
                      setEditing({ entry, date: day.date });
                    }}
                    style={({ pressed }) => [
                      styles.entry,
                      {
                        backgroundColor: pressed ? theme.surface2 : theme.surface1,
                        borderColor: overlapIds.has(entry.id) ? theme.warning : theme.line,
                      },
                    ]}
                  >
                    <Text style={[styles.time, { color: theme.textMuted }]}>
                      {formatTimeRange(entry.start_at, entry.end_at)}
                    </Text>
                    <Text style={[styles.title, { color: theme.text }]}>{entry.title}</Text>
                    <View style={styles.meta}>
                      <CategoryPill category={entry.category} />
                      {overlapIds.has(entry.id) ? (
                        <Text style={[styles.overlap, { color: theme.warning }]}>
                          Überschneidung
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))
              )}
            </Section>
          ))}
        </>
      )}

      <Sheet
        visible={editing !== null}
        title={editing?.entry ? "Block bearbeiten" : "Block hinzufügen"}
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <EntryForm
            key={editing.entry?.id ?? "neu"}
            weekStart={weekStart}
            initial={entryFormDefaults(editing.entry, editing.date)}
            errors={formErrors}
            pending={pending}
            onSubmit={(values) => void submit(values)}
            onDelete={
              editing.entry ? () => editing.entry && confirmDelete(editing.entry) : undefined
            }
          />
        ) : null}
        {error && editing ? (
          <Notice tone="error" title="Nicht gespeichert">
            {error}
          </Notice>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  entry: { borderWidth: 1, borderRadius: 14, padding: spacing.md, gap: spacing.xs, minHeight: 56 },
  time: { fontSize: 13, fontVariant: ["tabular-nums"] },
  title: { fontSize: 16, fontWeight: "700" },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  overlap: { fontSize: 12, fontWeight: "700" },
});

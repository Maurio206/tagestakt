import {
  SCHEDULE_TIMEZONE,
  formatLocalDateLong,
  formatTime,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { useRouter } from "expo-router";
import {
  ChartColumn,
  ChevronRight,
  LogOut,
  type LucideIcon,
  RefreshCw,
  Target,
} from "lucide-react-native";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/auth/auth-context";
import { AppLockSettings } from "@/components/app-lock-settings";
import { GoalSettings } from "@/components/goal-settings";
import { ReminderSettingsPanel } from "@/components/reminder-settings";
import { Screen } from "@/components/screen";
import { RunningTimerBar } from "@/components/timer-bar";
import { Body, Button, Muted, Section, Surface, Title } from "@/components/ui";
import { usePlan } from "@/hooks/use-plan";
import { spacing, useTheme } from "@/theme";

function NavRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        { backgroundColor: pressed ? theme.surface2 : "transparent" },
      ]}
    >
      <Icon color={theme.textMuted} size={20} />
      <Text style={[styles.navText, { color: theme.text }]}>{label}</Text>
      <ChevronRight color={theme.textSubtle} size={20} />
    </Pressable>
  );
}

export default function MoreScreen() {
  const { session, signOut } = useAuth();
  const { result, isFetching, refetch } = usePlan();
  const router = useRouter();
  const theme = useTheme();
  const canWrite = result?.origin === "network";

  const lastSync = result?.snapshot.fetchedAt;
  const lastSyncText = lastSync
    ? `${formatLocalDateLong(toLocalDate(new Date(lastSync)))}, ${formatTime(lastSync)} Uhr`
    : "noch nie";

  const confirmLogout = () => {
    Alert.alert(
      "Abmelden?",
      "Die Sitzung, der lokal gespeicherte Plan, die geplanten Erinnerungen und die Geräteeinstellungen werden von diesem Gerät gelöscht.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Abmelden", style: "destructive", onPress: () => void signOut() },
      ],
    );
  };

  return (
    <Screen footer={<RunningTimerBar />}>
      <Title>Mehr</Title>

      <Surface>
        <NavRow icon={Target} label="Ziele und Fortschritt" onPress={() => router.push("/ziele")} />
        <View style={[styles.rule, { backgroundColor: theme.line }]} />
        <NavRow
          icon={ChartColumn}
          label="Wochenbilanz"
          onPress={() => router.push("/wochenbilanz")}
        />
      </Surface>

      <Section title="Wochenziele">
        {result ? (
          <GoalSettings targets={result.snapshot.goalTargets} canWrite={canWrite} />
        ) : (
          <Muted>Die Ziele werden geladen, sobald der Plan verfügbar ist.</Muted>
        )}
        {result && !canWrite ? <Muted small>Ändern ist nur mit Verbindung möglich.</Muted> : null}
      </Section>

      <Section title="Erinnerungen">
        {result ? (
          <ReminderSettingsPanel server={result.snapshot.reminderSettings} canWrite={canWrite} />
        ) : (
          <Muted>Die Erinnerungen werden geladen, sobald der Plan verfügbar ist.</Muted>
        )}
      </Section>

      <Section title="App-Sperre">
        <AppLockSettings />
      </Section>

      <Section title="Synchronisierung">
        <Body>Letzte erfolgreiche Synchronisierung: {lastSyncText}</Body>
        {result?.origin === "cache" ? (
          <Muted small>Aktuell wird der gespeicherte Plan angezeigt (offline).</Muted>
        ) : null}
        <Button
          label={isFetching ? "Synchronisiere …" : "Jetzt synchronisieren"}
          icon={RefreshCw}
          onPress={() => void refetch()}
          disabled={isFetching}
        />
      </Section>

      <Section title="Konto">
        <Body>Angemeldet als {session?.user.email ?? "unbekannt"}</Body>
        <Muted small>Zeitzone: {result?.snapshot.timezone ?? SCHEDULE_TIMEZONE}</Muted>
        <Button label="Abmelden" icon={LogOut} variant="danger" onPress={confirmLogout} />
      </Section>

      <Section title="Datenschutz auf diesem Gerät">
        <Muted small>
          Anmeldedaten und Geräteeinstellungen liegen verschlüsselt im sicheren Speicher des Geräts
          (Android Keystore). Der zuletzt geladene veröffentlichte Plan wird für die Offline-Anzeige
          im geschützten App-Speicher abgelegt. Erinnerungen werden nur lokal geplant. Beim Abmelden
          wird alles davon gelöscht. Keine Analyse, keine Werbung, keine Weitergabe an Dritte.
        </Muted>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
  },
  navText: { flex: 1, fontSize: 16, fontWeight: "600" },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg },
});

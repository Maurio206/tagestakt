import {
  SCHEDULE_TIMEZONE,
  formatLocalDateLong,
  formatTime,
  toLocalDate,
} from "@tagestakt/schedule-schema";
import { Alert, Text } from "react-native";

import { useAuth } from "@/auth/auth-context";
import { Screen } from "@/components/screen";
import { Body, Button, Card, Eyebrow, Muted } from "@/components/ui";
import { usePlan } from "@/hooks/use-plan";
import { useTheme } from "@/theme";

export default function SettingsScreen() {
  const { session, signOut } = useAuth();
  const { result, isFetching, refetch } = usePlan();
  const theme = useTheme();

  const lastSync = result?.snapshot.fetchedAt;
  const lastSyncText = lastSync
    ? `${formatLocalDateLong(toLocalDate(new Date(lastSync)))}, ${formatTime(lastSync)} Uhr`
    : "noch nie";

  const confirmLogout = () => {
    Alert.alert(
      "Abmelden?",
      "Die Sitzung und der lokal gespeicherte Plan werden von diesem Gerät gelöscht.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Abmelden", style: "destructive", onPress: () => void signOut() },
      ],
    );
  };

  return (
    <Screen>
      <Text
        accessibilityRole="header"
        style={{ color: theme.text, fontSize: 26, fontWeight: "800" }}
      >
        Einstellungen
      </Text>
      <Card>
        <Eyebrow>Synchronisierung</Eyebrow>
        <Body>Letzte erfolgreiche Synchronisierung: {lastSyncText}</Body>
        {result?.origin === "cache" ? (
          <Muted>Aktuell wird der gespeicherte Plan angezeigt (offline).</Muted>
        ) : null}
        <Button
          label={isFetching ? "Synchronisiere …" : "Jetzt synchronisieren"}
          onPress={() => void refetch()}
          disabled={isFetching}
        />
      </Card>

      <Card>
        <Eyebrow>Konto</Eyebrow>
        <Body>Angemeldet als {session?.user.email ?? "unbekannt"}</Body>
        <Muted>Zeitzone: {result?.snapshot.timezone ?? SCHEDULE_TIMEZONE}</Muted>
        <Button label="Abmelden" variant="danger" onPress={confirmLogout} />
      </Card>

      <Card>
        <Eyebrow>Datenschutz auf diesem Gerät</Eyebrow>
        <Muted>
          Anmeldedaten liegen verschlüsselt im sicheren Speicher des Geräts (Android Keystore). Der
          zuletzt geladene veröffentlichte Wochenplan wird für die Offline-Anzeige im geschützten
          App-Speicher abgelegt und beim Abmelden gelöscht.
        </Muted>
      </Card>
    </Screen>
  );
}

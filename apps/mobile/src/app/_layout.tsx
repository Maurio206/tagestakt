import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/auth/auth-context";
import { AppLockGate } from "@/components/app-lock";
import { DeviceSettingsProvider } from "@/hooks/device-settings";
import { readMobileEnv } from "@/lib/env";
import { spacing, useTheme } from "@/theme";

const envResult = readMobileEnv();

/** Dienste, die nur mit gültiger Sitzung laufen: Geräteeinstellungen und App-Sperre. */
function SessionServices({
  userId,
  onSignOut,
  children,
}: {
  userId: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <DeviceSettingsProvider key={userId}>
      <AppLockGate onSignOut={onSignOut}>{children}</AppLockGate>
    </DeviceSettingsProvider>
  );
}

function RootNavigator() {
  const { session, initializing, signOut } = useAuth();
  const theme = useTheme();

  if (initializing) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.text} accessibilityLabel="Wird geladen" />
      </View>
    );
  }

  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      {/* Ohne gültige Session ist ausschließlich die Anmeldung erreichbar. */}
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="ziele" />
        <Stack.Screen name="wochenbilanz" />
        <Stack.Screen name="bearbeiten" />
        <Stack.Screen name="korrigieren" options={{ presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );

  return session ? (
    <SessionServices userId={session.user.id} onSignOut={() => void signOut()}>
      {stack}
    </SessionServices>
  ) : (
    stack
  );
}

function ConfigError({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.bg }]}>
      <Text style={[styles.title, { color: theme.text }]}>Konfiguration fehlt</Text>
      <Text style={{ color: theme.textMuted }}>{message}</Text>
      <Text style={{ color: theme.textMuted }}>
        Siehe apps/mobile/.env.example und docs/setup.md.
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const theme = useTheme();
  const [queryClient] = useState(() => new QueryClient());

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      {envResult.ok ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider env={envResult.env}>
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      ) : (
        <ConfigError message={envResult.message} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { fontSize: 22, fontWeight: "700" },
});

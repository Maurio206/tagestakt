import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/auth/auth-context";
import { readMobileEnv } from "@/lib/env";
import { spacing, useTheme } from "@/theme";

const envResult = readMobileEnv();

function RootNavigator() {
  const { session, initializing } = useAuth();
  const theme = useTheme();

  if (initializing) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} accessibilityLabel="Wird geladen" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}
    >
      {/* Ohne gültige Session ist ausschließlich die Anmeldung erreichbar. */}
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

function ConfigError({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.background }]}>
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
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
});

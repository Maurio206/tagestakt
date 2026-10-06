import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { spacing, useTheme } from "@/theme";

import { Button, Muted } from "./ui";

/** Anmeldung mit E-Mail und Passwort. Bewusst ohne Registrierung. */
export function LoginView({
  onSubmit,
}: {
  onSubmit: (email: string, password: string) => Promise<string | null>;
}) {
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Bitte E-Mail und Passwort eingeben.");
      return;
    }
    setPending(true);
    setError(null);
    const message = await onSubmit(email, password);
    setPending(false);
    if (message) setError(message);
  };

  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface },
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <View style={styles.form}>
        <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
          TagesTakt
        </Text>
        <Muted>Privater Zugang. Eine Registrierung ist nicht möglich.</Muted>

        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        <Text style={[styles.label, { color: theme.text }]} nativeID="login-email">
          E-Mail
        </Text>
        <TextInput
          accessibilityLabel="E-Mail"
          accessibilityLabelledBy="login-email"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          inputMode="email"
          keyboardType="email-address"
          textContentType="username"
          value={email}
          onChangeText={setEmail}
          style={inputStyle}
        />

        <Text style={[styles.label, { color: theme.text }]} nativeID="login-password">
          Passwort
        </Text>
        <TextInput
          accessibilityLabel="Passwort"
          accessibilityLabelledBy="login-password"
          autoCapitalize="none"
          autoComplete="current-password"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          style={inputStyle}
        />

        {pending ? (
          <ActivityIndicator color={theme.accent} accessibilityLabel="Anmeldung läuft" />
        ) : null}
        <Button label="Anmelden" onPress={() => void submit()} disabled={pending} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  form: {
    gap: spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    fontSize: 17,
  },
  error: {
    fontSize: 16,
    fontWeight: "600",
  },
});

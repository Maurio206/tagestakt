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

import { LogIn } from "lucide-react-native";

import { spacing, type, useTheme } from "@/theme";

import { BrandMark } from "./brand";
import { Button, Muted, Notice } from "./ui";

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
    { color: theme.text, borderColor: theme.lineStrong, backgroundColor: theme.surface2 },
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: theme.bg }]}
    >
      <View style={styles.form}>
        <View style={styles.brand}>
          <BrandMark size={44} />
          <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
            TagesTakt
          </Text>
        </View>
        <Muted>Privater Zugang. Eine Registrierung ist nicht möglich.</Muted>

        {error ? <Notice tone="error" title={error} /> : null}

        <Text style={[styles.label, { color: theme.textMuted }]} nativeID="login-email">
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

        <Text style={[styles.label, { color: theme.textMuted }]} nativeID="login-password">
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
          <ActivityIndicator color={theme.text} accessibilityLabel="Anmeldung läuft" />
        ) : null}
        <Button
          label="Anmelden"
          icon={LogIn}
          variant="primary"
          size="lg"
          onPress={() => void submit()}
          disabled={pending}
        />
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
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  title: { ...type.pageTitle, fontWeight: "700" },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    fontSize: 17,
  },
});

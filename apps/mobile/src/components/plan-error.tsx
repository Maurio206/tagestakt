import { RefreshCw } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { spacing } from "@/theme";

import { Button, Notice } from "./ui";

/** Fehlerzustand ohne gespeicherten Plan: Ursache in Alltagssprache und „Erneut versuchen“. */
export function PlanError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <View style={styles.container}>
      <Notice tone="error" title="Kein Plan verfügbar">
        {`${message ?? "Der Plan konnte nicht geladen werden."} Auf diesem Gerät ist noch kein Plan gespeichert – bitte Verbindung prüfen.`}
      </Notice>
      <Button label="Erneut versuchen" icon={RefreshCw} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
});

import { categoryTone } from "@tagestakt/design-tokens";
import { CATEGORY_LABELS, type EntryCategory } from "@tagestakt/schedule-schema";
import {
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
  Info,
  CircleCheck,
} from "lucide-react-native";
import { type ReactNode, createContext, useContext } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { type Theme, radius, spacing, tint, touch, type, useTheme } from "@/theme";

import { ToneIcon } from "./icons";

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function Title({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
      {children}
    </Text>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.section, { color: theme.textSubtle }]}>
      {children}
    </Text>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.eyebrow, { color: theme.textSubtle }]}>{children}</Text>;
}

export function Body({
  children,
  bold,
  style,
}: {
  children: ReactNode;
  bold?: boolean;
  style?: TextStyle;
}) {
  const theme = useTheme();
  return (
    <Text style={[styles.body, { color: theme.text }, bold ? styles.bold : null, style]}>
      {children}
    </Text>
  );
}

export function Muted({ children, small }: { children: ReactNode; small?: boolean }) {
  const theme = useTheme();
  return (
    <Text style={[small ? styles.small : styles.body, { color: theme.textMuted }]}>{children}</Text>
  );
}

export function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.line }]} />;
}

// ---------------------------------------------------------------------------
// Flächen
// ---------------------------------------------------------------------------

/** Fläche nur für bedienbare Einheiten (Listen, Sheets) – sonst Linien statt Karten. */
export function Surface({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.surface, { backgroundColor: theme.surface1, borderColor: theme.line }, style]}
    >
      {children}
    </View>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHead}>
        <SectionTitle>{title}</SectionTitle>
        {action}
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Kategoriegetönte Fläche (Fokusblock)
// ---------------------------------------------------------------------------

const TintedSurfaceContext = createContext(false);

/**
 * Inhalt auf einer kategoriegetönten Fläche: Chips stehen dort auf surface1 und Knopfränder
 * nutzen textSubtle statt lineStrong, damit die Kontraste wie auf surface1 erhalten bleiben.
 */
export function TintedSurface({ tinted, children }: { tinted: boolean; children: ReactNode }) {
  return <TintedSurfaceContext.Provider value={tinted}>{children}</TintedSurfaceContext.Provider>;
}

export function useOnTint(): boolean {
  return useContext(TintedSurfaceContext);
}

// ---------------------------------------------------------------------------
// Kategorie und Ziel
// ---------------------------------------------------------------------------

/** Kategorie als Text mit Symbol in zurückhaltender Farbe (Farbe nie alleiniger Träger). */
export function CategoryPill({ category }: { category: EntryCategory }) {
  const theme = useTheme();
  const tone = categoryTone[category];
  return (
    <View
      style={styles.pill}
      accessible
      accessibilityLabel={`Kategorie ${CATEGORY_LABELS[category]}`}
    >
      <ToneIcon tone={tone} color={theme[tone]} size={16} />
      <Text style={[styles.small, { color: theme.textMuted }]}>{CATEGORY_LABELS[category]}</Text>
    </View>
  );
}

/** Getönter Chip mit Zielsymbol und Text, z. B. „Gewerbe · Läuft“. */
export function ToneChip({ category, label }: { category: EntryCategory; label: string }) {
  const theme = useTheme();
  const onTint = useOnTint();
  const color = theme[categoryTone[category]];
  return (
    <View
      testID="tone-chip"
      style={[styles.chip, { backgroundColor: onTint ? theme.surface1 : tint(color, 0.14) }]}
    >
      <ToneIcon tone={categoryTone[category]} color={color} size={16} />
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Knöpfe und Eingaben
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

function buttonColors(theme: Theme, variant: ButtonVariant, onTint: boolean) {
  switch (variant) {
    case "primary":
      return { bg: theme.inverse, border: theme.inverse, text: theme.onInverse };
    case "danger":
      return { bg: "transparent", border: tint(theme.error, 0.55), text: theme.error };
    case "ghost":
      return { bg: "transparent", border: "transparent", text: theme.text };
    default:
      return {
        bg: theme.surface2,
        border: onTint ? theme.textSubtle : theme.lineStrong,
        text: theme.text,
      };
  }
}

export function Button({
  label,
  onPress,
  variant = "secondary",
  size = "md",
  icon: Icon,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  flex,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: "md" | "lg";
  icon?: LucideIcon;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  flex?: boolean;
}) {
  const theme = useTheme();
  const onTint = useOnTint();
  const colors = buttonColors(theme, variant, onTint);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === "lg" ? styles.buttonLg : null,
        flex ? styles.flex : null,
        {
          backgroundColor: pressed && !disabled ? theme.surface3 : colors.bg,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {Icon ? <Icon color={colors.text} size={size === "lg" ? 20 : 18} strokeWidth={2} /> : null}
      <Text
        style={[
          styles.buttonText,
          size === "lg" ? styles.buttonTextLg : null,
          { color: colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Schritt-Eingabe (z. B. ±15 Minuten) mit großem Wert in der Mitte. */
export function Stepper({
  label,
  value,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
  disabled,
}: {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepperBlock}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <View style={styles.stepper}>
        <Button
          label="−"
          accessibilityLabel={decreaseLabel}
          onPress={onDecrease}
          disabled={disabled}
        />
        <View
          accessible
          accessibilityLabel={`${label}: ${value}`}
          style={[
            styles.stepperValue,
            { backgroundColor: theme.surface2, borderColor: theme.lineStrong },
          ]}
        >
          <Text style={[styles.stepperText, { color: theme.text }]}>{value}</Text>
        </View>
        <Button
          label="+"
          accessibilityLabel={increaseLabel}
          onPress={onIncrease}
          disabled={disabled}
        />
      </View>
    </View>
  );
}

/** Auswahl aus wenigen Optionen als Chips (Einzelauswahl). */
export function ChoiceChips<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepperBlock} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={[
                styles.choice,
                {
                  backgroundColor: selected ? theme.inverse : "transparent",
                  borderColor: selected ? theme.inverse : theme.lineStrong,
                },
              ]}
            >
              <Text
                style={[styles.choiceText, { color: selected ? theme.onInverse : theme.textMuted }]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Zeile mit Schalter; Beschriftung und Zustand werden gemeinsam vorgelesen. */
export function SwitchRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <Text style={[styles.body, { color: theme.text }]}>{label}</Text>
        {hint ? <Text style={[styles.small, { color: theme.textMuted }]}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: theme.surface3, true: theme.inverse }}
        thumbColor={value ? theme.onInverse : theme.textMuted}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hinweise
// ---------------------------------------------------------------------------

const NOTICE_ICONS = {
  info: Info,
  warning: TriangleAlert,
  error: OctagonAlert,
  success: CircleCheck,
} as const;

export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: keyof typeof NOTICE_ICONS;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const theme = useTheme();
  const Icon = NOTICE_ICONS[tone];
  const colors =
    tone === "warning"
      ? { bg: theme.warningBg, border: tint(theme.warning, 0.45), icon: theme.warning }
      : tone === "error"
        ? { bg: theme.errorBg, border: tint(theme.error, 0.45), icon: theme.error }
        : tone === "success"
          ? { bg: theme.successBg, border: tint(theme.success, 0.45), icon: theme.success }
          : { bg: theme.surface1, border: theme.line, icon: theme.textMuted };
  return (
    <View
      accessibilityRole={tone === "error" || tone === "warning" ? "alert" : undefined}
      style={[styles.notice, { backgroundColor: colors.bg, borderColor: colors.border }]}
    >
      <Icon color={colors.icon} size={20} strokeWidth={1.9} />
      <View style={[styles.flex, styles.noticeBody]}>
        <Text style={[styles.noticeTitle, { color: theme.text }]}>{title}</Text>
        {typeof children === "string" ? (
          <Text style={[styles.small, { color: theme.text }]}>{children}</Text>
        ) : (
          children
        )}
        {action}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { ...type.pageTitle, fontWeight: "700" },
  section: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  eyebrow: { ...type.eyebrow, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" },
  body: { ...type.body },
  small: { ...type.small },
  bold: { fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: "stretch" },
  surface: { borderWidth: 1, borderRadius: radius.lg, overflow: "hidden" },
  sectionBlock: { gap: spacing.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  chipText: { fontSize: 14, fontWeight: "700" },
  button: {
    minHeight: touch.min,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  buttonLg: { minHeight: touch.primary, borderRadius: 14 },
  buttonText: { fontSize: 16, fontWeight: "700" },
  buttonTextLg: { fontSize: 17 },
  stepperBlock: { gap: 6 },
  stepper: { flexDirection: "row", gap: 6, alignItems: "stretch" },
  stepperValue: {
    flex: 1,
    minHeight: touch.min,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: { fontSize: 20, fontVariant: ["tabular-nums"], fontWeight: "600" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceText: { fontSize: 14, fontWeight: "700" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: touch.min,
    paddingVertical: spacing.sm,
  },
  notice: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  noticeBody: { gap: 4 },
  noticeTitle: { fontSize: 15, fontWeight: "700" },
});

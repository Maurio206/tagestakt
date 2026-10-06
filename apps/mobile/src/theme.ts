import { useColorScheme } from "react-native";

export interface Theme {
  dark: boolean;
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  warning: string;
  warningBg: string;
  danger: string;
  success: string;
}

const dark: Theme = {
  dark: true,
  background: "#11151b",
  surface: "#1a2029",
  surfaceAlt: "#232b36",
  border: "#323c4a",
  text: "#e8ecf1",
  textMuted: "#a9b3c1",
  accent: "#7fb2ff",
  accentText: "#0b1220",
  warning: "#f2c46d",
  warningBg: "#3a2f17",
  danger: "#ff8a80",
  success: "#7fd6a1",
};

const light: Theme = {
  dark: false,
  background: "#f6f7f9",
  surface: "#ffffff",
  surfaceAlt: "#eef1f5",
  border: "#cfd6df",
  text: "#141a22",
  textMuted: "#4d5866",
  accent: "#1f5fbf",
  accentText: "#ffffff",
  warning: "#7a5600",
  warningBg: "#fff4d6",
  danger: "#b3261e",
  success: "#1d6b3d",
};

/** Dunkles Design bevorzugt; hell nur, wenn das System ausdrücklich hell ist. */
export function useTheme(): Theme {
  return useColorScheme() === "light" ? light : dark;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

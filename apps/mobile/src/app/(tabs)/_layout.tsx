import { Tabs } from "expo-router/js-tabs";

import { useTheme } from "@/theme";

/** Tab-Navigation ohne Icons/Bilder: große, gut lesbare Textbeschriftungen. */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border, height: 64 },
        tabBarLabelStyle: { fontSize: 15, fontWeight: "700" },
        tabBarIconStyle: { display: "none" },
        tabBarLabelPosition: "beside-icon",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Jetzt", tabBarAccessibilityLabel: "Jetzt" }} />
      <Tabs.Screen
        name="tag"
        options={{ title: "Tag", tabBarAccessibilityLabel: "Tagesansicht" }}
      />
      <Tabs.Screen
        name="woche"
        options={{ title: "Woche", tabBarAccessibilityLabel: "Wochenansicht" }}
      />
      <Tabs.Screen
        name="einstellungen"
        options={{ title: "Mehr", tabBarAccessibilityLabel: "Einstellungen" }}
      />
    </Tabs>
  );
}

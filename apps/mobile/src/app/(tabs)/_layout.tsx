import { Tabs } from "expo-router/js-tabs";
import { CalendarDays, CalendarRange, Clock, Ellipsis, type LucideIcon } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/theme";

function TabIcon({ icon: Icon, focused }: { icon: LucideIcon; focused: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.pill, focused ? { backgroundColor: theme.surface3 } : null]}>
      <Icon
        color={focused ? theme.text : theme.textSubtle}
        size={22}
        strokeWidth={focused ? 2.2 : 1.9}
      />
    </View>
  );
}

function tabIcon(Icon: LucideIcon) {
  function TabBarIcon({ focused }: { focused: boolean }) {
    return <TabIcon icon={Icon} focused={focused} />;
  }
  return TabBarIcon;
}

const ICONS = {
  index: tabIcon(Clock),
  tag: tabIcon(CalendarDays),
  woche: tabIcon(CalendarRange),
  mehr: tabIcon(Ellipsis),
};

/** Vier Tabs mit Symbol und Text: Jetzt · Tag · Woche · Mehr. */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textSubtle,
        tabBarStyle: {
          backgroundColor: theme.surface1,
          borderTopColor: theme.line,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        tabBarItemStyle: { minHeight: 56 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Jetzt", tabBarAccessibilityLabel: "Jetzt", tabBarIcon: ICONS.index }}
      />
      <Tabs.Screen
        name="tag"
        options={{ title: "Tag", tabBarAccessibilityLabel: "Tag", tabBarIcon: ICONS.tag }}
      />
      <Tabs.Screen
        name="woche"
        options={{
          title: "Woche",
          tabBarAccessibilityLabel: "Woche",
          tabBarIcon: ICONS.woche,
        }}
      />
      <Tabs.Screen
        name="einstellungen"
        options={{ title: "Mehr", tabBarAccessibilityLabel: "Mehr", tabBarIcon: ICONS.mehr }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});

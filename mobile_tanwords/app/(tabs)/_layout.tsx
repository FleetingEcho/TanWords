import { View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { MiniPlayer } from "@/components/feeds/MiniPlayer";
import { usePlayerStore } from "@/services/player";

/**
 * Desktop sidebar (app/src/components/Layout/Sidebar.tsx) → bottom tabs.
 * Headers are off: each screen renders its own large-title ScreenHeader,
 * which scrolls away and leaves full room for content — the iOS-native feel.
 */
export default function TabsLayout() {
  const t = useT();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // Persistent podcast bar rendered ABOVE the tab bar on every tab (desktop
  // PlayerBar parity). MiniPlayer returns null when no track is loaded.
  const hasTrack = usePlayerStore((s) => s.track != null);
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.primary,
        tabBarInactiveTintColor: p["muted-foreground"],
        tabBarStyle: {
          backgroundColor: p.card,
          borderTopColor: p.border,
        },
      }}
      screenListeners={{
        tabPress: () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("nav.dashboard"),
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reading"
        options={{
          title: t("nav.reading"),
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="feeds"
        options={{
          title: t("nav.feeds"),
          tabBarIcon: ({ color, size }) => <Ionicons name="newspaper-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: t("nav.vocabulary"),
          tabBarIcon: ({ color, size }) => <Ionicons name="school-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="docs"
        options={{
          title: t("nav.documents"),
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t("nav.settings"),
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" size={size} color={color} />,
        }}
      />
    </Tabs>
    {hasTrack ? (
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          // Default tab bar height (~49) + home-indicator inset + gap.
          bottom: 49 + insets.bottom + 8,
        }}
      >
        <MiniPlayer />
      </View>
    ) : null}
    </View>
  );
}

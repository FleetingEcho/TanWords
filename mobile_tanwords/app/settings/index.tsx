/**
 * Settings hub (/settings) — grouped rows into appearance / TTS / AI providers.
 * Mirrors desktop Settings panel sections (app/src/components/Settings), scoped
 * to what exists on mobile v1.
 */
import { View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Card, Divider, ListRow } from "@/components/ui";
import { SettingsHeader } from "@/components/settings/SettingsHeader";

export default function SettingsScreen() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const rows = [
    { key: "settings.appearance", icon: "color-palette-outline", route: "/settings/appearance" },
    { key: "settings.ttsSpeed", icon: "speedometer-outline", route: "/settings/tts" },
    { key: "settings.aiService", icon: "sparkles-outline", route: "/settings/ai" },
  ] as const;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <SettingsHeader title={t("nav.settings")} />
      <View className="px-4 pt-2">
        <Card className="p-0">
          {rows.map((r, i) => (
            <View key={r.key}>
              {i > 0 ? <Divider className="mx-4" /> : null}
              <ListRow
                title={t(r.key)}
                left={
                  <View className="rounded-lg bg-muted p-1.5">
                    <Ionicons name={r.icon} size={18} color={p.foreground} />
                  </View>
                }
                onPress={() => router.push(r.route)}
              />
            </View>
          ))}
        </Card>
      </View>
    </SafeAreaView>
  );
}

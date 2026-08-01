/**
 * Appearance (/settings/appearance) — theme mode picker. Writes through
 * settingsStore.setSetting (persistence) + useSettingsStore.setState so the
 * root vars() theme switches instantly without a reload.
 */
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useT } from "@/hooks/useT";
import { SegmentedTabs } from "@/components/ui";
import { useSettingsStore, type ThemeMode } from "@/store/settingsStore";
import { SettingsHeader } from "./_header";

export default function AppearanceScreen() {
  const t = useT();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const onChange = async (v: ThemeMode) => {
    await setSetting("theme_mode", v).catch(() => {});
    useSettingsStore.setState({ themeMode: v });
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <SettingsHeader title={t("settings.appearance")} />
      <View className="px-4 pt-3">
        <SegmentedTabs<ThemeMode>
          options={[
            { key: "system", label: t("settings.theme.system") },
            { key: "light", label: t("settings.theme.light") },
            { key: "dark", label: t("settings.theme.dark") },
          ]}
          value={themeMode}
          onChange={(v) => void onChange(v)}
        />
      </View>
    </SafeAreaView>
  );
}

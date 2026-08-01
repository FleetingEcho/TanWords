/**
 * TTS speed (/settings/tts) — picks expo-speech playback rate used by the
 * sentence/paragraph reading queue. Persisted to user_settings.tts_speed and
 * applied instantly via the settings store.
 */
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Card, Divider, ListRow } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { SettingsHeader } from "./_header";

const SPEEDS = [0.75, 1, 1.25, 1.5];

export default function TtsScreen() {
  const t = useT();
  const p = usePalette();
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const onPick = async (v: number) => {
    await setSetting("tts_speed", String(v)).catch(() => {});
    useSettingsStore.setState({ ttsSpeed: v });
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <SettingsHeader title={t("settings.ttsSpeed")} />
      <View className="px-4 pt-3">
        <Card className="p-0">
          {SPEEDS.map((v, i) => (
            <View key={v}>
              {i > 0 ? <Divider className="mx-4" /> : null}
              <ListRow
                title={`${v}×`}
                right={
                  v === ttsSpeed ? (
                    <Ionicons name="checkmark" size={18} color={p.primary} />
                  ) : undefined
                }
                showChevron={false}
                onPress={() => void onPick(v)}
              />
            </View>
          ))}
        </Card>
      </View>
    </SafeAreaView>
  );
}

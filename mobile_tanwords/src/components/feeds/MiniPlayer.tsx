/**
 * MiniPlayer — persistent podcast bar above the tab bar (desktop PlayerBar,
 * mobile shape). Absolute-positioned by the screen that renders it
 * (bottom = tab bar height + safe-area inset, handled by the parent).
 */
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { usePlayerStore } from "@/services/player";

export function MiniPlayer() {
  const t = useT();
  const p = usePalette();
  const { track, status, position, duration, toggle, seekBy, stop } = usePlayerStore();
  if (!track) return null;

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const playing = status === "playing";
  const loading = status === "loading";

  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-card" style={{ elevation: 6, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
      {/* progress hairline */}
      <View className="h-[3px] w-full bg-muted">
        <View className="h-[3px] bg-primary" style={{ width: `${progress * 100}%` }} />
      </View>
      <View className="flex-row items-center gap-2 px-3 py-2">
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            toggle();
          }}
          className="h-10 w-10 items-center justify-center rounded-full bg-primary"
          style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}
        >
          <Ionicons
            name={loading ? "hourglass" : playing ? "pause" : "play"}
            size={18}
            color={p["primary-foreground"]}
          />
        </Pressable>
        <View className="flex-1 pr-1">
          <Text numberOfLines={1} className="text-[13px] font-semibold text-foreground">
            {track.title}
          </Text>
          <Text numberOfLines={1} className="text-[11px] text-muted-foreground">
            {track.feedTitle}
          </Text>
        </View>
        <Pressable
          onPress={() => seekBy(-15)}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center"
          accessibilityLabel={t("podcast.back15")}
        >
          <Ionicons name="play-back" size={18} color={p["muted-foreground"]} />
        </Pressable>
        <Pressable
          onPress={() => seekBy(15)}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center"
          accessibilityLabel={t("podcast.forward15")}
        >
          <Ionicons name="play-forward" size={18} color={p["muted-foreground"]} />
        </Pressable>
        <Pressable
          onPress={() => stop()}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center"
          accessibilityLabel={t("podcast.close")}
        >
          <Ionicons name="close" size={18} color={p["muted-foreground"]} />
        </Pressable>
      </View>
    </View>
  );
}

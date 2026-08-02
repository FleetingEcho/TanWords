/** Shared back-header for the settings screens group (tabs hide headers).
 *  Lives outside app/ — expo-router registers every file under app/ as a route. */
import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { usePalette } from "@/lib/theme";
import { tapHaptic } from "@/components/ui";

export function SettingsHeader({ title, right }: { title: string; right?: ReactNode }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <View className="flex-row items-center justify-between px-2 pb-1 pt-2">
      <View className="flex-row items-center gap-1">
        <Pressable
          onPress={() => {
            tapHaptic();
            router.back();
          }}
          hitSlop={10}
          className="p-2"
        >
          <Ionicons name="chevron-back" size={24} color={p.foreground} />
        </Pressable>
        <Text className="text-[17px] font-semibold text-foreground">{title}</Text>
      </View>
      {right}
    </View>
  );
}

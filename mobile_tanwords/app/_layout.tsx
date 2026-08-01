import "../global.css";
import "react-native-url-polyfill/auto";
import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { vars } from "nativewind";
import { DbProvider } from "@/db/connection";
import { useSettingsStore } from "@/store/settingsStore";
import { themeVars, useThemeName } from "@/lib/theme";

/** Loads persisted settings (language/theme/TTS speed…) once the DB is open. */
function SettingsGate({ children }: { children: React.ReactNode }) {
  const loadFromDb = useSettingsStore((s) => s.loadFromDb);
  useEffect(() => {
    void loadFromDb().catch(() => {
      /* settings table may not exist yet on first boot; defaults apply */
    });
  }, [loadFromDb]);
  return <>{children}</>;
}

export default function RootLayout() {
  const theme = useThemeName();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Inject light/dark token triplets — every semantic className below
          resolves against these (see src/lib/theme.ts). */}
      <View style={[{ flex: 1 }, vars(themeVars(theme))]}>
        <SafeAreaProvider>
          <DbProvider>
            <SettingsGate>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
              </Stack>
            </SettingsGate>
          </DbProvider>
        </SafeAreaProvider>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
      </View>
    </GestureHandlerRootView>
  );
}

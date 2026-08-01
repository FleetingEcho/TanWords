/**
 * More hub (更多) — mobile home for the desktop sidebar's Settings/Chat/Music
 * cluster (PLAN.md §5). iOS-settings-aesthetic grouped rows: 设置 → /settings,
 * AI 对话 (inline 即将推出, route lands in a later phase), 关于/数据库 info.
 */
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Card, Divider, ListRow, Screen, ScreenHeader, SectionHeader } from "@/components/ui";
import { EXPECTED_SCHEMA_VERSION, getDb } from "@/db/connection";
import { Paths } from "expo-file-system";

function dbPathLabel(): string {
  try {
    // expo-sqlite's default directory for named databases.
    return `${Paths.document.uri.replace(/^file:\/\//, "")}SQLite/tanwords.db`;
  } catch {
    return "SQLite/tanwords.db";
  }
}

export default function MoreScreen() {
  const t = useT();
  const p = usePalette();
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? "—";
  const [schemaVersion, setSchemaVersion] = useState<string>("—");
  const [chatOpen, setChatOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // Tasked exception: screen-level DB introspection for the info row,
      // wrapped in try. (Conventions: raw SQL belongs in db modules.)
      try {
        getDb()
          .getFirstAsync<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations")
          .then((r) => setSchemaVersion(r ? String(r.v) : "0"))
          .catch(() => setSchemaVersion("—"));
      } catch {
        setSchemaVersion("—");
      }
    }, [])
  );

  return (
    <Screen
      header={<ScreenHeader title={t("more.title")} />}
    >
      {/* App actions */}
      <SectionHeader title={t("more.group.app")} />
      <Card className="p-0">
        <ListRow
          title={t("nav.settings")}
          left={
            <View className="rounded-lg bg-muted p-1.5">
              <Ionicons name="settings-outline" size={18} color={p.foreground} />
            </View>
          }
          onPress={() => router.push("/settings")}
        />
        <Divider className="mx-4" />
        <ListRow
          title={t("more.aiChat")}
          left={
            <View className="rounded-lg bg-muted p-1.5">
              <Ionicons name="chatbubbles-outline" size={18} color={p.foreground} />
            </View>
          }
          right={
            <View className="rounded-md bg-accent px-1.5 py-0.5">
              <Text className="text-[10px] font-semibold text-accent-foreground">
                {t("more.comingSoon")}
              </Text>
            </View>
          }
          showChevron={false}
          onPress={() => setChatOpen((v) => !v)}
        />
        {chatOpen ? (
          <>
            <Divider className="mx-4" />
            <View className="px-4 py-3">
              <Text className="text-[13px] leading-5 text-muted-foreground">
                {t("more.aiChat")} · {t("more.comingSoon")} — TanWords Desktop
              </Text>
            </View>
          </>
        ) : null}
      </Card>

      {/* System info */}
      <SectionHeader title={t("more.about")} />
      <Card className="p-0">
        <ListRow
          title={t("more.version")}
          left={
            <View className="rounded-lg bg-muted p-1.5">
              <Ionicons name="information-circle-outline" size={18} color={p.foreground} />
            </View>
          }
          right={<Text className="text-[14px] text-muted-foreground">{version}</Text>}
          showChevron={false}
        />
        <Divider className="mx-4" />
        <ListRow
          title={t("more.schemaVersion")}
          left={
            <View className="rounded-lg bg-muted p-1.5">
              <Ionicons name="server-outline" size={18} color={p.foreground} />
            </View>
          }
          right={
            <Text className="text-[14px] text-muted-foreground">
              {schemaVersion} / {EXPECTED_SCHEMA_VERSION}
            </Text>
          }
          showChevron={false}
        />
        <Divider className="mx-4" />
        <ListRow
          title={t("more.database")}
          left={
            <View className="rounded-lg bg-muted p-1.5">
              <Ionicons name="folder-outline" size={18} color={p.foreground} />
            </View>
          }
          showChevron={false}
          subtitle={dbPathLabel()}
        />
      </Card>
    </Screen>
  );
}

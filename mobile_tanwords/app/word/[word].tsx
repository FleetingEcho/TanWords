/**
 * /word/[word] — word detail as a pushed route (mobile replacement for the
 * desktop WordDetailModal; routes deep-link better than modals).
 * Data: db_get_words (resolve word→id) + db_get_word_detail + extras,
 * port spec: desktop components/WordDetailModal.tsx + WordDetailContent.tsx.
 */
import { useCallback, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Card,
  Divider,
  EmptyState,
  Screen,
  SectionHeader,
  Skeleton,
  tapHaptic,
} from "@/components/ui";
import { usePalette } from "@/lib/theme";
import { useT } from "@/hooks/useT";
import { db_delete_word, db_get_words, db_get_word_detail, db_set_word_starred } from "@/db/words";
import { sqlToDt } from "@/db/srs";
import { speakWord } from "@/services/tts";
import type { WordDetail, WordListItem } from "@/hooks/useDB.types";

function fmtDate(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return sqlToDt(raw).toISOString().slice(0, 10);
  } catch {
    return raw.slice(0, 10);
  }
}

/** Minimal markdown line renderer for AI enrichment text: `## h` headings get
 *  emphasis, list markers keep their line breaks. Spec: desktop renders the
 *  same enrichment_text as markdown; this is the mobile-light equivalent. */
function EnrichmentText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <View className="gap-1.5">
      {lines.map((line, i) => {
        const trimmed = line.replace(/\*\*/g, "").trim();
        if (!trimmed) return null;
        const isHeading = /^#{1,4}\s+/.test(trimmed);
        const body = trimmed.replace(/^#{1,4}\s+/, "");
        return (
          <Text
            key={i}
            className={
              isHeading
                ? "mt-1.5 text-[14px] font-semibold text-foreground"
                : /^[-•*]\s/.test(body) || /^\d+\.\s/.test(body)
                  ? "pl-2 text-[14px] leading-6 text-foreground"
                  : "text-[14px] leading-6 text-foreground"
            }
          >
            {body}
          </Text>
        );
      })}
    </View>
  );
}

export default function WordDetailRoute() {
  const { word } = useLocalSearchParams<{ word: string }>();
  const term = decodeURIComponent(word ?? "");
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const [item, setItem] = useState<WordListItem | null>(null);
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const candidates = await db_get_words({ search: term });
      const hit =
        candidates.find((w) => w.word.toLowerCase() === term.toLowerCase()) ??
        candidates[0] ??
        null;
      if (!hit) {
        setNotFound(true);
        return;
      }
      setItem(hit);
      setDetail(await db_get_word_detail({ wordId: hit.id }));
    } catch (e) {
      console.warn("[word] load failed", e);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [term]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const toggleStar = useCallback(() => {
    if (!item) return;
    tapHaptic();
    const next = !item.starred;
    setItem({ ...item, starred: next });
    void db_set_word_starred({ wordId: item.id, starred: next }).catch((e) =>
      console.warn("[word] star failed", e)
    );
  }, [item]);

  const confirmDelete = useCallback(() => {
    if (!item) return;
    Alert.alert(t("vocab.deleteConfirmTitle", { word: item.word }), t("vocab.deleteConfirmMessage"), [
      { text: t("vocab.cancel"), style: "cancel" },
      {
        text: t("vocab.deleteWord"),
        style: "destructive",
        onPress: () => {
          void db_delete_word({ wordId: item.id })
            .then(() => router.back())
            .catch((e) => console.warn("[word] delete failed", e));
        },
      },
    ]);
  }, [item, t, router]);

  return (
    <Screen
      scroll
      padded={false}
      header={
        <View className="flex-row items-center px-2 pb-1 pt-2">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            className="min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <Ionicons name="chevron-back" size={26} color={p.primary} />
          </Pressable>
          <View className="flex-1 flex-row items-center justify-center gap-1">
            <Text className="text-[17px] font-semibold text-foreground" numberOfLines={1}>
              {term}
            </Text>
          </View>
          <Pressable
            onPress={toggleStar}
            hitSlop={12}
            disabled={!item}
            className="min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <Ionicons
              name={item?.starred ? "star" : "star-outline"}
              size={22}
              color={item?.starred ? p.primary : p["muted-foreground"]}
            />
          </Pressable>
        </View>
      }
    >
      {loading ? (
        <View className="gap-3 px-4 pt-2">
          <Skeleton className="h-[88px]" />
          <Skeleton className="h-[180px]" />
          <Skeleton className="h-[120px]" />
        </View>
      ) : notFound || !item || !detail ? (
        <EmptyState
          icon="search-outline"
          title={t("vocab.notFound")}
          hint={t("vocab.notFoundHint")}
          actionTitle={t("vocab.review.backHome")}
          onAction={() => router.navigate("/learn")}
        />
      ) : (
        <View className="px-4 pb-10">
          {/* Headword + speak */}
          <Card className="mt-1">
            <View className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text className="text-[26px] font-bold text-foreground">{detail.word}</Text>
                <View className="mt-1.5 flex-row gap-1.5">
                  {detail.level ? (
                    <View className="rounded-md bg-muted px-1.5 py-0.5">
                      <Text className="text-[11px] font-semibold text-muted-foreground">
                        {detail.level}
                      </Text>
                    </View>
                  ) : null}
                  {detail.word_type ? (
                    <View className="rounded-md bg-muted px-1.5 py-0.5">
                      <Text className="text-[11px] font-semibold italic text-muted-foreground">
                        {detail.word_type}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Pressable
                onPress={() => {
                  tapHaptic();
                  speakWord(detail.word);
                }}
                hitSlop={8}
                className="min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-accent"
              >
                <Ionicons name="volume-high-outline" size={22} color={p["accent-foreground"]} />
              </Pressable>
            </View>
          </Card>

          {/* Definitions (POS-grouped, zh primary) */}
          <SectionHeader title={t("vocab.definitions")} />
          <Card className="gap-3.5">
            {detail.definitions.length === 0 ? (
              <Text className="text-[13px] text-muted-foreground">{t("vocab.noData")}</Text>
            ) : (
              detail.definitions.map((d, i) => (
                <View key={i} className={i > 0 ? "border-t border-border pt-3.5" : ""}>
                  <View className="flex-col gap-2">
                    {d.pos ? (
                      <Text className="text-[12px] font-semibold italic text-primary">
                        {d.pos}.
                      </Text>
                    ) : null}
                    <Text className="flex-1 text-[15px] leading-6 text-foreground">{d.zh}</Text>
                  </View>
                  {d.en ? (
                    <Text className="mt-1 text-[13px] leading-5 text-muted-foreground">
                      {d.en}
                    </Text>
                  ) : null}
                  {d.example_en ? (
                    <View className="mt-1.5 rounded-lg bg-muted p-2.5">
                      <Text className="text-[13px] italic leading-5 text-foreground">
                        {d.example_en}
                      </Text>
                      {d.example_zh ? (
                        <Text className="mt-1 text-[12px] leading-5 text-muted-foreground">
                          {d.example_zh}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </Card>

          {/* AI enrichment */}
          {detail.enrichment_text ? (
            <>
              <SectionHeader title={t("vocab.enrichment")} />
              <Card>
                <EnrichmentText text={detail.enrichment_text} />
              </Card>
            </>
          ) : detail.enrichment_json ? (
            <View className="mt-4 px-1">
              <Text className="text-[12px] text-muted-foreground">
                {t("vocab.legacyEnrichment")}
              </Text>
            </View>
          ) : null}

          {/* Mnemonic + notes */}
          {detail.mnemonic ? (
            <>
              <SectionHeader title={t("vocab.mnemonic")} />
              <Card>
                <Text className="text-[14px] leading-6 text-foreground">{detail.mnemonic}</Text>
              </Card>
            </>
          ) : null}
          {detail.notes ? (
            <>
              <SectionHeader title={t("vocab.myNotes")} />
              <Card>
                <Text className="text-[14px] leading-6 text-foreground">{detail.notes}</Text>
              </Card>
            </>
          ) : null}

          {/* Meta */}
          <View className="mt-5 rounded-xl bg-muted p-3.5">
            {detail.next_review_at ? (
              <View className="flex-row justify-between py-1">
                <Text className="text-[13px] text-muted-foreground">
                  {t("vocab.nextReview")}
                </Text>
                <Text className="text-[13px] font-medium text-foreground">
                  {fmtDate(detail.next_review_at)}
                </Text>
              </View>
            ) : null}
            <View className="flex-row justify-between py-1">
              <Text className="text-[13px] text-muted-foreground">{t("vocab.addedOn")}</Text>
              <Text className="text-[13px] font-medium text-foreground">
                {fmtDate(detail.created_at)}
              </Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="text-[13px] text-muted-foreground">{t("vocab.sourceLabel")}</Text>
              <Text className="text-[13px] font-medium text-foreground">
                {t(`vocab.source.${detail.source}`) === `vocab.source.${detail.source}`
                  ? detail.source
                  : t(`vocab.source.${detail.source}`)}
              </Text>
            </View>
          </View>

          {/* Danger zone */}
          <Divider className="my-5" />
          <Button
            title={t("vocab.deleteWord")}
            variant="ghost"
            className="self-center"
            onPress={confirmDelete}
            icon={<Ionicons name="trash-outline" size={16} color={p.destructive} />}
          />
        </View>
      )}
    </Screen>
  );
}

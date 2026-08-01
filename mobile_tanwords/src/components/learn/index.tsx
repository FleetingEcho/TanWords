/**
 * Learn-area feature components (vocabulary tab, patterns, review session,
 * word detail). Screen-local pieces so the three learn routes stay slim.
 * Follows docs/UX-CONVENTIONS.md: semantic colors, ui.tsx primitives only.
 */
import React, { memo } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Badge, Button, Card, Divider, tapHaptic } from "@/components/ui";
import { usePalette } from "@/lib/theme";
import { useT } from "@/hooks/useT";
import type { WordListItem } from "@/hooks/useDB.types";
import type { PatternItem } from "@/db/patterns";

// ---------------------------------------------------------------------------
// WordRow — FlashList row: word, first zh def, level chip, star indicator.
// Memoized: FlashList re-renders recycled views, keep it pure + cheap.
// ---------------------------------------------------------------------------
export const WordRow = memo(function WordRow({
  item,
  onPress,
  onLongPress,
}: {
  item: WordListItem;
  onPress: (item: WordListItem) => void;
  onLongPress: (item: WordListItem) => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress(item);
      }}
      onLongPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onLongPress(item);
      }}
      delayLongPress={400}
      className="min-h-[56px] flex-row items-center gap-3 px-4 py-3"
      style={({ pressed }) => (pressed ? { backgroundColor: p.muted } : undefined)}
    >
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
            {item.word}
          </Text>
          {item.word_type ? (
            <Text className="text-[11px] italic text-muted-foreground">{item.word_type}</Text>
          ) : null}
        </View>
        {item.zh ? (
          <Text className="mt-0.5 text-[13px] text-muted-foreground" numberOfLines={1}>
            {item.zh}
          </Text>
        ) : null}
      </View>
      {item.level ? (
        <View className="rounded-md bg-muted px-1.5 py-0.5">
          <Text className="text-[10px] font-semibold text-muted-foreground">{item.level}</Text>
        </View>
      ) : null}
      {item.starred ? (
        <Ionicons name="star" size={15} color={p.primary} />
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={p["muted-foreground"]} />
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// WordActionsSheet — long-press bottom sheet: star/unstar, delete, cancel.
// Conventions: RN Modal, bottom-anchored card, dimmed backdrop dismiss.
// ---------------------------------------------------------------------------
export function WordActionsSheet({
  item,
  onClose,
  onToggleStar,
  onDelete,
}: {
  item: WordListItem | null;
  onClose: () => void;
  onToggleStar: (item: WordListItem) => void;
  onDelete: (item: WordListItem) => void;
}) {
  const t = useT();
  const p = usePalette();
  if (!item) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <Pressable className="rounded-t-3xl bg-card pb-8" onPress={(e) => e.stopPropagation()}>
          <View className="items-center py-3">
            <View className="h-1 w-9 rounded-full bg-muted" />
          </View>
          <Text
            className="px-5 pb-2 text-center text-[13px] text-muted-foreground"
            numberOfLines={1}
          >
            {item.word}
          </Text>
          <Pressable
            className="min-h-[48px] flex-row items-center gap-3 px-5"
            style={({ pressed }) => (pressed ? { backgroundColor: p.muted } : undefined)}
            onPress={() => {
              tapHaptic();
              onToggleStar(item);
              onClose();
            }}
          >
            <Ionicons
              name={item.starred ? "star" : "star-outline"}
              size={20}
              color={p.primary}
            />
            <Text className="text-[16px] text-foreground">
              {item.starred ? t("vocab.unstar") : t("vocab.star")}
            </Text>
          </Pressable>
          <Divider className="mx-5" />
          <Pressable
            className="min-h-[48px] flex-row items-center gap-3 px-5"
            style={({ pressed }) => (pressed ? { backgroundColor: p.muted } : undefined)}
            onPress={() => {
              tapHaptic();
              onClose();
              onDelete(item);
            }}
          >
            <Ionicons name="trash-outline" size={20} color={p.destructive} />
            <Text className="text-[16px] text-destructive">{t("vocab.deleteWord")}</Text>
          </Pressable>
          <View className="px-5 pt-3">
            <Button title={t("vocab.cancel")} variant="secondary" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// PatternCard — expandable pattern row; "___" slots highlighted in primary.
// ---------------------------------------------------------------------------
const SLOT_RE = /_{2,}|\{\s*\w*\s*\}/;

function SkeletonText({ pattern }: { pattern: string }) {
  const parts = pattern.split(SLOT_RE);
  const slots = pattern.match(new RegExp(SLOT_RE.source, "g")) ?? [];
  return (
    <Text className="text-[15px] font-medium leading-6 text-foreground">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < slots.length ? <Text className="text-primary">{slots[i]}</Text> : null}
        </React.Fragment>
      ))}
    </Text>
  );
}

export const PatternCard = memo(function PatternCard({
  item,
  expanded,
  onToggle,
  onToggleStar,
}: {
  item: PatternItem;
  expanded: boolean;
  onToggle: (item: PatternItem) => void;
  onToggleStar: (item: PatternItem) => void;
}) {
  const t = useT();
  const p = usePalette();
  return (
    <Card className="mb-2 p-3.5" onPress={() => onToggle(item)}>
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <SkeletonText pattern={item.pattern} />
          {item.zh ? (
            <Text className="mt-1 text-[13px] text-muted-foreground" numberOfLines={expanded ? undefined : 1}>
              {item.zh}
            </Text>
          ) : null}
        </View>
        {item.level ? (
          <View className="rounded-md bg-muted px-1.5 py-0.5">
            <Text className="text-[10px] font-semibold text-muted-foreground">{item.level}</Text>
          </View>
        ) : null}
        <Pressable
          hitSlop={10}
          onPress={() => {
            tapHaptic();
            onToggleStar(item);
          }}
          className="min-h-[32px] justify-center"
        >
          <Ionicons
            name={item.starred ? "star" : "star-outline"}
            size={20}
            color={item.starred ? p.primary : p["muted-foreground"]}
          />
        </Pressable>
      </View>
      {expanded ? (
        <View className="mt-2.5 gap-2 border-t border-border pt-2.5">
          {item.note ? (
            <Text className="text-[13px] leading-5 text-muted-foreground">{item.note}</Text>
          ) : null}
          {item.examples.map((ex) => (
            <View key={ex.id} className="flex-row gap-2">
              <Text className="text-[13px] leading-5 text-primary">•</Text>
              <Text className="flex-1 text-[13px] leading-5 text-foreground">{ex.sentence}</Text>
            </View>
          ))}
          {item.examples.length === 0 && !item.note ? (
            <Text className="text-[13px] text-muted-foreground">{t("vocab.noData")}</Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
});

// ---------------------------------------------------------------------------
// ReviewSummaryCard — the 复习 segment: due count + new-card cap + start CTA.
// ---------------------------------------------------------------------------
export function ReviewSummaryCard({
  dueCount,
  newLimit,
  onStart,
}: {
  dueCount: number;
  newLimit: number;
  onStart: () => void;
}) {
  const t = useT();
  const p = usePalette();
  const hasDue = dueCount > 0;
  return (
    <View className="px-4 pt-4">
      <Card className={hasDue ? "bg-accent border-transparent" : ""}>
        <View className="flex-row items-center gap-3">
          <View className="rounded-xl bg-primary p-2.5">
            <Ionicons
              name={hasDue ? "albums-outline" : "checkmark-done-outline"}
              size={22}
              color={p["primary-foreground"]}
            />
          </View>
          <View className="flex-1">
            <Text className="text-[15px] font-semibold text-foreground">
              {hasDue
                ? t("vocab.review.dueLine", { n: dueCount })
                : t("vocab.review.allDone")}
            </Text>
            <Text className="mt-0.5 text-[12px] text-muted-foreground">
              {t("vocab.review.newCap", { n: newLimit })}
            </Text>
          </View>
          {hasDue ? <Badge count={dueCount} tone="destructive" /> : null}
        </View>
        <View className="mt-3">
          <Button title={t("vocab.review.start")} onPress={onStart} disabled={!hasDue} />
        </View>
      </Card>
    </View>
  );
}

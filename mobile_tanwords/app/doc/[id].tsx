/**
 * Document editor (/doc/[id]) — mobile markdown editor replacing desktop's
 * BlockNote surface. 500ms debounced autosave into the same columns
 * (documents.content/content_text updated together), footer meta bar, and a
 * 预览 toggle that renders via src/components/docs/Markdown.
 *
 * v1 constraints (see src/db/documents.ts header):
 *  - Editing loads content_text (plain text). Saving a desktop BlockNote doc
 *    demotes it to plain markdown text — content block structure is dropped.
 *  - Protected (desktop-encrypted) docs render a locked notice, never edits.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { EmptyState, LoadingView, tapHaptic } from "@/components/ui";
import { db_delete_document, db_get_document, db_update_document } from "@/db/documents";
import { Markdown } from "@/components/docs/Markdown";
import { countWords, formatUpdatedAt } from "@/components/docs/format";

export default function DocEditorScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Number(rawId);
  const t = useT();
  const p = usePalette();
  const router = useRouter();

  const [state, setState] = useState<"loading" | "missing" | "locked" | "ready">("loading");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [savedAt, setSavedAt] = useState<string>("");
  const [pinned, setPinned] = useState(false);
  const [tags, setTags] = useState("[]");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest values for the autosave timer + unmount flush (avoid stale closures).
  const pending = useRef({ title: "", body: "", tags: "[]", pinned: false, dirty: false });

  const persist = useCallback(async () => {
    const cur = pending.current;
    if (!cur.dirty || !Number.isFinite(id)) return;
    cur.dirty = false;
    setSaving(true);
    try {
      const wordCount = countWords(cur.body);
      // Mobile stores the same markdown text in content + content_text.
      await db_update_document({
        id,
        title: cur.title.trim() || "Untitled",
        content: cur.body,
        contentText: cur.body,
        tags: cur.tags,
        pinned: cur.pinned,
        wordCount,
      });
      setSavedAt(new Date().toISOString());
    } catch (e) {
      console.warn("doc autosave failed", e);
      cur.dirty = true; // retry on next tick
    } finally {
      setSaving(false);
    }
  }, [id]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist();
    }, 500);
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    void db_get_document({ id })
      .then((doc) => {
        if (cancelled) return;
        if (!doc) {
          setState("missing");
          return;
        }
        if (doc.protected) {
          setState("locked");
          return;
        }
        // Prefer the plain column: desktop docs carry readable text there
        // even when `content` holds BlockNote JSON.
        // Desktop blank docs store "{}" and BlockNote docs store a JSON
        // array in `content` — both unreadable raw; fall back to the plain
        // content_text column for anything JSON-shaped.
        const text = /^\s*[\[{]/.test(doc.content) ? doc.content_text : doc.content || doc.content_text;
        setTitle(doc.title === "Untitled" ? "" : doc.title);
        setBody(text);
        setTags(doc.tags);
        setPinned(doc.pinned);
        setSavedAt(doc.updated_at);
        pending.current = {
          title: doc.title === "Untitled" ? "" : doc.title,
          body: text,
          tags: doc.tags,
          pinned: doc.pinned,
          dirty: false,
        };
        setState("ready");
      })
      .catch((e) => {
        console.warn("load doc failed", e);
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Flush pending changes on unmount (back gesture, tab switch).
  useEffect(() => {
    const p = pending;
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (p.current.dirty) {
        const cur = p.current;
        void db_update_document({
          id,
          title: cur.title.trim() || "Untitled",
          content: cur.body,
          contentText: cur.body,
          tags: cur.tags,
          pinned: cur.pinned,
          wordCount: countWords(cur.body),
        }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onChangeTitle = useCallback(
    (v: string) => {
      setTitle(v);
      pending.current.title = v;
      pending.current.dirty = true;
      scheduleSave();
    },
    [scheduleSave]
  );

  const onChangeBody = useCallback(
    (v: string) => {
      setBody(v);
      pending.current.body = v;
      pending.current.dirty = true;
      scheduleSave();
    },
    [scheduleSave]
  );

  const goBack = useCallback(() => {
    void persist().finally(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/docs");
    });
  }, [persist, router]);

  const confirmDelete = useCallback(() => {
    Alert.alert(t("doc.deleteDocTitle"), t("doc.deleteConfirm"), [
      { text: t("doc.cancel"), style: "cancel" },
      {
        text: t("doc.delete"),
        style: "destructive",
        onPress: () => {
          pending.current.dirty = false; // don't resurrect on unmount flush
          void db_delete_document({ id })
            .catch(() => {})
            .finally(() => {
              if (router.canGoBack()) router.back();
              else router.replace("/docs");
            });
        },
      },
    ]);
  }, [t, id, router]);

  if (state === "loading") return <LoadingView />;
  if (state === "missing") {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
        <EmptyState icon="alert-circle-outline" title={t("doc.noDocSelected")} />
      </SafeAreaView>
    );
  }
  if (state === "locked") {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
        <View className="flex-row items-center px-2 py-1">
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-2">
            <Ionicons name="chevron-back" size={24} color={p.foreground} />
          </Pressable>
        </View>
        <EmptyState
          icon="lock-closed-outline"
          title={t("doc.lockedTitle")}
          hint={t("doc.protectedMobile")}
        />
      </SafeAreaView>
    );
  }

  const words = countWords(body);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header: back (flush save) · save state · preview toggle · delete */}
      <View className="flex-row items-center justify-between border-b border-border px-2 py-1">
        <Pressable
          onPress={() => {
            tapHaptic();
            goBack();
          }}
          hitSlop={10}
          className="p-2"
        >
          <Ionicons name="chevron-back" size={24} color={p.foreground} />
        </Pressable>
        <Text className="text-[12px] text-muted-foreground">
          {saving ? t("doc.saving") : pending.current.dirty ? "" : t("doc.autoSaved")}
        </Text>
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={() => {
              tapHaptic();
              setPreview((v) => !v);
            }}
            hitSlop={10}
            className="flex-row items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5"
          >
            <Ionicons name={preview ? "create-outline" : "eye-outline"} size={15} color={p.foreground} />
            <Text className="text-[13px] font-medium text-foreground">
              {preview ? t("doc.edit") : t("doc.richMode")}
            </Text>
          </Pressable>
          <Pressable onPress={confirmDelete} hitSlop={10} className="p-2">
            <Ionicons name="trash-outline" size={20} color={p.destructive} />
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {preview ? (
          <ScrollView className="flex-1 px-4 py-3" keyboardShouldPersistTaps="handled">
            <Text className="mb-3 text-[22px] font-bold text-foreground">
              {title || t("doc.untitled")}
            </Text>
            <Markdown text={body} />
            <View className="h-24" />
          </ScrollView>
        ) : (
          <View className="flex-1 px-4 py-3">
            <TextInput
              className="text-[19px] font-semibold text-foreground"
              value={title}
              onChangeText={onChangeTitle}
              placeholder={t("doc.titlePlaceholder")}
              placeholderTextColor={p["muted-foreground"]}
              returnKeyType="next"
            />
            <View className="my-2 h-px bg-border" />
            <TextInput
              className="flex-1 text-[15px] leading-6 text-foreground"
              style={{ lineHeight: 24, textAlignVertical: "top" }}
              value={body}
              onChangeText={onChangeBody}
              placeholder={t("doc.bodyPlaceholder")}
              placeholderTextColor={p["muted-foreground"]}
              multiline
              autoCorrect={false}
            />
          </View>
        )}

        {/* Meta footer */}
        <View className="flex-row items-center justify-between border-t border-border px-4 py-2">
          <Text className="text-[12px] text-muted-foreground">
            {t("doc.wordCount", { n: words })}
          </Text>
          <Text className="text-[12px] text-muted-foreground">
            {t("doc.updated", { time: formatUpdatedAt(savedAt, true) })}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

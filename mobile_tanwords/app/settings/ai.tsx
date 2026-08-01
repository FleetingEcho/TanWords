/**
 * AI providers (/settings/ai) — list + add/edit/delete for `ai_providers`
 * rows via src/db/providers.ts. API keys go to expo-secure-store only; the DB
 * carries the `__secure_store__` sentinel (PLAN.md D8), so the key field is
 * never echoed back when editing — re-enter to replace.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useT } from "@/hooks/useT";
import { usePalette } from "@/lib/theme";
import { Button, Card, Divider, EmptyState, ListRow, SegmentedTabs, tapHaptic } from "@/components/ui";
import {
  aiProviderDelete,
  aiProviderList,
  aiProviderUpsert,
  type AiProviderRow,
} from "@/db/providers";
import { SettingsHeader } from "./_header";

type Kind = "anthropic" | "openai" | "custom";
const KIND_DEFAULTS: Record<Kind, { apiBase: string; modelId: string }> = {
  anthropic: { apiBase: "https://api.anthropic.com", modelId: "claude-sonnet-4-5" },
  openai: { apiBase: "https://api.openai.com/v1", modelId: "gpt-4o-mini" },
  custom: { apiBase: "", modelId: "" },
};

interface FormState {
  id: string | null; // null = new
  name: string;
  kind: Kind;
  apiBase: string;
  modelId: string;
  apiKey: string; // only persisted when non-empty
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  kind: "anthropic",
  apiBase: KIND_DEFAULTS.anthropic.apiBase,
  modelId: KIND_DEFAULTS.anthropic.modelId,
  apiKey: "",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure = false,
  autoCapitalize = "none",
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "url";
}) {
  const p = usePalette();
  return (
    <View className="mt-3">
      <Text className="mb-1 text-[13px] text-muted-foreground">{label}</Text>
      <TextInput
        className="rounded-xl border border-border bg-background px-3 py-2.5 text-[15px] text-foreground"
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={p["muted-foreground"]}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardType={keyboardType}
      />
    </View>
  );
}

export default function AiProvidersScreen() {
  const t = useT();
  const p = usePalette();
  const [items, setItems] = useState<AiProviderRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState<FormState | null>(null);
  const [formError, setFormError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await aiProviderList());
    } catch (e) {
      console.warn("provider list failed", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (row: AiProviderRow) => {
    setFormError(false);
    setSheet({
      id: row.id,
      name: row.name,
      kind: (row.kind as Kind) || "custom",
      apiBase: row.api_base,
      modelId: row.model_id,
      apiKey: "",
    });
  };

  const save = async () => {
    if (!sheet) return;
    if (!sheet.name.trim() || !sheet.apiBase.trim() || !sheet.modelId.trim()) {
      setFormError(true);
      return;
    }
    setSaving(true);
    try {
      const id = sheet.id ?? `p.${Crypto.randomUUID()}`;
      await aiProviderUpsert(
        {
          id,
          name: sheet.name.trim(),
          kind: sheet.kind,
          apiBase: sheet.apiBase.trim(),
          modelId: sheet.modelId.trim(),
        },
        // Empty on edit = keep the stored key; never reads it back into memory.
        sheet.apiKey.trim() ? sheet.apiKey.trim() : undefined
      );
      setSheet(null);
      await load();
    } catch (e) {
      console.warn("provider save failed", e);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (id: string, name: string) => {
    Alert.alert(t("settings.provider.deleteTitle"), t("settings.provider.deleteConfirm", { name }), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("settings.delete"),
        style: "destructive",
        onPress: () => {
          void aiProviderDelete(id)
            .then(load)
            .catch(() => {});
        },
      },
    ]);
  };

  const kindBadge = (kind: string) => (
    <View className="rounded-md bg-muted px-1.5 py-0.5">
      <Text className="text-[10px] font-semibold text-muted-foreground">{kind}</Text>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <SettingsHeader
        title={t("settings.aiService")}
        right={
          <Pressable
            onPress={() => {
              tapHaptic();
              setFormError(false);
              setSheet({ ...EMPTY_FORM });
            }}
            hitSlop={10}
            className="rounded-full bg-primary p-2"
          >
            <Ionicons name="add" size={18} color={p["primary-foreground"]} />
          </Pressable>
        }
      />

      <ScrollView className="flex-1 px-4 pt-2">
        <Text className="mb-3 text-[12px] leading-4 text-muted-foreground">{t("settings.aiHint")}</Text>
        {loaded && items.length === 0 ? (
          <Card>
            <EmptyState
              icon="key-outline"
              title={t("settings.provider.empty")}
              hint={t("settings.provider.emptyHint")}
              actionTitle={t("settings.provider.add")}
              onAction={() => {
                setFormError(false);
                setSheet({ ...EMPTY_FORM });
              }}
            />
          </Card>
        ) : (
          <Card className="p-0">
            {items.map((row, i) => (
              <View key={row.id}>
                {i > 0 ? <Divider className="mx-4" /> : null}
                <ListRow
                  title={row.name || row.id}
                  subtitle={row.model_id ? `${row.api_base} · ${row.model_id}` : row.api_base}
                  left={
                    <Ionicons
                      name={row.has_key ? "key" : "key-outline"}
                      size={18}
                      color={row.has_key ? p.primary : p["muted-foreground"]}
                    />
                  }
                  right={kindBadge(row.kind)}
                  onPress={() => openEdit(row)}
                />
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      {/* Add / edit sheet (conventions: bottom-anchored card in a Modal) */}
      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setSheet(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View className="rounded-t-3xl bg-card px-4 pb-8 pt-4">
                <Text className="text-center text-[17px] font-semibold text-foreground">
                  {sheet?.id ? t("settings.provider.edit") : t("settings.provider.add")}
                </Text>
                {sheet?.id ? (
                  <Pressable
                    onPress={() => {
                      const id = sheet.id;
                      const name = sheet.name;
                      setSheet(null);
                      if (id) confirmDelete(id, name);
                    }}
                    className="mt-2 self-center"
                    hitSlop={8}
                  >
                    <Text className="text-[13px] text-destructive">{t("settings.delete")}</Text>
                  </Pressable>
                ) : null}
                <ScrollView
                  className="mt-1 max-h-[420px]"
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <Field
                    label={t("settings.provider.name")}
                    value={sheet?.name ?? ""}
                    onChange={(v) => setSheet((s) => (s ? { ...s, name: v } : s))}
                    placeholder="Claude"
                    autoCapitalize="words"
                  />
                  <View className="mt-3">
                    <Text className="mb-1 text-[13px] text-muted-foreground">
                      {t("settings.provider.type")}
                    </Text>
                    <SegmentedTabs<Kind>
                      options={[
                        { key: "anthropic", label: "Anthropic" },
                        { key: "openai", label: "OpenAI" },
                        { key: "custom", label: "Custom" },
                      ]}
                      value={sheet?.kind ?? "anthropic"}
                      onChange={(k) =>
                        setSheet((s) =>
                          s
                            ? {
                                ...s,
                                kind: k,
                                // Prefill sensible defaults for empty fields.
                                apiBase: s.apiBase || KIND_DEFAULTS[k].apiBase,
                                modelId: s.modelId || KIND_DEFAULTS[k].modelId,
                              }
                            : s
                        )
                      }
                    />
                  </View>
                  <Field
                    label={t("settings.provider.apiBase")}
                    value={sheet?.apiBase ?? ""}
                    onChange={(v) => setSheet((s) => (s ? { ...s, apiBase: v } : s))}
                    placeholder={KIND_DEFAULTS[sheet?.kind ?? "anthropic"].apiBase}
                    keyboardType="url"
                  />
                  <Field
                    label={t("settings.provider.model")}
                    value={sheet?.modelId ?? ""}
                    onChange={(v) => setSheet((s) => (s ? { ...s, modelId: v } : s))}
                    placeholder={KIND_DEFAULTS[sheet?.kind ?? "anthropic"].modelId}
                  />
                  <Field
                    label={`${t("settings.apiKey")} 🔒`}
                    value={sheet?.apiKey ?? ""}
                    onChange={(v) => setSheet((s) => (s ? { ...s, apiKey: v } : s))}
                    placeholder={sheet?.id ? t("settings.provider.keySaved") : "sk-..."}
                    secure
                  />
                  {formError ? (
                    <Text className="mt-2 text-[13px] text-destructive">
                      {t("settings.provider.invalid")}
                    </Text>
                  ) : null}
                </ScrollView>
                <View className="mt-4 flex-row gap-3">
                  <Button
                    title={t("settings.cancel")}
                    variant="secondary"
                    className="flex-1"
                    onPress={() => setSheet(null)}
                  />
                  <Button
                    title={t("settings.save")}
                    className="flex-1"
                    loading={saving}
                    onPress={() => void save()}
                  />
                </View>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

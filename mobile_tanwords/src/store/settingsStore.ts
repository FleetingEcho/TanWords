/**
 * Settings store — mobile analogue of desktop app/src/store/settingsStore.ts.
 * Values persist in the `user_settings(key, value)` table (desktop's
 * db_get_setting/db_set_setting). This is the Phase-1 surface the rest of the
 * app depends on; extend fields as features port, keeping these names.
 */
import { create } from "zustand";
import { getDb } from "@/db/connection";

export type UiLanguage = "zh" | "en";
export type ThemeMode = "system" | "light" | "dark";

interface SettingsState {
  /** Loaded from `user_settings.ui_language`; default zh (Chinese-first, D3). */
  uiLanguage: UiLanguage;
  /** `user_settings.target_level` (JSON array or legacy single string). */
  targetLevels: string[];
  customEnrichPrompt: string;
  ttsSpeed: number;
  defaultAiProvider: string;
  /** `user_settings.theme_mode` (mobile-only key; desktop ignores it). */
  themeMode: ThemeMode;
  loaded: boolean;
  loadFromDb: () => Promise<void>;
  /** Port of command db_set_setting. */
  setSetting: (key: string, value: string) => Promise<void>;
  /** Port of command db_get_setting. */
  getSetting: (key: string) => Promise<string | null>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  uiLanguage: "zh",
  targetLevels: ["C1"],
  customEnrichPrompt: "",
  ttsSpeed: 1,
  defaultAiProvider: "openai",
  themeMode: "system",
  loaded: false,

  loadFromDb: async () => {
    const db = getDb();
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      "SELECT key, value FROM user_settings WHERE key IN ('ui_language','target_level','custom_enrich_prompt','tts_speed','default_ai_provider','theme_mode')"
    );
    const v: Record<string, string> = {};
    for (const r of rows) v[r.key] = r.value;

    let targetLevels: string[] = ["C1"];
    if (v.target_level) {
      // Legacy installs stored a single string ("C1"); newer ones a JSON array.
      try {
        const parsed = JSON.parse(v.target_level);
        targetLevels = Array.isArray(parsed) ? parsed : [v.target_level];
      } catch {
        targetLevels = [v.target_level];
      }
    }
    set({
      uiLanguage: v.ui_language === "en" ? "en" : "zh",
      targetLevels,
      customEnrichPrompt: v.custom_enrich_prompt ?? "",
      ttsSpeed: Number(v.tts_speed) || 1,
      defaultAiProvider: v.default_ai_provider || "openai",
      themeMode: v.theme_mode === "light" || v.theme_mode === "dark" ? v.theme_mode : "system",
      loaded: true,
    });
  },

  setSetting: async (key, value) => {
    await getDb().runAsync(
      `INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
  },

  getSetting: async (key) => {
    const row = await getDb().getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = ?",
      [key]
    );
    return row?.value ?? null;
  },
}));

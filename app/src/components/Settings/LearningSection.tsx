import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { DEFAULT_ENRICH_SYSTEM_PROMPT } from "@/providers/base";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { SettingRow } from "./SettingsShared";

const LEVELS = ["A2", "B1", "B2", "C1", "C2"] as const;

function EnrichPromptEditor() {
  const t = useT();
  const customEnrichPrompt = useSettingsStore((s) => s.customEnrichPrompt);
  const setCustomEnrichPrompt = useSettingsStore((s) => s.setCustomEnrichPrompt);
  const [draft, setDraft] = useState(customEnrichPrompt || DEFAULT_ENRICH_SYSTEM_PROMPT);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDraft(customEnrichPrompt || DEFAULT_ENRICH_SYSTEM_PROMPT), [customEnrichPrompt]);

  const onChange = useCallback((value: string) => {
    setDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setCustomEnrichPrompt(value), 500);
  }, [setCustomEnrichPrompt]);

  const resetToDefault = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDraft(DEFAULT_ENRICH_SYSTEM_PROMPT);
    setCustomEnrichPrompt("");
  };

  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("settings.enrichPrompt")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("settings.enrichPromptSub")}</p>
        </div>
        {draft !== DEFAULT_ENRICH_SYSTEM_PROMPT && (
          <Button variant="ghost" onClick={resetToDefault} className="h-auto px-2 py-1 text-xs shrink-0">
            {t("settings.enrichPromptReset")}
          </Button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("settings.enrichPromptPlaceholder")}
        rows={8}
        className="w-full px-3 py-2 rounded-lg border border-input bg-background text-xs font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring resize-y"
      />
    </div>
  );
}

export function LearningSection() {
  const settings = useSettingsStore();
  const t = useT();

  return (
    <div className="bg-card border border-border rounded-xl px-5 divide-y divide-border">
      <SettingRow label={t("settings.targetLevel")} sub={t("settings.targetLevelSub")}>
        <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg">
          {LEVELS.map((lvl) => {
            const selected = settings.targetLevels.includes(lvl);
            return (
              <Button
                key={lvl}
                variant="ghost"
                onClick={() =>
                  settings.setTargetLevels(
                    selected
                      ? settings.targetLevels.filter((l) => l !== lvl)
                      : [...LEVELS.filter((l) => settings.targetLevels.includes(l) || l === lvl)]
                  )
                }
                className={`h-auto px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  selected ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary" : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                }`}
              >
                {lvl}
              </Button>
            );
          })}
        </div>
      </SettingRow>
      <EnrichPromptEditor />
    </div>
  );
}

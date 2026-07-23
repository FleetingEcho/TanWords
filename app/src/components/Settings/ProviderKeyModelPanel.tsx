import React from "react";
import { Loader2, ListRestart, PlugZap } from "lucide-react";
import { ProviderIconButton, TestStatusBadge } from "./ProviderFormControls";

interface ProviderKeyModelPanelProps {
  apiKeyValue: string;
  onApiKeyChange: (value: string) => void;
  apiKeyPlaceholder: string;
  modelValue: string;
  onModelChange: (model: string) => void;
  fetchingModels: boolean;
  onFetchModels: () => void;
  onTest: () => void;
  testStatus: { ok: boolean | null; text: string } | null;
  t: (key: string) => string;
}

/** Shared "API key + model id + test connection" block used by the OpenAI,
 * Claude, and preset (e.g. DeepSeek) provider configs — these three panels
 * were identical apart from which value/handler they were wired to. */
export function ProviderKeyModelPanel({
  apiKeyValue,
  onApiKeyChange,
  apiKeyPlaceholder,
  modelValue,
  onModelChange,
  fetchingModels,
  onFetchModels,
  onTest,
  testStatus,
  t,
}: ProviderKeyModelPanelProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
        <input type="password" value={apiKeyValue} onChange={(e) => onApiKeyChange(e.target.value)} placeholder={apiKeyPlaceholder} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.modelId")}</label>
        <div className="flex gap-2">
          <input list="provider-model-options" value={modelValue} onChange={(e) => onModelChange(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none" />
          <ProviderIconButton label={t("settings.fetchModels")} onClick={onFetchModels}>
            {fetchingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListRestart className="h-4 w-4" />}
          </ProviderIconButton>
        </div>
      </div>
      <ProviderIconButton label={t("settings.testConnection")} onClick={onTest}><PlugZap className="h-4 w-4" /></ProviderIconButton>
      {testStatus && <TestStatusBadge status={testStatus} />}
    </div>
  );
}

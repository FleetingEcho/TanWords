import React, { useState } from "react";
import { PlugZap, Trash2 } from "lucide-react";
import { ProviderIconButton, TestStatusBadge } from "./ProviderFormControls";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ProviderModelSelect } from "./ProviderModelSelect";

interface ProviderKeyModelPanelProps {
  apiKeyValue: string;
  onApiKeyChange: (value: string) => void;
  apiKeyPlaceholder: string;
  modelValue: string;
  onModelChange: (model: string) => void;
  fetchingModels: boolean;
  onFetchModels: () => void;
  modelOptions: string[];
  onTest: () => void;
  onClear: () => void;
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
  modelOptions,
  onTest,
  onClear,
  testStatus,
  t,
}: ProviderKeyModelPanelProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
        <input type="password" value={apiKeyValue} onChange={(e) => onApiKeyChange(e.target.value)} placeholder={apiKeyPlaceholder} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.modelLabel")}</label>
        <ProviderModelSelect
          value={modelValue}
          onChange={onModelChange}
          options={modelOptions}
          fetchingModels={fetchingModels}
          onFetchModels={onFetchModels}
          placeholder={t("settings.modelSelectPlaceholder")}
          t={t}
        />
      </div>
      <div className="flex items-center gap-1">
        <ProviderIconButton label={t("settings.testConnection")} onClick={onTest}><PlugZap className="h-4 w-4" /></ProviderIconButton>
        <ProviderIconButton label={t("settings.clearConfig")} danger onClick={() => setConfirmClear(true)}><Trash2 className="h-4 w-4" /></ProviderIconButton>
      </div>
      {testStatus && <TestStatusBadge status={testStatus} />}

      <ConfirmModal
        open={confirmClear}
        title={t("settings.clearConfigTitle")}
        message={t("settings.clearConfigMessage")}
        confirmLabel={t("settings.clearConfig")}
        onConfirm={() => { onClear(); setConfirmClear(false); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

import React from "react";
import { Button } from "@/components/ui/button";
import { ProviderModelSelect } from "./ProviderModelSelect";

interface NewProviderForm {
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
}

interface CustomProviderAddFormProps {
  newProvider: NewProviderForm;
  onNewProviderChange: (updater: (prev: NewProviderForm) => NewProviderForm) => void;
  fetchingModels: boolean;
  onFetchModels: () => void;
  modelOptions: string[];
  onAdd: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}

/** Form for adding a brand-new custom (OpenAI-compatible) provider, e.g. a
 * local Ollama or LM Studio server. */
export function CustomProviderAddForm({ newProvider, onNewProviderChange, fetchingModels, onFetchModels, modelOptions, onAdd, onCancel, t }: CustomProviderAddFormProps) {
  return (
    <div className="mt-4 bg-card border border-border rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-semibold">{t("settings.addCustomTitle")}</h3>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.name")}</label>
        <input value={newProvider.name} onChange={(e) => onNewProviderChange((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g., Ollama" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-hidden" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.baseUrl")}</label>
        <input value={newProvider.apiBase} onChange={(e) => onNewProviderChange((prev) => ({ ...prev, apiBase: e.target.value }))} placeholder="http://localhost:11434/v1" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-hidden" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
        <input type="password" value={newProvider.apiKey} onChange={(e) => onNewProviderChange((prev) => ({ ...prev, apiKey: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-hidden" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.modelLabel")}</label>
        <ProviderModelSelect
          value={newProvider.modelId}
          onChange={(model) => onNewProviderChange((prev) => ({ ...prev, modelId: model }))}
          options={modelOptions}
          fetchingModels={fetchingModels}
          onFetchModels={onFetchModels}
          placeholder={t("settings.modelSelectPlaceholder")}
          t={t}
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={onAdd} disabled={!newProvider.name || !newProvider.apiBase || !newProvider.modelId} className="h-auto px-4 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">{t("settings.add")}</Button>
        <Button variant="outline" onClick={onCancel} className="h-auto px-4 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors">{t("settings.cancel")}</Button>
      </div>
    </div>
  );
}

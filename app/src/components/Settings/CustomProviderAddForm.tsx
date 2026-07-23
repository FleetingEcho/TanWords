import React from "react";
import { Loader2, ListRestart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderIconButton } from "./ProviderFormControls";

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
  onAdd: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}

/** Form for adding a brand-new custom (OpenAI-compatible) provider, e.g. a
 * local Ollama or LM Studio server. */
export function CustomProviderAddForm({ newProvider, onNewProviderChange, fetchingModels, onFetchModels, onAdd, onCancel, t }: CustomProviderAddFormProps) {
  return (
    <div className="mt-4 bg-card border border-border rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-semibold">{t("settings.addCustomTitle")}</h3>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.name")}</label>
        <input value={newProvider.name} onChange={(e) => onNewProviderChange((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g., Ollama" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.baseUrl")}</label>
        <input value={newProvider.apiBase} onChange={(e) => onNewProviderChange((prev) => ({ ...prev, apiBase: e.target.value }))} placeholder="http://localhost:11434/v1" className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
        <input type="password" value={newProvider.apiKey} onChange={(e) => onNewProviderChange((prev) => ({ ...prev, apiKey: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{t("settings.modelId")}</label>
        <div className="flex gap-2">
          <input list="provider-model-options" value={newProvider.modelId} onChange={(e) => onNewProviderChange((prev) => ({ ...prev, modelId: e.target.value }))} placeholder="gpt-4o-mini" className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none" />
          <ProviderIconButton label={t("settings.fetchModels")} onClick={onFetchModels}>
            {fetchingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListRestart className="h-4 w-4" />}
          </ProviderIconButton>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={onAdd} disabled={!newProvider.name || !newProvider.apiBase || !newProvider.modelId} className="h-auto px-4 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors">{t("settings.add")}</Button>
        <Button variant="outline" onClick={onCancel} className="h-auto px-4 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors">{t("settings.cancel")}</Button>
      </div>
    </div>
  );
}

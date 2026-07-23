import React from "react";
import { Check, ListRestart, Loader2, Pencil, PlugZap, Trash2, X } from "lucide-react";
import { ProviderIconButton, TestStatusBadge } from "./ProviderFormControls";

interface CustomProviderMeta {
  id: string;
  name: string;
  apiBase: string;
  modelId: string;
  apiKey: string;
}

interface CustomProviderEditForm {
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
}

interface CustomProviderPanelProps {
  provider: CustomProviderMeta;
  editingId: string | null;
  editForm: CustomProviderEditForm;
  onEditFormChange: (updater: (prev: CustomProviderEditForm) => CustomProviderEditForm) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: (provider: CustomProviderMeta) => void;
  fetchingModels: boolean;
  onFetchModelsForEdit: () => void;
  onTest: (provider: CustomProviderMeta) => void;
  testStatus: { ok: boolean | null; text: string } | null;
  onRemove: (id: string) => void;
  t: (key: string) => string;
}

/** View/edit panel for a single already-configured custom (OpenAI-compatible)
 * provider entry, rendered when that provider is selected. */
export function CustomProviderPanel({
  provider: p,
  editingId,
  editForm,
  onEditFormChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  fetchingModels,
  onFetchModelsForEdit,
  onTest,
  testStatus,
  onRemove,
  t,
}: CustomProviderPanelProps) {
  return (
    <div className="space-y-3">
      {editingId === p.id ? (
        <>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.name")}</label>
            <input value={editForm.name} onChange={(e) => onEditFormChange((prev) => ({ ...prev, name: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.baseUrl")}</label>
            <input value={editForm.apiBase} onChange={(e) => onEditFormChange((prev) => ({ ...prev, apiBase: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.apiKey")}</label>
            <input type="password" value={editForm.apiKey} onChange={(e) => onEditFormChange((prev) => ({ ...prev, apiKey: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.modelId")}</label>
            <div className="flex gap-2">
              <input list="provider-model-options" value={editForm.modelId} onChange={(e) => onEditFormChange((prev) => ({ ...prev, modelId: e.target.value }))} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none" />
              <ProviderIconButton label={t("settings.fetchModels")} onClick={onFetchModelsForEdit}>
                {fetchingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListRestart className="h-4 w-4" />}
              </ProviderIconButton>
            </div>
          </div>
          <div className="flex gap-2">
            <ProviderIconButton label={t("settings.save")} onClick={onSaveEdit}><Check className="h-4 w-4" /></ProviderIconButton>
            <ProviderIconButton label={t("settings.cancel")} onClick={onCancelEdit}><X className="h-4 w-4" /></ProviderIconButton>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.baseUrl")}</label>
            <p className="text-sm font-mono">{p.apiBase}</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("settings.defaultModel")}</label>
            <p className="text-sm font-mono">{p.modelId}</p>
          </div>
          <div className="flex items-center gap-1 pt-1">
            <ProviderIconButton label={t("settings.testConnection")} onClick={() => onTest(p)}><PlugZap className="h-4 w-4" /></ProviderIconButton>
            <ProviderIconButton label={t("settings.edit")} onClick={() => onStartEdit(p)}><Pencil className="h-4 w-4" /></ProviderIconButton>
            <ProviderIconButton label={t("settings.delete")} danger onClick={() => onRemove(p.id)}><Trash2 className="h-4 w-4" /></ProviderIconButton>
          </div>
          {testStatus && <TestStatusBadge status={testStatus} />}
        </>
      )}
    </div>
  );
}

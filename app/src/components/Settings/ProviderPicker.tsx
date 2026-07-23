import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProviderDef } from "./providerConstants";

interface ProviderPickerProps {
  allCards: ProviderDef[];
  selectedProvider: string;
  selectedDot: string;
  fetchedModels: string[];
  t: (key: string) => string;
  onChange: (value: string) => void;
}

export function ProviderPicker({ allCards, selectedProvider, selectedDot, fetchedModels, t, onChange }: ProviderPickerProps) {
  return (
    <>
      <div className="relative w-full max-w-xs">
        <span
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pointer-events-none z-10"
          style={{ background: selectedDot }}
        />
        <Select value={selectedProvider} onValueChange={onChange}>
          <SelectTrigger className="w-full h-10 pl-9 pr-8 rounded-xl border border-input bg-card text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allCards.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
            <SelectItem value="__new__">+ {t("settings.custom")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <datalist id="provider-model-options">{fetchedModels.map((model) => <option key={model} value={model} />)}</datalist>
    </>
  );
}

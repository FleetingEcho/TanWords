import { Loader2, ListRestart } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProviderIconButton } from "./ProviderFormControls";

interface Props {
  value: string;
  onChange: (model: string) => void;
  options: string[];
  fetchingModels: boolean;
  onFetchModels: () => void;
  placeholder: string;
  t: (key: string) => string;
}

/** Model picker used by every provider panel. It only offers models returned by
 *  "Fetch available models" (plus the already-saved value), so the user never
 *  has to type a model id by hand. */
export function ProviderModelSelect({
  value,
  onChange,
  options,
  fetchingModels,
  onFetchModels,
  placeholder,
  t,
}: Props) {
  const modelOptions = options.includes(value)
    ? options
    : value
      ? [value, ...options]
      : options;

  return (
    <div className="flex gap-2">
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger
          aria-label={placeholder}
          className="h-9 min-w-0 flex-1 rounded-lg border-input bg-background px-3 text-sm font-mono"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {modelOptions.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("settings.modelsEmpty")}</div>
          ) : (
            modelOptions.map((model) => (
              <SelectItem key={model} value={model} className="font-mono text-xs">
                {model}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <ProviderIconButton label={t("settings.fetchModels")} onClick={onFetchModels}>
        {fetchingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListRestart className="h-4 w-4" />}
      </ProviderIconButton>
    </div>
  );
}

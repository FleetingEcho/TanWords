import React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderDef } from "./providerConstants";

/** One provider, with everything you'd otherwise have to open a dropdown and
 *  click through to find out: whether it has a key, which model it will use,
 *  and whether it's the one the app reaches for by default. */
export function ProviderRow({
  provider,
  connected,
  isDefault,
  expanded,
  onToggleExpanded,
  onSetDefault,
  t,
  children,
}: {
  provider: ProviderDef;
  connected: boolean;
  isDefault: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSetDefault: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** The provider's config form, rendered only while expanded. */
  children: React.ReactNode;
}) {
  return (
    <div className={`border-b border-border/60 last:border-b-0 ${expanded ? "bg-muted/20" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`} />
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: provider.dot }} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{provider.name}</span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground">{provider.model || t("settings.noModel")}</span>
          </span>
        </button>

        {connected ? (
          <span className="hidden shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t("settings.connected")}
          </span>
        ) : (
          <span className="hidden shrink-0 text-[11px] text-muted-foreground/60 sm:block">{t("settings.notConfigured")}</span>
        )}

        {/* Being the default is a separate decision from looking at the
          * settings — expanding a row used to silently change it. */}
        {isDefault ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("settings.defaultProvider")}
          </span>
        ) : (
          <Button
            variant="ghost"
            onClick={onSetDefault}
            disabled={!connected}
            title={connected ? undefined : t("settings.setDefaultNeedsKey")}
            className="h-7 shrink-0 rounded-full px-2.5 text-[10px] font-semibold text-muted-foreground hover:text-primary disabled:opacity-40"
          >
            {t("settings.setAsDefault")}
          </Button>
        )}
      </div>

      {expanded && <div className="px-4 pb-4 pl-10">{children}</div>}
    </div>
  );
}

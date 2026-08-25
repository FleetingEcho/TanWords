import React from "react";
import { Search, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useWorkspaceStore, isPageAvailableOnHost } from "@/store/workspaceStore";
import { PAGE_CATALOG, getPageDefinition } from "@/pages/pageCatalog";
import type { NavPage } from "@/store/navStore";
import { Button } from "@/components/ui/button";
import { useBlockBrowserPanel } from "@/store/browserPanelStore";
import { useBlockDshPanel } from "@/store/dshPanelBlockStore";

/** The page picker: searchable, categorized by host kind, with host-capability
 *  filtering and disabled-state explanations. Singleton pages already hosted
 *  somewhere are disabled with an offer to "Move here" (the singleton rule
 *  relocates the live instance instead of cloning).
 *
 *  The picker opens over the pane content, so it must block the native
 *  Browser/DSH panels (they composite above HTML). The block hooks run while
 *  the picker is mounted and release on close, exactly like a Dialog. */
export interface PagePickerProps {
  /** The pane the picker is placing into. For a singleton already hosted
   *  elsewhere, "Move here" relocates it to this pane. */
  paneId: string;
  /** True when opening into a non-empty pane (a swap) vs. an empty pane (a
   *  fill). The label adapts; the action is the same `place`. */
  replacing: boolean;
  onClose: () => void;
  onPlace: (pageId: NavPage) => void;
  /** Embed the cards directly in an empty pane instead of presenting them as
   * a modal replacement picker. */
  inline?: boolean;
  /** Whether the picker is a split placement (offered as a split-edge choice)
   *  or a center fill. Phase 3 uses center fills from the pane's "Add page"
   *  affordance; split edges come from drag, which has its own affordance. */
}

export function PagePicker({ paneId, replacing, onClose, onPlace, inline = false }: PagePickerProps) {
  const t = useT();
  const [query, setQuery] = React.useState("");
  // Block native panels while the picker overlay is up.
  useBlockBrowserPanel();
  useBlockDshPanel();

  const singletonLocations = useWorkspaceStore((s) => s.singletonLocations);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return PAGE_CATALOG.filter((def) => {
      if (def.workspaceWidget === false) return false;
      // Filter by the i18n label if a query is typed. The label is looked up
      // via the key; fall back to the id so typing "dsh" still matches.
      if (q) {
        const label = t(`nav.${def.id}`).toLowerCase();
        if (!label.includes(q) && !def.id.includes(q)) return false;
      }
      return true;
    });
  }, [query, t]);

  // Group by host kind so the picker reads as categories. Labels are i18n'd so
  // the category headings localize with the rest of the app.
  const groups = React.useMemo(() => {
    const order: { kind: string; label: string }[] = [
      { kind: "react", label: t("workspaces.picker.group.pages") },
      { kind: "retained", label: t("workspaces.picker.group.tools") },
      { kind: "native", label: t("workspaces.picker.group.native") },
    ];
    return order.map((g) => ({
      ...g,
      defs: filtered.filter((d) => d.host === g.kind),
    })).filter((g) => g.defs.length > 0);
  }, [filtered, t]);

  const panel = (
      <div className={inline
        ? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background/20"
        : "flex max-h-[calc(100%-1rem)] w-[calc(100%-1rem)] max-w-[680px] flex-col overflow-hidden rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] shadow-2xl"}
      >
        {!inline && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--sidebar-border))]">
          <h3 className="font-semibold text-sm flex-1">{t("workspaces.picker.title")}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>
        )}
        <div className="px-4 py-2 border-b border-[hsl(var(--sidebar-border))]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("workspaces.picker.search")}
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-[hsl(var(--muted))] border border-[hsl(var(--sidebar-border))] focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {groups.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">{t("workspaces.picker.empty")}</p>
          )}
          {groups.map((g) => (
            <section key={g.kind} className="mb-3">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>
              <div
                className="grid gap-2 px-1"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}
              >
              {g.defs.map((def) => {
                const available = isPageAvailableOnHost(def.id);
                const locs = def.multiplicity === "singleton" ? singletonLocations(def.id) : [];
                const hostedElsewhere = locs.some((l) => l.paneId !== paneId);
                const Icon = def.icon;
                const disabled = !available || (def.multiplicity === "singleton" && hostedElsewhere && !replacing);
                let disabledReason: string | null = null;
                if (!available) disabledReason = t("workspaces.picker.disabled.host");
                else if (def.multiplicity === "singleton" && locs.length > 0) disabledReason = t("workspaces.picker.disabled.singleton");
                return (
                  <button
                    key={def.id}
                    type="button"
                    disabled={disabled && !hostedElsewhere}
                    aria-label={
                      def.multiplicity === "singleton" && hostedElsewhere
                        ? t("workspaces.picker.moveHereHint", { page: t(`nav.${def.id}`) })
                        : t(`nav.${def.id}`)
                    }
                    onClick={() => {
                      if (disabled && !hostedElsewhere) return;
                      onPlace(def.id);
                      onClose();
                    }}
                    className={`group relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-3 text-center transition-colors ${
                      disabled && !hostedElsewhere
                        ? "cursor-not-allowed border-border/40 opacity-50"
                        : "border-border/60 bg-background/35 hover:border-primary/40 hover:bg-primary/5"
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0 w-full">
                      <span className="block truncate text-sm font-medium">{t(`nav.${def.id}`)}</span>
                      {disabledReason && (
                        <span className="mt-0.5 block line-clamp-2 text-[10px] leading-tight text-muted-foreground">{disabledReason}</span>
                      )}
                    </span>
                    {def.multiplicity === "singleton" && hostedElsewhere && (
                      <span className="text-[10px] font-medium text-primary">{t("workspaces.picker.moveHere")}</span>
                    )}
                  </button>
                );
              })}
              </div>
            </section>
          ))}
        </div>
      </div>
  );

  if (inline) {
    return (
      <div role="region" aria-label={t("workspaces.picker.title")} className="h-full min-h-0 w-full">
        {panel}
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("workspaces.picker.title")}
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {panel}
    </div>
  );
}

import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { Button } from "@/components/ui/button";
import type { DashboardStats } from "@/hooks/useDB";

/** Dashboard card: recently touched documents. `docs` comes from the parent's
 *  single shared `getDashboardStats()` call rather than fetching its own copy. */
export function RecentDocumentsWidget({ docs }: { docs: DashboardStats["recent_docs"] | undefined }) {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h2 className="text-sm font-semibold">{t("dash.recentDocs")}</h2>
        <Button
          variant="link"
          onClick={() => navigate("documents")}
          className="h-auto p-0 text-[11px] font-semibold text-primary hover:underline"
        >
          {t("dash.viewAll")}
        </Button>
      </div>
      {docs && docs.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground">{t("dash.empty.docs")}</p>
      ) : (
        <div className="divide-y divide-border">
          {(docs ?? []).map((d) => (
            <Button
              key={d.id}
              variant="ghost"
              onClick={() => navigate("documents")}
              className="h-auto w-full rounded-none flex items-center justify-start gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
            >
              <span className="flex-1 min-w-0 text-sm font-medium truncate">{d.title}</span>
              <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                {d.updated_at.slice(0, 10)}
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import type { DashboardStats } from "@/hooks/useDB";
import { DocIcon } from "@/components/ui/icons";
import { DashboardCard, DashboardRow, DashboardEmpty, DashboardSkeleton, DashboardFill, DASHBOARD_BODY_ROWS } from "./DashboardCard";

/** Dashboard card: recently touched documents. `docs` comes from the parent's
 *  single shared `getDashboardStats()` call rather than fetching its own copy. */
export function RecentDocumentsWidget({ docs, maxRows = DASHBOARD_BODY_ROWS }: {
  docs: DashboardStats["recent_docs"] | undefined;
  maxRows?: number;
}) {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);
  const shown = (docs ?? []).slice(0, maxRows);

  return (
    <DashboardCard
      title={t("dash.recentDocs")}
      icon={<DocIcon className="w-3.5 h-3.5 text-muted-foreground" />}
      onViewAll={() => navigate("documents")}
    >
      {docs === undefined ? (
        <DashboardSkeleton rows={maxRows} />
      ) : shown.length === 0 ? (
        <DashboardEmpty>{t("dash.empty.docs")}</DashboardEmpty>
      ) : (
        <>
          {shown.map((d) => (
            <DashboardRow key={d.id} onClick={() => navigate("documents")}>
              <span className="flex-1 min-w-0 text-sm font-medium truncate">{d.title}</span>
              <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                {d.updated_at.slice(0, 10)}
              </span>
            </DashboardRow>
          ))}
          <DashboardFill />
        </>
      )}
    </DashboardCard>
  );
}

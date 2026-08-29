import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import type { DashboardStats } from "@/hooks/useDB";
import { DocIcon } from "@/components/ui/icons";
import { DashboardCard, DashboardRow, DashboardEmpty, DashboardSkeleton, DashboardFill, DASHBOARD_BODY_ROWS } from "./DashboardCard";

const SHOW_DOC_LIST_FLAG = "tanwords_show_doc_list";

/** `updated_at` arrives as a UTC timestamp string ("YYYY-MM-DD HH:mm:ss") —
 *  parse it as UTC and print the local date. Slicing the string (the old
 *  code) printed UTC, off by a day for users ahead of it. */
function formatLocalDate(updatedAt: string): string {
  const parsed = new Date(updatedAt.includes("T") ? updatedAt : `${updatedAt.replace(" ", "T")}Z`);
  if (isNaN(parsed.getTime())) return updatedAt.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

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
      onViewAll={() => {
        localStorage.setItem(SHOW_DOC_LIST_FLAG, "1");
        navigate("documents");
      }}
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
                {/* `updated_at` is written by the backend's UTC clock — parse
                    it as UTC and print the local date, or users ahead of UTC
                    see yesterday's date on anything touched after 16:00. */}
                {formatLocalDate(d.updated_at)}
              </span>
            </DashboardRow>
          ))}
          <DashboardFill />
        </>
      )}
    </DashboardCard>
  );
}

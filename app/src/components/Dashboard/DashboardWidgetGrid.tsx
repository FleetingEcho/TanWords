import React from "react";
import { useSettingsStore, type DashboardWidgetId } from "@/store/settingsStore";
import type { DashboardStats } from "@/hooks/useDB";
import { RssWidget } from "./RssWidget";
import { LatestWordsWidget } from "./LatestWordsWidget";
import { RecentlyReadWidget } from "./RecentlyReadWidget";
import { RecentDocumentsWidget } from "./RecentDocumentsWidget";
import { PatternsWidget } from "./PatternsWidget";
import { ListenNextWidget } from "./ListenNextWidget";

/** The Dashboard's "Recents" grid: six cards of identical height in two
 *  columns, ordered by `settingsStore`'s persisted `dashboardWidgetLayout`.
 *
 *  The layout is read-only here — it was once drag-reorderable, but that cost
 *  three @dnd-kit packages for a feature this small. The stored order is kept
 *  so an existing arrangement survives, and so a lighter reorder UI (Settings,
 *  up/down) can be added later without a migration. */
export function DashboardWidgetGrid({ stats }: { stats: DashboardStats | null }) {
  const layout = useSettingsStore((s) => s.dashboardWidgetLayout);

  const renderWidget = (id: DashboardWidgetId): React.ReactNode => {
    switch (id) {
      case "feedUpdates":
        return <RssWidget />;
      case "latestWords":
        return <LatestWordsWidget words={stats?.recent_words} />;
      case "recentlyRead":
        return <RecentlyReadWidget />;
      case "recentDocuments":
        return <RecentDocumentsWidget docs={stats?.recent_docs} />;
      case "patterns":
        return <PatternsWidget />;
      case "listenNext":
        return <ListenNextWidget />;
    }
  };

  const renderColumn = (items: DashboardWidgetId[]) => (
    <div className="space-y-3">
      {items.map((widgetId) => (
        <div key={widgetId}>{renderWidget(widgetId)}</div>
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      {renderColumn(layout.left)}
      {renderColumn(layout.right)}
    </div>
  );
}

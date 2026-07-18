import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { CloseIcon, RefreshIcon } from "@/components/ui/icons";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { RssFeed } from "@/hooks/useDB.types";
import { domainOf } from "./feedUtils";
import { Button } from "@/components/ui/button";

interface Props {
  feeds: RssFeed[];
  unreadByFeed: Map<number, number>;
  /** Feed ids whose last background sync failed. */
  failedFeeds: Set<number>;
  selected: number | "all";
  syncing: boolean;
  onSelect: (id: number | "all") => void;
  onDelete: (id: number) => void;
  onAdd: () => void;
  onRefresh: () => void;
}

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="shrink-0 text-[10px] font-semibold tabular-nums rounded-full bg-primary/10 text-primary px-1.5 py-0.5 min-w-[1.25rem] text-center">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Horizontal feed switcher: one pill per feed across the top, content below. */
export function FeedTabs({ feeds, unreadByFeed, failedFeeds, selected, syncing, onSelect, onDelete, onAdd, onRefresh }: Props) {
  const t = useT();
  const totalUnread = [...unreadByFeed.values()].reduce((a, b) => a + b, 0);
  const [pendingDelete, setPendingDelete] = useState<RssFeed | null>(null);

  const pill = (active: boolean) =>
    `flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
      active
        ? "border-primary/40 bg-primary/10 font-semibold text-primary"
        : "border-border font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <button onClick={() => onSelect("all")} className={pill(selected === "all")}>
          {t("feeds.all")}
          <UnreadBadge n={totalUnread} />
        </button>

        {feeds.map((f) => {
          const active = selected === f.id;
          return (
            <div key={f.id} className="group relative">
              <button onClick={() => onSelect(f.id)} className={pill(active)} title={domainOf(f.url)}>
                {f.is_podcast && <span className="text-[10px] leading-none" aria-label={t("feeds.section.podcasts")}>🎧</span>}
                <span className="max-w-44 truncate">{f.title || domainOf(f.url)}</span>
                {failedFeeds.has(f.id) && (
                  <span title={t("feeds.syncFailed")} aria-label={t("feeds.syncFailed")} className="shrink-0 text-xs leading-none text-amber-500">⚠</span>
                )}
                {/* Fixed-width slot: the badge keeps its space when hovered
                    (invisible, not hidden) and the delete × overlays it, so
                    the pill never changes width. */}
                <span className="relative flex h-4 min-w-4 shrink-0 items-center justify-center">
                  <span className="group-hover:invisible">
                    <UnreadBadge n={unreadByFeed.get(f.id) ?? 0} />
                  </span>
                  <span
                    role="button"
                    aria-label={t("feeds.deleteFeed")}
                    title={t("feeds.deleteFeed")}
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(f); }}
                    className="absolute inset-0 hidden items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive group-hover:flex"
                  >
                    <CloseIcon className="h-2.5 w-2.5" />
                  </span>
                </span>
              </button>
            </div>
          );
        })}

        <button onClick={onAdd} className="flex h-8 items-center rounded-full border border-dashed border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
          + {t("feeds.addFeed")}
        </button>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-2">
        {syncing && <span className="text-[11px] text-muted-foreground">{t("feeds.refreshing")}</span>}
        <Button
          variant="ghost"
          onClick={onRefresh}
          disabled={syncing || feeds.length === 0}
          title={t("feeds.refresh")}
          className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RefreshIcon className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("feeds.deleteFeed")}
        message={t("feeds.confirmDelete", { name: pendingDelete?.title || domainOf(pendingDelete?.url ?? "") })}
        confirmLabel={t("feeds.deleteFeed")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

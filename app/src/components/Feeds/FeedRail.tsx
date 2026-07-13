import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import { CloseIcon } from "@/components/ui/icons";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { RssFeed } from "@/hooks/useDB.types";
import { domainOf } from "./feedUtils";

interface Props {
  feeds: RssFeed[];
  unreadByFeed: Map<number, number>;
  /** Feed ids whose last background sync failed. */
  failedFeeds: Set<number>;
  selected: number | "all";
  onSelect: (id: number | "all") => void;
  onDelete: (id: number) => void;
  onAdd: () => void;
}

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="shrink-0 text-[10px] font-semibold tabular-nums rounded-full bg-primary/10 text-primary px-1.5 py-0.5 min-w-[1.25rem] text-center">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="px-2.5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground select-none">
      {label}
    </p>
  );
}

export function FeedRail({ feeds, unreadByFeed, failedFeeds, selected, onSelect, onDelete, onAdd }: Props) {
  const t = useT();
  const totalUnread = [...unreadByFeed.values()].reduce((a, b) => a + b, 0);
  const [pendingDelete, setPendingDelete] = useState<RssFeed | null>(null);

  const articleFeeds = feeds.filter((f) => !f.is_podcast);
  const podcastFeeds = feeds.filter((f) => f.is_podcast);

  const renderFeed = (f: RssFeed) => (
    <div key={f.id} className="group relative">
      <button
        onClick={() => onSelect(f.id)}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
          selected === f.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
        }`}
      >
        <span className="flex-1 min-w-0">
          <span className={`block text-sm truncate ${selected === f.id ? "font-semibold" : "font-medium"}`}>
            {f.title || domainOf(f.url)}
          </span>
          <span className="block text-[10px] text-muted-foreground truncate">{domainOf(f.url)}</span>
        </span>
        {failedFeeds.has(f.id) && (
          <span title={t("feeds.syncFailed")} className="shrink-0 text-amber-500 text-xs leading-none" aria-label={t("feeds.syncFailed")}>
            ⚠
          </span>
        )}
        <span className="group-hover:hidden">
          <UnreadBadge n={unreadByFeed.get(f.id) ?? 0} />
        </span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setPendingDelete(f); }}
        title={t("feeds.deleteFeed")}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 hidden group-hover:flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
      >
        <CloseIcon className="w-3 h-3" />
      </button>
    </div>
  );

  return (
    <div className="w-80 shrink-0 border-r border-border flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <h2 className="text-sm font-bold">{t("feeds.title")}</h2>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5 px-2">
        <button
          onClick={() => onSelect("all")}
          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${
            selected === "all" ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted"
          }`}
        >
          <span className="flex-1 truncate">{t("feeds.all")}</span>
          <UnreadBadge n={totalUnread} />
        </button>

        {podcastFeeds.length === 0 ? (
          articleFeeds.map(renderFeed)
        ) : (
          <>
            {articleFeeds.length > 0 && (
              <>
                <SectionHeader label={t("feeds.section.articles")} />
                {articleFeeds.map(renderFeed)}
              </>
            )}
            <SectionHeader label={t("feeds.section.podcasts")} />
            {podcastFeeds.map(renderFeed)}
          </>
        )}
      </div>

      <div className="p-3 border-t border-border">
        <button
          onClick={onAdd}
          className="w-full h-8 rounded-lg text-xs font-semibold border border-input hover:bg-muted hover:border-primary/30 transition-colors"
        >
          + {t("feeds.addFeed")}
        </button>
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

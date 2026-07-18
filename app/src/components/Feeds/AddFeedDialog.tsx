import React, { useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { CloseIcon } from "@/components/ui/icons";
import type { RssFeedMeta } from "@/hooks/useDB.types";
import { DEFAULT_FEEDS, FEED_CATEGORIES, type FeedCategory } from "./defaultFeeds";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a feed row is inserted; parent reloads the feed list and syncs. */
  onAdded: () => void;
  /** URLs already subscribed — hides those presets from the suggestion list. */
  subscribedUrls: Set<string>;
}

export function AddFeedDialog({ open, onClose, onAdded, subscribedUrls }: Props) {
  const t = useT();
  const db = useDB();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<RssFeedMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<FeedCategory>>(new Set());

  const toggleCategory = (category: FeedCategory) =>
    setCollapsed((current) => {
      const next = new Set(current);
      next.has(category) ? next.delete(category) : next.add(category);
      return next;
    });

  useEffect(() => {
    if (open) {
      setUrl("");
      setPreview(null);
      setError("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const fetchPreview = async (target = url) => {
    if (!target.trim()) return;
    setLoading(true);
    setError("");
    setPreview(null);
    const meta = await db.fetchRssFeedMeta(target.trim());
    setLoading(false);
    if (!meta) {
      setError(t("feeds.fetchFailed"));
      return;
    }
    setUrl(target.trim());
    setPreview(meta);
  };

  const subscribe = async () => {
    if (!preview) return;
    await db.addRssFeed(url.trim(), preview.title, preview.site_link, preview.description);
    onAdded();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto bg-card border border-border rounded-2xl shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold">{t("feeds.addTitle")}</h3>
          <Button variant="ghost" onClick={onClose} className="w-6 h-6 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <CloseIcon className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
            onKeyDown={(e) => e.key === "Enter" && fetchPreview()}
            placeholder={t("feeds.urlPlaceholder")}
            className="flex-1 h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button
            variant="outline"
            onClick={() => fetchPreview()}
            disabled={loading || !url.trim()}
            className="h-9 px-3.5 rounded-lg text-xs font-semibold border border-input hover:bg-muted disabled:opacity-50 transition-colors shrink-0"
          >
            {loading ? t("feeds.fetching") : t("feeds.fetch")}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}

        {preview && (
          <div className="mt-4 rounded-xl border border-border p-3.5">
            <p className="text-sm font-semibold">{preview.title}</p>
            {preview.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{preview.description}</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              {t("feeds.previewCount", { count: preview.entries.length })}
            </p>
            <Button
              onClick={subscribe}
              className="mt-3 h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("feeds.subscribe")}
            </Button>
          </div>
        )}

        {!preview && DEFAULT_FEEDS.some((p) => !subscribedUrls.has(p.url)) && (
          <div className="mt-5 space-y-4">
            {FEED_CATEGORIES.map((category) => {
              const group = DEFAULT_FEEDS.filter((p) => p.category === category && !subscribedUrls.has(p.url));
              if (!group.length) return null;
              const isCollapsed = collapsed.has(category);
              return (
                <div key={category}>
                  <button
                    onClick={() => toggleCategory(category)}
                    className="mb-2 flex w-full items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="text-[9px]">{isCollapsed ? "▸" : "▾"}</span>
                    {t(`feeds.cat.${category}`)}
                    <span className="font-normal">({group.length})</span>
                  </button>
                  {!isCollapsed && <div className="space-y-1">
                    {group.map((p) => (
                      <Button
                        key={p.url}
                        variant="ghost"
                        onClick={() => fetchPreview(p.url)}
                        disabled={loading}
                        className="h-auto w-full block text-left px-3 py-2 rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
                      >
                        <p className="text-xs font-semibold">{p.title}</p>
                        <p className="text-[10px] text-muted-foreground line-clamp-1">{p.desc}</p>
                      </Button>
                    ))}
                  </div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

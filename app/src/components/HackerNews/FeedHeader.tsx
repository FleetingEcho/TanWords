import React from "react";
import { useT } from "@/hooks/useT";
import { HNFeed, HNSearchSort } from "@/hooks/useHackerNews";
import { SearchIcon, RefreshIcon, LinkIcon } from "@/components/ui/icons";

const FEEDS: HNFeed[] = ["top", "best", "new"];
const SORTS: HNSearchSort[] = ["pop", "new"];

interface Props {
  // URL-open bar
  showUrlBar: boolean;
  urlInput: string;
  onUrlInputChange: (v: string) => void;
  onShowUrlBar: (v: boolean) => void;
  onOpenUrl: (url: string) => void;
  // Search
  qInput: string;
  onQInputChange: (v: string) => void;
  searching: boolean;
  searchLoading: boolean;
  searchError: boolean;
  searchTotal: number;
  sort: HNSearchSort;
  onSortChange: (s: HNSearchSort) => void;
  // Feed
  feed: HNFeed;
  onFeedChange: (f: HNFeed) => void;
  loading: boolean;
  updatedLabel: string;
  onRefresh: () => void;
}

/** Page header: title block plus the URL-open / search / sort / feed / refresh control cluster. */
export function FeedHeader({
  showUrlBar, urlInput, onUrlInputChange, onShowUrlBar, onOpenUrl,
  qInput, onQInputChange, searching, searchLoading, searchError, searchTotal, sort, onSortChange,
  feed, onFeedChange, loading, updatedLabel, onRefresh,
}: Props) {
  const t = useT();

  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-orange-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
            Y
          </div>
          <h1 className="text-2xl font-bold">{t("hn.title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{t("hn.subtitle")}</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Open any URL in reader mode */}
        {showUrlBar ? (
          <form
            onSubmit={(e) => { e.preventDefault(); onOpenUrl(urlInput); }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              autoFocus
              value={urlInput}
              onChange={(e) => onUrlInputChange(e.target.value)}
              onBlur={() => { if (!urlInput.trim()) onShowUrlBar(false); }}
              placeholder={t("reader.urlPlaceholder")}
              className="h-8 w-56 px-3 text-xs rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-orange-500/40 placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              className="h-8 px-3 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("reader.open")}
            </button>
          </form>
        ) : (
          <button
            onClick={() => onShowUrlBar(true)}
            title={t("reader.openUrl")}
            className="h-8 px-3 rounded-lg border border-border flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LinkIcon className="w-3.5 h-3.5" /> {t("reader.openUrl")}
          </button>
        )}

        {/* Search box */}
        <div className="relative">
          <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={qInput}
            onChange={(e) => onQInputChange(e.target.value)}
            placeholder={t("hn.search.placeholder")}
            className="h-8 w-52 pl-8 pr-7 text-xs rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-orange-500/40 placeholder:text-muted-foreground transition-[width] focus:w-64"
          />
          {qInput && (
            <button
              onClick={() => onQInputChange("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted text-[10px]"
            >
              ✕
            </button>
          )}
        </div>

        {searching ? (
          <>
            {!searchLoading && !searchError && (
              <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                {t("hn.search.results", { n: searchTotal })}
              </span>
            )}
            <div className="flex items-center border border-input rounded-lg overflow-hidden">
              {SORTS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSortChange(s)}
                  className={`px-3.5 h-8 text-xs font-semibold transition-colors ${
                    sort === s
                      ? "bg-orange-500 text-white"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t(`hn.sort.${s}`)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {updatedLabel && (
              <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                {updatedLabel}
              </span>
            )}
            <button
              onClick={onRefresh}
              disabled={loading}
              title={t("hn.refresh")}
              className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              <RefreshIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <div className="flex items-center border border-input rounded-lg overflow-hidden">
              {FEEDS.map((f) => (
                <button
                  key={f}
                  onClick={() => onFeedChange(f)}
                  className={`px-3.5 h-8 text-xs font-semibold transition-colors ${
                    feed === f
                      ? "bg-orange-500 text-white"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t(`hn.feed.${f}`)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

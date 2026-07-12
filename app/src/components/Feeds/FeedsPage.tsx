import React, { useState, useEffect, useCallback } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useRssFeed } from "@/hooks/useRssFeed";
import { useNavStore } from "@/store/navStore";
import { useReadingStore } from "@/store/readingStore";
import { ReaderView } from "@/components/HackerNews/ReaderView";
import { makeSyntheticStory } from "@/lib/learnHelper";
import type { RssFeed, RssFeedMeta, RssEntry } from "@/hooks/useDB.types";

const PRESET_FEEDS = [
  { title: "Aeon", url: "https://aeon.co/feed.rss", desc: "Essays on philosophy, science, and culture" },
  { title: "Nautilus", url: "https://nautil.us/feed/", desc: "Science connected to everyday life" },
  { title: "The Guardian Long Read", url: "https://www.theguardian.com/news/series/the-long-read/rss", desc: "In-depth journalism" },
  { title: "Paul Graham Essays", url: "http://www.aaronsw.com/2002/feeds/pgessays.rss", desc: "Startup and tech essays" },
];

/** Format a date string as relative time ("3 days ago" etc.) */
function relativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function FeedsPage() {
  const t = useT();
  const db = useDB();
  const { fetchFeed } = useRssFeed();
  const { navigate } = useNavStore();
  const { setDraft } = useReadingStore();

  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<number | "all" | null>(null);
  const [entries, setEntries] = useState<{ feed: RssFeed; entry: RssEntry }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addPreview, setAddPreview] = useState<RssFeedMeta | null>(null);

  // Browser state for ReaderView
  const [browse, setBrowse] = useState<{ url: string; title: string; domain: string } | null>(null);
  // Learn drawer state
  const [learnStory, setLearnStory] = React.useState<any>(null);
  const [learnPrefill, setLearnPrefill] = useState("");

  // Load feeds on mount
  useEffect(() => {
    db.getRssFeeds().then(setFeeds);
  }, []);

  // Load entries when feed selection changes
  useEffect(() => {
    if (selectedFeedId === null) return;
    setLoading(true);
    setError("");

    (async () => {
      try {
        if (selectedFeedId === "all") {
          // Merge entries from all feeds
          const all: { feed: RssFeed; entry: RssEntry }[] = [];
          for (const feed of feeds) {
            const meta = await fetchFeed(feed.url);
            if (meta) {
              for (const entry of meta.entries) {
                all.push({ feed, entry });
              }
              // Update feed title if empty
              if (!feed.title && meta.title) {
                await db.updateRssFeedTitle(feed.id, meta.title);
              }
            }
          }
          all.sort((a, b) => new Date(b.entry.published).getTime() - new Date(a.entry.published).getTime());
          setEntries(all);
        } else {
          const feed = feeds.find((f) => f.id === selectedFeedId);
          if (!feed) return;
          const meta = await fetchFeed(feed.url);
          if (!meta) {
            setError(t("feeds.fetchFailed"));
            setEntries([]);
            return;
          }
          if (!feed.title && meta.title) {
            await db.updateRssFeedTitle(feed.id, meta.title);
          }
          setEntries(meta.entries.map((e) => ({ feed, entry: e })));
        }
      } catch {
        setError(t("feeds.fetchFailed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedFeedId, feeds]);

  const handleAddFeed = async () => {
    if (!addUrl.trim()) return;
    setAddLoading(true);
    setError("");
    try {
      const meta = await fetchFeed(addUrl.trim(), true);
      if (!meta) {
        setError(t("feeds.fetchFailed"));
        setAddLoading(false);
        return;
      }
      setAddPreview(meta);
    } catch {
      setError(t("feeds.fetchFailed"));
    } finally {
      setAddLoading(false);
    }
  };

  const confirmAdd = async () => {
    if (!addPreview) return;
    await db.addRssFeed(addUrl.trim(), addPreview.title, addPreview.site_link, addPreview.description);
    const updated = await db.getRssFeeds();
    setFeeds(updated);
    setAddUrl("");
    setAddPreview(null);
    setShowAdd(false);
  };

  const handleDelete = async (id: number) => {
    await db.deleteRssFeed(id);
    setFeeds((prev) => prev.filter((f) => f.id !== id));
    if (selectedFeedId === id) setSelectedFeedId(null);
  };

  const handleOpenArticle = (entry: RssEntry, feed: RssFeed) => {
    const domain = new URL(entry.url).hostname.replace(/^www\./, "");
    setBrowse({ url: entry.url, title: entry.title, domain });
  };

  const handleLearn = (title: string, text: string) => {
    if (!browse) return;
    setLearnPrefill(text);
    const story = makeSyntheticStory(title, browse.url);
    setLearnStory(story);
  };

  const handleStartAnalysis = () => {
    if (!learnStory || !learnPrefill.trim()) return;
    setDraft({
      title: learnStory.title,
      text: learnPrefill,
      sourceUrl: learnStory.url,
      origin: "hackernews",
    });
    navigate("reading");
    setLearnStory(null);
    setLearnPrefill("");
  };

  const domain = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };

  return (
    <div className="flex h-full animate-fade-in">
      {/* Left: feed list */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        <div className="px-4 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">{t("feeds.title")}</h2>
          <button
            onClick={() => { setShowAdd(!showAdd); setAddPreview(null); setAddUrl(""); setError(""); }}
            className="mt-2 w-full h-8 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
          >
            + {t("feeds.addFeed")}
          </button>
        </div>

        {showAdd && (
          <div className="px-4 py-3 border-b border-border space-y-2">
            <input
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddFeed()}
              placeholder={t("feeds.urlPlaceholder")}
              className="w-full h-8 px-2 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {addPreview ? (
              <div className="space-y-1">
                <p className="text-xs font-medium">{addPreview.title}</p>
                <p className="text-[10px] text-muted-foreground line-clamp-2">{addPreview.description}</p>
                <div className="flex gap-2">
                  <button onClick={confirmAdd} className="text-xs text-primary hover:underline">{t("feeds.subscribe")}</button>
                  <button onClick={() => setAddPreview(null)} className="text-xs text-muted-foreground hover:underline">{t("settings.cancel")}</button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleAddFeed}
                disabled={addLoading || !addUrl.trim()}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                {addLoading ? t("feeds.fetching") : t("feeds.fetch")}
              </button>
            )}
            {error && <p className="text-[10px] text-destructive">{error}</p>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1">
          <button
            onClick={() => setSelectedFeedId("all")}
            className={`w-full text-left px-4 py-2 text-sm transition-colors ${
              selectedFeedId === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
            }`}
          >
            {t("feeds.all")}
          </button>
          {feeds.length === 0 && !showAdd && (
            <div className="px-4 py-6">
              <p className="text-xs text-muted-foreground mb-4">{t("feeds.noFeeds")}</p>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">{t("feeds.presets")}</p>
              {PRESET_FEEDS.map((p) => (
                <button
                  key={p.url}
                  onClick={async () => {
                    setAddUrl(p.url);
                    const meta = await fetchFeed(p.url, true);
                    if (meta) {
                      await db.addRssFeed(p.url, meta.title || p.title, meta.site_link, meta.description);
                      const updated = await db.getRssFeeds();
                      setFeeds(updated);
                    }
                  }}
                  className="w-full text-left px-3 py-2 mb-1 rounded-lg hover:bg-muted transition-colors"
                >
                  <p className="text-xs font-medium">{p.title}</p>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{p.desc}</p>
                </button>
              ))}
            </div>
          )}
          {feeds.map((f) => (
            <div key={f.id} className="group relative">
              <button
                onClick={() => setSelectedFeedId(f.id)}
                className={`w-full text-left px-4 py-2 pr-8 text-sm transition-colors ${
                  selectedFeedId === f.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                }`}
              >
                <p className="truncate">{f.title || domain(f.url)}</p>
                <p className="text-[10px] text-muted-foreground truncate">{domain(f.url)}</p>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(f.id); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 hidden group-hover:flex items-center justify-center rounded text-[10px] text-muted-foreground hover:text-destructive"
                title={t("feeds.deleteFeed")}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: article list or reader */}
      <div className="flex-1 overflow-y-auto">
        {browse ? (
          <ReaderView
            url={browse.url}
            title={browse.title}
            domain={browse.domain}
            onBack={() => setBrowse(null)}
            onOpenExternal={() => window.open(browse.url, "_blank")}
            onLearn={({ title, text }: { title: string; text: string }) => handleLearn(title, text)}
          />
        ) : selectedFeedId === null ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">{t("feeds.empty.cta")}</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {entries.length === 0 && !loading && (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                <p className="text-sm">{t("feeds.noArticles")}</p>
              </div>
            )}
            {entries.map(({ feed, entry }) => (
              <button
                key={entry.url}
                onClick={() => handleOpenArticle(entry, feed)}
                className="w-full text-left px-6 py-4 hover:bg-muted/50 transition-colors"
              >
                <p className="text-sm font-medium line-clamp-2">{entry.title}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] text-muted-foreground">{domain(entry.url)}</span>
                  {entry.author && (
                    <span className="text-[10px] text-muted-foreground">· {entry.author}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">· {relativeTime(entry.published)}</span>
                </div>
                {entry.summary && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{entry.summary}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Learn Drawer inline */}
      {learnStory && (
        <div className="fixed inset-y-0 right-0 w-96 bg-card border-l border-border shadow-xl z-50 flex flex-col animate-slide-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">{learnStory.title}</h3>
            <button onClick={() => { setLearnStory(null); setLearnPrefill(""); }} className="text-muted-foreground hover:text-foreground">✕</button>
          </div>
          <div className="flex-1 p-4">
            <textarea
              value={learnPrefill}
              onChange={(e) => setLearnPrefill(e.target.value)}
              placeholder="Article text will appear here..."
              className="w-full h-full text-sm bg-background border border-border rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="px-4 py-3 border-t border-border flex gap-2">
            <button
              onClick={handleStartAnalysis}
              disabled={!learnPrefill.trim()}
              className="flex-1 h-9 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {t("reading.analyze")}
            </button>
            <button
              onClick={() => { setLearnStory(null); setLearnPrefill(""); }}
              className="px-4 h-9 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors"
            >
              {t("settings.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

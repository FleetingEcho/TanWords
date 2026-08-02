import React, { useEffect, useState } from "react";
import { Library, PenLine, Podcast, Rss } from "lucide-react";
import { useT } from "@/hooks/useT";
import { ReaderView } from "@/components/Reader/ReaderView";
import { ReadingLibrary } from "@/components/Reader/ReadingLibrary";
import { useReaderNotesStore } from "@/store/readerNotesStore";
import { useReadingPageStore } from "@/store/readingPageStore";
import { LIBRARY_URL_PREFIX, SCRATCH_URL_PREFIX } from "@/components/Reader/ArticleReader";
import { FeedsPanel } from "@/components/Feeds/FeedsPanel";

/** Reading-scope tabs on web: the desktop's standalone Feeds page folds in here
 *  as the 订阅 and 播客 surfaces (feeds are per-kind instances of FeedsPanel). */
export type ReadingTab = "mine" | "feeds" | "podcasts";

/**
 * Paste-in reading, its library, and subscribed feeds/podcasts, as a page.
 *
 * Two views and one detail on the "mine" surface: a blank sheet to paste
 * into, the library of everything ever read (including articles an agent
 * added over MCP), and an article opened out of either. Being a page rather
 * than an overlay means a half-finished paste or a search you set up survives
 * looking something up elsewhere and coming back.
 */
export function ReadingPage({ initialTab = "mine" }: { initialTab?: ReadingTab }) {
  const t = useT();
  // In a store, not useState: App.tsx unmounts this page whenever you navigate
  // elsewhere, so anything local is gone by the time you come back.
  const view = useReadingPageStore((s) => s.view);
  const setView = useReadingPageStore((s) => s.setView);
  const openArticleId = useReadingPageStore((s) => s.openArticleId);
  const setOpenArticleId = useReadingPageStore((s) => s.openArticle);
  // A fresh sheet per paste session — bumped after an article is opened so
  // returning to "paste" doesn't show the last one.
  const session = useReadingPageStore((s) => s.session);
  const articleTitle = useReaderNotesStore((s) => s.article?.title);
  // The blank paste sheet has nothing to go back to yet, so its reader bar
  // (and the toolbar portaled into it — copy/translate/listen/notes) stays
  // hidden until ArticleReader actually has something loaded and publishes it
  // here, right after "Start reading" — same signal the LIBRARY_URL_PREFIX
  // branch below relies on to always show its bar.
  const hasArticle = useReaderNotesStore((s) => !!s.article);

  // Which surface is on top. Local useState (not readingPageStore) is fine:
  // the store is for state that must survive page unmounts, while which tab
  // you're looking at resets cheaply and without surprises.
  const [tab, setTab] = useState<ReadingTab>(initialTab);
  // Feeds/podcast panels stay mounted once visited: grid scroll position, an
  // open entry, and the shared seed latch all survive tab hops.
  const [visited, setVisited] = useState<Set<ReadingTab>>(() => new Set([initialTab]));
  const selectTab = (id: ReadingTab) => {
    setTab(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
  };

  useEffect(() => {
    const onShowLibrary = () => { selectTab("mine"); useReadingPageStore.getState().backToLibrary(); };
    const onOpenArticle = (e: Event) => {
      selectTab("mine");
      const detail = (e as CustomEvent<{ id: number }>).detail;
      if (detail?.id) setOpenArticleId(detail.id);
    };
    window.addEventListener("tanwords:show-library", onShowLibrary);
    window.addEventListener("tanwords:open-article", onOpenArticle);
    return () => {
      window.removeEventListener("tanwords:show-library", onShowLibrary);
      window.removeEventListener("tanwords:open-article", onOpenArticle);
    };
  }, []);

  const backToLibrary = () => useReadingPageStore.getState().backToLibrary();

  if (openArticleId !== null) {
    return (
      <ReaderView
        key={openArticleId}
        url={`${LIBRARY_URL_PREFIX}${openArticleId}`}
        title={articleTitle || t("scratch.title")}
        domain={t("scratch.domain")}
        onBack={backToLibrary}
      />
    );
  }

  const minePane = (
    <div className="min-h-0 flex-1">
      {view === "library" ? (
        <ReadingLibrary onOpen={(id) => setOpenArticleId(id)} />
      ) : (
        <ReaderView
          key={session}
          url={`${SCRATCH_URL_PREFIX}${session}`}
          title={articleTitle || t("scratch.title")}
          domain={t("scratch.domain")}
          onBack={backToLibrary}
          hideBar={!hasArticle}
        />
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* One header row: reading-scope segmented control, plus the paste/library
        * sub-switch inline when the mine surface is active. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 overflow-x-auto">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 shrink-0">
          {(["mine", "feeds", "podcasts"] as const).map((id) => (
            <button
              key={id}
              onClick={() => selectTab(id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                tab === id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {id === "mine" ? <PenLine className="h-3.5 w-3.5" /> : id === "feeds" ? <Rss className="h-3.5 w-3.5" /> : <Podcast className="h-3.5 w-3.5" />}
              {t(`reading.tabs.${id}`)}
            </button>
          ))}
        </div>

        {tab === "mine" && (
          <div className="flex items-center gap-0.5 rounded-lg border border-border/70 p-0.5 shrink-0">
            {(["paste", "library"] as const).map((id) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  view === id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {id === "paste" ? <PenLine className="h-3 w-3" /> : <Library className="h-3 w-3" />}
                {id === "paste" ? t("scratch.newRead") : t("library.title")}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "mine" && minePane}
      {visited.has("feeds") && (
        <div className={`min-h-0 flex-1 ${tab === "feeds" ? "" : "hidden"}`}>
          <FeedsPanel kind="article" />
        </div>
      )}
      {visited.has("podcasts") && (
        <div className={`min-h-0 flex-1 ${tab === "podcasts" ? "" : "hidden"}`}>
          <FeedsPanel kind="podcast" />
        </div>
      )}
    </div>
  );
}

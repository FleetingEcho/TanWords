import React, { useEffect } from "react";
import { Library, PenLine, Rss } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { ReaderView } from "@/components/Reader/ReaderView";
import { ReadingLibrary } from "@/components/Reader/ReadingLibrary";
import { useReaderNotesStore } from "@/store/readerNotesStore";
import { useReadingPageStore } from "@/store/readingPageStore";
import { LIBRARY_URL_PREFIX, SCRATCH_URL_PREFIX } from "@/components/Reader/ArticleReader";
import { Button } from "@/components/ui/button";

/**
 * Paste-in reading and its library, as a page.
 *
 * Two views and one detail: a blank sheet to paste into, the library of
 * everything ever read this way (including articles an agent added over
 * MCP), and an article opened out of either. Being a page rather than an
 * overlay means a half-finished paste or a search you set up survives
 * looking something up elsewhere and coming back.
 */
export function ReadingPage() {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);
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

  useEffect(() => {
    const onShowLibrary = () => useReadingPageStore.getState().backToLibrary();
    const onOpenArticle = (e: Event) => {
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* One row, two views: the sheet you write on and the shelf you file
        * it to. A segmented control rather than tabs — there are exactly two,
        * and neither is a section of the other. */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-4">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {(["paste", "library"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                view === id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {id === "paste" ? <PenLine className="h-3.5 w-3.5" /> : <Library className="h-3.5 w-3.5" />}
              {id === "paste" ? t("scratch.newRead") : t("library.title")}
            </button>
          ))}
        </div>
        <div className="ml-auto lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("feeds")}
            title={t("nav.feeds")}
            aria-label={t("nav.feeds")}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Rss className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
    </div>
  );
}

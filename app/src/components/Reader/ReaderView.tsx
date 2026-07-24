import React, { useState } from "react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { ArticleReader } from "@/components/Reader/ArticleReader";
import { ExternalIcon, NotesIcon } from "@/components/ui/icons";
import type { PodcastTrack } from "@/store/podcastPlayerStore";
import { Button } from "@/components/ui/button";
import { useReaderNotesStore } from "@/store/readerNotesStore";
import { useAnalyzeArticle } from "@/hooks/useAnalyzeArticle";

interface Props {
  url: string;
  title: string;
  domain: string;
  onBack: () => void;
  onOpenExternal: () => void;
  /** Podcast episodes: the entry's own audio enclosure, passed through to the reader. */
  audio?: PodcastTrack;
  /** Set when this entry came from an hnrss.org-style feed — shows the HN discussion below the article. */
  hnItemId?: number | null;
}

/** In-app reader mode: top bar (back / title / domain / open-external) over the extracted article. */
export function ReaderView({ url, title, domain, onBack, onOpenExternal, audio, hnItemId }: Props) {
  const t = useT();
  const { analyze } = useAnalyzeArticle();
  const readerArticle = useReaderNotesStore((state) => state.article);
  const readerAnalyzing = useReaderNotesStore((state) => state.analyzing);
  const readerShowNotes = useReaderNotesStore((state) => state.showNotes);
  // ArticleReader owns the learn/listen/translate/comments buttons (their handlers
  // need article + player state that lives there) but they render up here, in the
  // reader bar, via this slot — set once the div mounts, portaled into from below.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);

  const openHnDiscussion = async () => {
    const hnUrl = `https://news.ycombinator.com/item?id=${hnItemId}`;
    try {
      await openShell(hnUrl);
    } catch {
      window.open(hnUrl, "_blank");
    }
  };

  /** Analyzes the article currently loaded below (ArticleReader publishes it to
   *  readerNotesStore as soon as it fetches). If the reader is still showing that
   *  same article once the AI call resolves, the result lands directly in its
   *  notes pane; if the user has since moved to a different article, a plain
   *  completion toast reports it instead (the analysis is still saved). */
  const analyzeCurrentArticle = async () => {
    const notes = useReaderNotesStore.getState();
    const current = notes.article;
    if (!current || notes.analyzing) return;
    if (notes.notesMarkdown) {
      notes.setShowNotes(!notes.showNotes);
      return;
    }
    notes.setAnalyzing(true);
    notes.setShowNotes(true);
    const stillCurrent = () => useReaderNotesStore.getState().article?.url === current.url;
    try {
      const result = await analyze({
        text: current.text,
        title: current.title,
        sourceUrl: current.url,
        origin: "rss",
        commentsText: current.commentsText,
        hnItemId: current.hnItemId,
      });
      if (stillCurrent()) {
        useReaderNotesStore.getState().setNotesMarkdown(result.markdown);
      } else {
        toast.success(t("feeds.analyzeBackground.done", { title: result.title }));
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      if (stillCurrent()) useReaderNotesStore.getState().setShowNotes(false);
      toast.error(e?.message || t("feeds.analyzeBackground.failed", { title: current.title }));
    } finally {
      if (stillCurrent()) useReaderNotesStore.getState().setAnalyzing(false);
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Reader bar */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
        <Button
          variant="ghost"
          onClick={onBack}
          className="h-7 px-2.5 rounded-md flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          ← {t("hn.reader.back")}
        </Button>
        <div className="w-px h-4 bg-border" />
        {hnItemId != null ? (
          <button
            onClick={openHnDiscussion}
            title={t("hn.reader.openDiscussion")}
            className="flex-1 min-w-0 text-left text-sm font-medium truncate hover:text-primary hover:underline transition-colors"
          >
            {title}
          </button>
        ) : (
          <span className="flex-1 min-w-0 text-sm font-medium truncate">{title}</span>
        )}
        <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
          {domain}
        </span>
        <Button
          variant="ghost"
          onClick={onOpenExternal}
          title={t("hn.reader.external")}
          className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <ExternalIcon className="w-4 h-4" />
        </Button>
        <div ref={setToolbarSlot} className="flex items-center gap-1 shrink-0 empty:hidden" />
        {readerArticle && (
          <Button
            variant="ghost"
            onClick={analyzeCurrentArticle}
            disabled={readerAnalyzing}
            aria-pressed={readerShowNotes}
            title={t("reader.analyzeNotes")}
            className={`w-7 h-7 p-0 rounded-md flex items-center justify-center transition-colors shrink-0 ${
              readerShowNotes ? "bg-primary/10 text-primary hover:bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {readerAnalyzing ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
            ) : (
              <NotesIcon className="w-4 h-4" />
            )}
          </Button>
        )}
      </div>

      <ArticleReader url={url} domain={domain} onOpenExternal={onOpenExternal} audio={audio} hnItemId={hnItemId} toolbarSlot={toolbarSlot} />
    </div>
  );
}

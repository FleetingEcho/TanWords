import React from "react";
import { createPortal } from "react-dom";
import { useDB } from "@/hooks/useDB";
import { Button } from "@/components/ui/button";
import { HnComments } from "@/components/Reader/HnComments";
import { ScratchPasteScreen } from "@/components/Reader/ScratchPasteScreen";
import { ArticleComments } from "@/components/Reader/ArticleComments";
import { TranslationPane } from "@/components/shared/TranslationPane";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { useIsNarrow } from "@/components/Vocabulary/hooks/useMediaQuery";
import { useReaderNotesStore } from "@/store/readerNotesStore";
import { Markdown } from "@/components/AiChat/Markdown";
import { renderStudyBlockquote } from "@/components/AiChat/SpeakingPhrase";
import { AiChatModal } from "@/components/AiChat/AiChatModal";
import { useWordModalStore } from "@/store/wordModalStore";
import type { PodcastTrack } from "@/store/podcastPlayerStore";
import { useArticleReaderState } from "./hooks/useArticleReaderState";
import { ReaderToolbar } from "./ReaderToolbar";
import { FONT_STEPS, SCRATCH_URL_PREFIX, LIBRARY_URL_PREFIX, type FetchedArticle } from "./articleReaderHelpers";
import { LazyReadOnlyArticle } from "./LazyReadOnlyArticle";

export type { FetchedArticle } from "./articleReaderHelpers";
export { SCRATCH_URL_PREFIX, LIBRARY_URL_PREFIX } from "./articleReaderHelpers";

const lookupWord = (word: string) => useWordModalStore.getState().openWordModal(word);

interface Props {
  url: string;
  /** Domain label shown in the reader bar; also used to restore this view from the player bar. */
  domain: string;
  onOpenExternal: () => void;
  /** The entry's own audio enclosure (podcast episodes). When set, the listen
   * button plays this original recording instead of synthesizing TTS. */
  audio?: PodcastTrack;
  /** Set when this entry came from an hnrss.org-style feed — shows the HN discussion below the article. */
  hnItemId?: number | null;
  /** Reader bar node (see ReaderView) that the learn/listen/translate/comments
   *  buttons portal into once the article is ready — kept here because their
   *  handlers need article + player state that lives in this component. */
  toolbarSlot?: HTMLDivElement | null;
}

export function ArticleReader({ url, domain, onOpenExternal, audio, hnItemId, toolbarSlot }: Props) {
  const db = useDB();
  const articleScrollRef = React.useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow();
  const state = useArticleReaderState({ url, domain, audio, hnItemId });
  const {
    t, status, article, errorMsg, fontStep, setFontStep, hnComments, pastedText, setPastedText,
    articleId, comments, showComments, showTranslation, chatModalSessionId, setChatModalSessionId,
    analyzingNotes, notesMarkdown, rightView, setRightView,
    hasSidePanes, openPanes, activeView,
    handlePasteSubmit, handleHnCommentsLoaded, setShowComments, setShowTranslation,
  } = state;

  /** Phones show the side panes as a modal, so dismissing it has to actually
   *  close the panes — otherwise the reader reopens them on the next render. */
  const closeSidePanes = () => {
    setShowComments(false);
    setShowTranslation(false);
    useReaderNotesStore.getState().setShowNotes(false);
  };

  if (status === "loading") {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        <span className="text-xs text-muted-foreground">{t("reader.loading")}</span>
      </div>
    );
  }

  if (status === "error" || !article) {
    // The paste-in reader opens here on purpose, and gets its own screen.
    if (url.startsWith(SCRATCH_URL_PREFIX)) {
      return <ScratchPasteScreen value={pastedText} onChange={setPastedText} onSubmit={(title) => void handlePasteSubmit(title)} />;
    }
    // Otherwise this is an article that couldn't be extracted: offer the
    // original page, with the paste box as a fallback.
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10">
        <div className="max-w-[68ch] mx-auto flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground max-w-md">{t("reader.extractFailed")}</p>
          {errorMsg && <p className="text-[11px] font-mono text-muted-foreground/50 max-w-md truncate">{errorMsg}</p>}
          <Button
            onClick={onOpenExternal}
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("hn.reader.external")}
          </Button>

          <div className="w-full mt-6 text-left">
            <p className="text-xs text-muted-foreground mb-2">{t("reader.pastePrompt")}</p>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handlePasteSubmit(); }}
              placeholder={t("reader.pastePlaceholder")}
              rows={10}
              className="w-full rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 resize-y outline-hidden transition-colors focus:border-primary/50 focus:bg-background"
            />
            <div className="mt-3 flex justify-end">
              <Button
                onClick={() => void handlePasteSubmit()}
                disabled={!pastedText.trim()}
                className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                {t("reader.pasteSubmit")}
              </Button>
            </div>
          </div>

          {hnItemId != null && (
            <div className="w-full text-left">
              <HnComments storyId={hnItemId} onLoaded={handleHnCommentsLoaded} />
            </div>
          )}
        </div>
      </div>
    );
  }

  /** One definition, two containers: a column on desktop, a modal on phones. */
  const sidePanes = (
    <>
          {openPanes.length > 1 && (
            <div className="flex items-center gap-1 border-b border-border p-1.5 shrink-0">
              {openPanes.map((pane) => (
                <button
                  key={pane}
                  onClick={() => setRightView(pane)}
                  className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    activeView === pane ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {pane === "notes" ? t("reading.notesTitle") : pane === "translation" ? t("reading.translate.button") : t("library.comments", { n: comments.length })}
                </button>
              ))}
            </div>
          )}

          {activeView === "notes" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {analyzingNotes ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                  {t("command.analyzing")}
                </div>
              ) : notesMarkdown ? (
                <Markdown
                  text={notesMarkdown}
                  renderBlockquote={renderStudyBlockquote}
                  onWordClick={lookupWord}
                />
              ) : (
                <p className="text-xs text-muted-foreground">{t("reading.notesEmpty")}</p>
              )}
            </div>
          ) : activeView === "comments" ? (
            <ArticleComments
              comments={comments}
              onDelete={async (id) => { await db.deleteReadingComment(id); window.dispatchEvent(new CustomEvent("articles-updated")); }}
              onAdd={async (body) => {
                if (articleId === null) return;
                await db.addReadingComment(articleId, body);
                window.dispatchEvent(new CustomEvent("articles-updated"));
              }}
            />
          ) : (
            <TranslationPane articleText={article.text_content} hnItemId={hnItemId ?? null} />
          )}
    </>
  );

  return (
    // Two independent columns: the article scrolls on the left, and the side
    // panel (notes / translation / comments) fills the reader's real height on
    // the right with its own scroll — sizing it off 100vh instead would
    // overshoot, since the feeds tab bar above and the player bar below both
    // eat into the viewport, leaving the panel's bottom unreachable.
    <div className="flex-1 min-h-0 flex">
      <div ref={articleScrollRef} className="min-w-0 flex-1 overflow-y-auto">
      <div className="px-6 py-10">

        {toolbarSlot && createPortal(
          <ReaderToolbar state={state} url={url} domain={domain} audio={audio} hnItemId={hnItemId} />,
          toolbarSlot
        )}

        {/* data-reader-selectable tells the global selection toolbar that
          * anything picked in here (article body or HN comments) came from
          * the reader, so saved sentences are attributed to it. */}
        <div data-reader-selectable className="min-w-0 w-full">
          <LazyReadOnlyArticle
            scrollViewportRef={articleScrollRef}
            html={article.content_html}
            fallbackText={article.text_content}
            fontSize={FONT_STEPS[fontStep]}
            header={
              <>
                {/* Font size control */}
                <div className="flex items-center justify-end gap-1 mb-6 -mt-2">
                  <Button
                    variant="ghost"
                    onClick={() => setFontStep((s) => Math.max(0, s - 1))}
                    disabled={fontStep === 0}
                    className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors text-xs font-bold"
                    title={t("reader.fontSmaller")}
                  >
                    A-
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setFontStep((s) => Math.min(FONT_STEPS.length - 1, s + 1))}
                    disabled={fontStep === FONT_STEPS.length - 1}
                    className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors text-sm font-bold"
                    title={t("reader.fontLarger")}
                  >
                    A+
                  </Button>
                </div>

                <h1 className="text-[1.9rem] font-bold leading-tight text-foreground">{article.title}</h1>
                {(article.byline || article.site_name) && (
                  <p className="text-xs text-muted-foreground mt-3">
                    {[article.byline, article.site_name].filter(Boolean).join(" · ")}
                  </p>
                )}
              </>
            }
          />
          {hnItemId != null && <HnComments storyId={hnItemId} onLoaded={handleHnCommentsLoaded} />}
        </div>
      </div>
      </div>

      {/* The side panel appears once notes or a translation is requested, and
        * shows exactly one of them at a time — a small toggle only shows up
        * once there's actually a second thing to switch to. Notes is populated
        * from the reader bar's analyze button (see ReaderView); it just renders
        * whatever markdown comes back. */}
      {hasSidePanes && !narrow && (
        <div className="min-w-0 flex-1 flex flex-col overflow-hidden border-l border-border/40 pl-4">
          {sidePanes}
        </div>
      )}

      {/* Phones can't afford a second column: the panel and the article each
        * got half the width and both collapsed to one word per line. Same
        * content, shown over the article instead of beside it. */}
      {hasSidePanes && narrow && (
        <Dialog open onClose={closeSidePanes} maxWidth="max-w-lg" className="flex h-[85vh] flex-col">
          <div className="relative flex shrink-0 items-center border-b border-border px-5 py-3.5">
            <DialogTitle className="min-w-0 flex-1 truncate pr-8 text-sm font-semibold">
              {article.title}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeSidePanes}
              className="absolute right-3 top-3 h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <CloseIcon className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {sidePanes}
          </div>
        </Dialog>
      )}
      <AiChatModal
        open={chatModalSessionId !== null}
        onClose={() => setChatModalSessionId(null)}
        sessionId={chatModalSessionId ?? undefined}
      />
    </div>
  );
}

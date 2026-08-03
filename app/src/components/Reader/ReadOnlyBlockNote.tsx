import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { BlockNoteEditor } from "@blocknote/core";
import "@blocknote/mantine/style.css";
import { ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { useIsNarrow } from "@/components/Vocabulary/hooks/useMediaQuery";
import { editorSchema } from "@/components/Documents/editorSchema";
import { liftYouTube } from "@/components/Documents/mediaTransforms";
import { repairMarkdown } from "@/lib/markdownPreparse";
import { useIsDark } from "@/hooks/useIsDark";
import { useT } from "@/hooks/useT";
import { DocumentOutline, useOutlineItems } from "@/components/Documents/DocumentOutline";
import { htmlToMarkdownOffThread } from "@/lib/documentWorkerClient";
import { htmlToMarkdown } from "@/lib/htmlToMarkdown";

/** Read-only BlockNote renderer for article HTML. Uses the same schema as the
 *  document editor so headings, code blocks, tables and images keep the same
 *  visual language, but never lets the reader edit the article. */
export function ReadOnlyBlockNote({
  html,
  fontSize = 17.5,
  fallbackText = "",
  header,
  toolbarSlot,
}: {
  html: string;
  fontSize?: number;
  fallbackText?: string;
  /** Reader-bar node to portal the outline button into (see ReaderView). The
   *  button can't live beside the article on a phone — there is no room for a
   *  column, and an absolutely placed one scrolls away from the reader. */
  toolbarSlot?: HTMLElement | null;
  /** Rendered at the top of the article column with the same geometry as the
   *  BlockNote body below (see .reader-article-header in reader-content.css),
   *  so the article title lines up with the parsed content. */
  header?: ReactNode;
}) {
  const editor = useCreateBlockNote({ schema: editorSchema }, [html]);
  /** Editors that already hold this article, marked only AFTER the blocks were
   *  actually inserted — a StrictMode remount (or any effect re-run that follows
   *  a cancelled parse) must parse again, while a no-op re-run for an already
   *  loaded editor must not. Keyed on the editor because `useCreateBlockNote`
   *  hands out a fresh instance when `html` changes. */
  const [loadedRef] = useState(() => new WeakMap<object, string>());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [outlineTick, setOutlineTick] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  // Separate from `outlineOpen`: that one defaults open (the desktop column
  // is meant to be there), and sharing it would pop the modal on load.
  const [outlineModalOpen, setOutlineModalOpen] = useState(false);
  const [parsing, setParsing] = useState(true);
  const [plainText, setPlainText] = useState<string | null>(null);
  const isDark = useIsDark();
  const narrow = useIsNarrow();
  const t = useT();
  // The reader can't add headings, so an empty outline has nothing to say —
  // hide it when the article has no headings. It also drops below xl
  // viewports, where a fixed 224px column would squeeze the reading column
  // to a sliver. The body centers itself in whatever space remains to the
  // outline's left, so there is no "balancing" spacer on the other side.
  const outlineItems = useOutlineItems(editor, outlineTick);

  /** Markdown alone cannot express a video, so a YouTube link arrives as a
   *  link or a bare paragraph and would render as one. The schema has a player
   *  block; `liftYouTube` is what promotes a paragraph that is *only* a
   *  YouTube URL into it (a link inside a sentence stays prose). Feeds and HN
   *  posts that are mostly a video were otherwise a URL to copy elsewhere. */
  const parseMarkdown = (markdown: string) => {
    const headless = BlockNoteEditor.create({ schema: editorSchema });
    return liftYouTube(headless.tryParseMarkdownToBlocks(repairMarkdown(markdown)));
  };

  useEffect(() => {
    let cancelled = false;
    if (!html.trim()) {
      if (fallbackText.trim()) {
        try {
          editor.replaceBlocks(editor.document, parseMarkdown(fallbackText) as any);
          window.setTimeout(() => {
            if (cancelled) return;
            const hasText = rootRef.current?.querySelector(".bn-editor")?.textContent?.trim();
            setPlainText(hasText ? null : fallbackText);
          }, 0);
          setOutlineTick((tick) => tick + 1);
        } catch {
          setPlainText(fallbackText);
        }
      }
      setParsing(false);
      return;
    }
    if (loadedRef.get(editor) === html) {
      setParsing(false);
      return;
    }
    setParsing(true);
    const fallbackTimer = window.setTimeout(() => {
      if (cancelled) return;
      if (editor.document.length === 0) {
        setPlainText(fallbackText || html);
      }
      setParsing(false);
    }, 3000);
    void Promise.race([
      htmlToMarkdownOffThread(html),
      new Promise<string>((_, reject) => {
        window.setTimeout(() => reject(new Error("worker timed out")), 5000);
      }),
    ])
      .then((markdown) => {
        if (cancelled) return;
        try {
          const blocks = parseMarkdown(markdown);
          editor.replaceBlocks(editor.document, blocks as any);
          loadedRef.set(editor, html);
          window.setTimeout(() => {
            if (cancelled) return;
            const hasText = rootRef.current?.querySelector(".bn-editor")?.textContent?.trim();
            setPlainText(hasText ? null : (fallbackText || markdown));
          }, 0);
          setOutlineTick((tick) => tick + 1);
        } catch {
          if (fallbackText.trim()) setPlainText(fallbackText);
          else setPlainText(markdown);
        }
      })
      .catch(() => {
        if (cancelled) return;
        try {
          const blocks = parseMarkdown(htmlToMarkdown(html));
          editor.replaceBlocks(editor.document, blocks as any);
          loadedRef.set(editor, html);
          window.setTimeout(() => {
            if (cancelled) return;
            const hasText = rootRef.current?.querySelector(".bn-editor")?.textContent?.trim();
            setPlainText(hasText ? null : (fallbackText || htmlToMarkdown(html)));
          }, 0);
        } catch {
          try {
            editor.replaceBlocks(editor.document, [{
              type: "paragraph",
              content: [{ type: "text", text: html, styles: {} }],
            }] as any);
            loadedRef.set(editor, html);
            setPlainText(null);
          } catch {
            // Never let a malformed article keep the reader stuck on loading.
            setPlainText(fallbackText || html);
          }
        }
        setOutlineTick((tick) => tick + 1);
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [editor, fallbackText, html]);

  // Some RSS/HN articles reference images that no longer exist. Hide them
  // instead of showing the browser's broken-image glyph inside the article.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const hideBrokenImage = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !root.contains(target)) return;
      const block = target.closest<HTMLElement>('[data-content-type="image"], [data-content-type="file"]');
      if (block) {
        block.style.display = "none";
        return;
      }
      const figure = target.closest("figure");
      if (figure) figure.style.display = "none";
      target.style.display = "none";
    };
    root.addEventListener("error", hideBrokenImage, true);
    return () => root.removeEventListener("error", hideBrokenImage, true);
  }, []);

  return (
    <div
      ref={rootRef}
      className="tanwords-editor tanwords-editor-readonly"
      style={{ "--document-font-size": `${fontSize}px` } as CSSProperties}
      data-color-scheme={isDark ? "dark" : "light"}
    >
      <div className="relative flex min-h-0 flex-1 gap-2">
        <div className="min-w-0 flex-1">
          {header && <div className="reader-article-header">{header}</div>}
          {plainText ? (
            <div className="whitespace-pre-wrap break-words px-6 py-5 text-[17px] leading-8 text-foreground">
              {plainText}
            </div>
          ) : (
            <BlockNoteView
              editor={editor}
              theme={isDark ? "dark" : "light"}
              editable={false}
              formattingToolbar={false}
              linkToolbar={false}
              sideMenu={false}
              slashMenu={false}
              className="tanwords-editor"
            />
          )}
        </div>
        {outlineItems.length > 0 && (
          <button
            type="button"
            onClick={() => setOutlineOpen((open) => !open)}
            title={t("doc.outlineToggle")}
            aria-label={t("doc.outlineToggle")}
            className="sticky top-4 hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/80 text-muted-foreground shadow-xs backdrop-blur transition-colors hover:bg-muted hover:text-foreground lg:flex"
          >
            <ListTree className="h-4 w-4" />
          </button>
        )}
        {outlineOpen && outlineItems.length > 0 && (
          // Hidden below `lg` along with its toggle button: with no way to
          // close it, a 224px column on a phone left the article a sliver wide.
          <div className="sticky top-4 hidden max-h-[calc(100vh-8rem)] w-56 shrink-0 self-start overflow-y-auto lg:block">
            <DocumentOutline editor={editor} tick={outlineTick} />
          </div>
        )}
        {/* Phone outline entry point: portaled into the reader bar so it stays
          * reachable while scrolling, and opens the headings as a modal rather
          * than a column that would leave the article a sliver wide. */}
        {toolbarSlot && narrow && outlineItems.length > 0 && createPortal(
          <Button
            variant="ghost"
            onClick={() => setOutlineModalOpen(true)}
            title={t("doc.outline")}
            aria-label={t("doc.outline")}
            className="w-7 h-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <ListTree className="w-4 h-4" />
          </Button>,
          toolbarSlot,
        )}
        {narrow && (
          <Dialog open={outlineModalOpen} onClose={() => setOutlineModalOpen(false)} maxWidth="max-w-sm">
            <div className="relative border-b border-border px-5 py-4">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <ListTree className="h-4 w-4 text-muted-foreground" />
                {t("doc.outline")}
              </DialogTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOutlineModalOpen(false)}
                className="absolute right-3 top-3 h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                title={t("common.close")}
                aria-label={t("common.close")}
              >
                <CloseIcon className="h-4 w-4" />
              </Button>
            </div>
            <DocumentOutline
              editor={editor}
              tick={outlineTick}
              className="max-h-[60vh] overflow-y-auto p-3"
              showHeader={false}
              onNavigate={() => setOutlineModalOpen(false)}
            />
          </Dialog>
        )}
        {parsing && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <span className="h-5 w-5 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

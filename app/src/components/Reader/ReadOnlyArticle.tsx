import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { liftYouTube } from "@/components/Documents/mediaTransforms";
import { markdownToBlocks } from "@/lib/markdown";
import { blocksToText } from "@/lib/docFormat";
import { LazyTiptapDocumentEditor } from "@/components/Documents/tiptap/LazyTiptapDocumentEditor";
import type { DocEditorApi } from "@/components/Documents/tiptap/DocEditorApi";
import type { Block } from "@/components/Documents/tiptap/blocks";
import { useIsDark } from "@/hooks/useIsDark";
import { DocumentScrollOutline } from "@/components/Documents/DocumentOutline";
import { htmlToMarkdownOffThread } from "@/lib/documentWorkerClient";
import { htmlToMarkdown } from "@/lib/htmlToMarkdown";

/** Read-only renderer for article HTML. Uses the same schema as the
 *  document editor so headings, code blocks, tables and images keep the same
 *  visual language, but never lets the reader edit the article. */
export function ReadOnlyArticle({
  html,
  fontSize = 17.5,
  fallbackText = "",
  header,
  scrollViewportRef,
}: {
  html: string;
  fontSize?: number;
  fallbackText?: string;
  /** The real RSS/Reading scroll host. Passing it explicitly avoids choosing
   *  an inner overflow container that never emits the article's scroll. */
  scrollViewportRef?: RefObject<HTMLDivElement | null>;
  /** Rendered at the top of the article column with the same geometry as the
   *  document body below (see .reader-article-header in reader-content.css),
   *  so the article title lines up with the parsed content. */
  header?: ReactNode;
}) {
  // The editor mounts with its blocks, so parsing produces content rather than
  // writing into a live instance.
  const [editor, setEditor] = useState<DocEditorApi | null>(null);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [parsing, setParsing] = useState(true);
  /** Mirrors `blocks` for the watchdog below, which would otherwise read the
   *  value captured when its effect ran — always null — and replace a
   *  perfectly good article with plain text three seconds after it rendered. */
  const parsedRef = useRef<Block[] | null>(null);
  const [plainText, setPlainText] = useState<string | null>(null);
  const isDark = useIsDark();

  /** Markdown alone cannot express a video, so a YouTube link arrives as a
   *  link or a bare paragraph and would render as one. The schema has a player
   *  block; `liftYouTube` is what promotes a paragraph that is *only* a
   *  YouTube URL into it (a link inside a sentence stays prose). Feeds and HN
   *  posts that are mostly a video were otherwise a URL to copy elsewhere. */
  const parseMarkdown = (markdown: string) => liftYouTube(markdownToBlocks(markdown)) as Block[];

  /**
   * Shows the parsed article when it actually has text, and the plain-text
   * fallback when it does not.
   *
   * Decided from the parsed blocks rather than by reading the rendered DOM: the
   * editor mounts lazily, so a DOM check races the import and would show the
   * fallback for every article. The blocks are the same evidence, available
   * immediately.
   */
  const showParsed = (parsed: Block[], fallback: string) => {
    parsedRef.current = parsed;
    setBlocks(parsed);
    setPlainText(blocksToText(parsed).trim() ? null : fallback);
  };

  useEffect(() => {
    let cancelled = false;
    parsedRef.current = null;
    if (!html.trim()) {
      if (fallbackText.trim()) {
        try {
          showParsed(parseMarkdown(fallbackText), fallbackText);
        } catch {
          setPlainText(fallbackText);
        }
      }
      setParsing(false);
      return;
    }
    setParsing(true);
    const fallbackTimer = window.setTimeout(() => {
      if (cancelled) return;
      const parsed = parsedRef.current;
      if (!parsed || parsed.length === 0) {
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
          showParsed(parseMarkdown(markdown), fallbackText || markdown);
        } catch {
          if (fallbackText.trim()) setPlainText(fallbackText);
          else setPlainText(markdown);
        }
      })
      .catch(() => {
        if (cancelled) return;
        try {
          const markdown = htmlToMarkdown(html);
          showParsed(parseMarkdown(markdown), fallbackText || markdown);
        } catch {
          // Never let a malformed article keep the reader stuck on loading.
          setPlainText(fallbackText || html);
        }
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [fallbackText, html]);

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
            blocks && (
              <LazyTiptapDocumentEditor
                initialBlocks={blocks}
                isDark={isDark}
                editable={false}
                onReady={setEditor}
                className="tanwords-editor"
              />
            )
          )}
        </div>
        {editor && (
          <DocumentScrollOutline
            editor={editor}
            viewportRef={scrollViewportRef}
            className="sticky top-1/2 z-20 mr-1 -translate-y-1/2 self-start shrink-0"
          />
        )}
        {/* Held until the editor has actually mounted, not merely until parsing
          * finished: the editor chunk loads lazily, and dropping the overlay
          * early exposed the empty gap in between. */}
        {(parsing || (blocks !== null && editor === null)) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <span className="h-5 w-5 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

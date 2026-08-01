import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { BlockNoteEditor } from "@blocknote/core";
import "@blocknote/mantine/style.css";
import { editorSchema } from "@/components/Documents/editorSchema";
import { useIsDark } from "@/hooks/useIsDark";
import { DocumentOutline } from "@/components/Documents/DocumentOutline";
import { htmlToMarkdownOffThread } from "@/lib/documentWorkerClient";
import { htmlToMarkdown } from "@/lib/htmlToMarkdown";

/** Read-only BlockNote renderer for article HTML. Uses the same schema as the
 *  document editor so headings, code blocks, tables and images keep the same
 *  visual language, but never lets the reader edit the article. */
export function ReadOnlyBlockNote({
  html,
  fontSize = 17.5,
  fallbackText = "",
}: {
  html: string;
  fontSize?: number;
  fallbackText?: string;
}) {
  const editor = useCreateBlockNote({ schema: editorSchema }, [html]);
  const parsedRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [outlineTick, setOutlineTick] = useState(0);
  const [parsing, setParsing] = useState(true);
  const [plainText, setPlainText] = useState<string | null>(null);
  const isDark = useIsDark();

  const parseMarkdown = (markdown: string) => {
    const headless = BlockNoteEditor.create({ schema: editorSchema });
    return headless.tryParseMarkdownToBlocks(markdown);
  };

  useEffect(() => {
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
    if (parsedRef.current === html) {
      setParsing(false);
      return;
    }
    parsedRef.current = html;
    let cancelled = false;
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
        <div aria-hidden="true" className="w-56 shrink-0" />
        <div className="min-w-0 flex-1">
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
        <div className="sticky top-4 max-h-[calc(100vh-8rem)] w-56 shrink-0 self-start overflow-y-auto">
          <DocumentOutline editor={editor} tick={outlineTick} />
        </div>
        {parsing && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <span className="h-5 w-5 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

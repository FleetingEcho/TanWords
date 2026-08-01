import { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { editorSchema } from "../editorSchema";
import { DocumentDetail } from "@/hooks/useDB";
import { blocksToStorageOffThread, contentToBlocksOffThread, markdownToBlocksOffThread } from "@/lib/documentWorkerClient";
import { liftMermaid, lowerMermaid } from "../mermaidTransforms";
import { resolveDocumentAssetUrl, uploadDocumentAsset } from "@/lib/documentAssets";
import { isEmptyParagraph, withTrailingEditorParagraph, withoutTrailingEditorParagraph } from "../trailingEditorParagraph";

// Online documents are saved by the sidecar DB, so editing is deliberately
// debounced long enough to keep keystrokes smooth. Leaving the editor, the
// app window, or the page still flushes immediately (see listeners below).
const AUTOSAVE_DEBOUNCE_MS = 15_000;

/** The editor instance, its rich/raw mode, and everything about getting
 * content in and keeping it saved: loading stored content, the debounced
 * autosave, and switching between rich and raw-markdown modes. Split out of
 * DocEditor because it's the largest and most self-contained concern — the
 * link picker and attachment/password handling (useDocEditorLinks,
 * useDocEditorAttachments) both just take the resulting `editor`. */
export function useDocEditorContent(doc: DocumentDetail, onSave: (content: string, contentText: string, wordCount: number) => Promise<void>, onDirty: () => void) {
  const [mode, setMode] = useState<"rich" | "raw">("rich");
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [switchingMode, setSwitchingMode] = useState(false);
  // useCreateBlockNote starts with an empty document — content only lands once the
  // (off-thread, so genuinely async) parse below resolves. Without this, the editor
  // area renders blank in between: the title/tags header is already there, but the
  // body looks empty rather than loading, for however long the parse takes.
  const [richLoading, setRichLoading] = useState(true);
  const loaded = useRef(false);
  const rawDirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const editor = useCreateBlockNote({
    schema: editorSchema,
    uploadFile: (file: File) => uploadDocumentAsset(doc.id, file),
    resolveFileUrl: resolveDocumentAssetUrl,
  }, [doc.id]);

  // Load stored content (BlockNote JSON, or legacy Lexical — lazily migrated)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await contentToBlocksOffThread(doc.content);
        if (cancelled) return;
        const blocks = withTrailingEditorParagraph(liftMermaid(parsed));
        editor.replaceBlocks(editor.document, blocks as any);
      } finally {
        if (!cancelled) requestAnimationFrame(() => { loaded.current = true; setRichLoading(false); });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    onDirty();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, AUTOSAVE_DEBOUNCE_MS);
  }, [onDirty]);

  const flushSave = useCallback(async () => {
    if (!dirty.current || !loaded.current) return;
    dirty.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    try {
      const blocks = mode === "raw"
        ? liftMermaid(await markdownToBlocksOffThread(rawMarkdown))
        : withoutTrailingEditorParagraph(editor.document);
      const { content, contentText, wordCount } = await blocksToStorageOffThread(
        mode === "raw" ? blocks : lowerMermaid(blocks) as any
      );
      rawDirty.current = false;
      await onSave(content, contentText, wordCount);
      // The user kept typing while this save was in flight; schedule the next
      // debounce instead of silently leaving those changes dirty with no timer.
      if (dirty.current) scheduleSave();
    } catch (error) {
      dirty.current = true;
      throw error;
    }
  }, [editor, mode, onSave, rawMarkdown, scheduleSave]);
  flushRef.current = flushSave;

  const handleChange = useCallback(() => {
    if (!loaded.current) return;
    const cursor = editor.getTextCursorPosition();
    if (!cursor.nextBlock && !isEmptyParagraph(cursor.block)) {
      editor.insertBlocks([{ type: "paragraph" }], cursor.block, "after");
    }
    scheduleSave();
  }, [editor, scheduleSave]);

  const switchMode = useCallback(async (next: "rich" | "raw") => {
    if (next === mode || switchingMode) return;
    setSwitchingMode(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      if (next === "raw") {
        const contentBlocks = withoutTrailingEditorParagraph(editor.document);
        setRawMarkdown(await editor.blocksToMarkdownLossy(lowerMermaid(contentBlocks) as any));
      } else {
        loaded.current = false;
        setRichLoading(true);
        const blocks = liftMermaid(await markdownToBlocksOffThread(rawMarkdown));
        editor.replaceBlocks(editor.document, withTrailingEditorParagraph(blocks) as any);
        if (rawDirty.current) {
          const { content, contentText, wordCount } = await blocksToStorageOffThread(blocks);
          await onSave(content, contentText, wordCount);
          rawDirty.current = false;
          dirty.current = false;
        }
        requestAnimationFrame(() => { loaded.current = true; setRichLoading(false); });
      }
      setMode(next);
    } finally {
      setSwitchingMode(false);
    }
  }, [editor, mode, onSave, rawMarkdown, switchingMode]);

  const handleRawChange = (markdown: string) => {
    rawDirty.current = true;
    setRawMarkdown(markdown);
    scheduleSave();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushRef.current().catch(() => {});
      }
    };
    const flushPending = () => { void flushRef.current().catch(() => {}); };
    const flushWhenHidden = () => { if (document.visibilityState === "hidden") flushPending(); };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", flushPending);
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flushPending);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", flushPending);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushPending);
    };
  }, []);

  useEffect(() => () => {
    void flushRef.current().catch(() => {});
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  return {
    editor, mode, rawMarkdown, switchingMode, richLoading,
    switchMode, handleChange, handleRawChange, scheduleSave,
  };
}

export type DocEditorContentState = ReturnType<typeof useDocEditorContent>;
export type DocEditorInstance = DocEditorContentState["editor"];

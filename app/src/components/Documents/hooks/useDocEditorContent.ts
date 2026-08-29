import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentDetail } from "@/hooks/useDB";
import { blocksToMarkdownOffThread, blocksToStorageOffThread, contentToBlocksOffThread, contentToMarkdownOffThread, markdownToBlocksOffThread } from "@/lib/documentWorkerClient";
import { liftMermaid, lowerMermaid } from "../mermaidTransforms";
import { liftMedia, liftYouTube, lowerMedia, lowerYouTube, youTubeEmbedOf } from "../mediaTransforms";
import { uploadDocumentAsset } from "@/lib/documentAssets";
import type { DocEditorApi } from "../tiptap/DocEditorApi";
import type { Block } from "../tiptap/blocks";
import { isEmptyParagraph, withTrailingEditorParagraph, withoutTrailingEditorParagraph } from "../trailingEditorParagraph";
import { isLargeDocumentBlocks, isLargeDocumentText } from "../largeDocument";

// Online documents are saved by the sidecar DB, so editing is deliberately
// debounced long enough to keep keystrokes smooth. Leaving the editor, the
// app window, or the page still flushes immediately (see listeners below).
const AUTOSAVE_DEBOUNCE_MS = 15_000;
/** Ceiling: with only the debounce, someone who types without pausing never
 *  saves (every keystroke re-arms the timer). Force a flush at least this
 *  often while changes keep coming, like the local-file editor does. */
const AUTOSAVE_MAX_INTERVAL_MS = 8_000;

/** The editor instance, its rich/raw mode, and everything about getting
 * content in and keeping it saved: loading stored content, the debounced
 * autosave, and switching between rich and raw-markdown modes. Split out of
 * DocEditor because it's the largest and most self-contained concern — the
 * link picker and attachment/password handling (useDocEditorLinks,
 * useDocEditorAttachments) both just take the resulting `editor`. */
export function useDocEditorContent(doc: DocumentDetail, onSave: (content: string, contentText: string, wordCount: number) => Promise<void>, onDirty: () => void) {
  const sourceLooksLarge = isLargeDocumentText(doc.content);
  const [mode, setMode] = useState<"rich" | "raw">(sourceLooksLarge ? "raw" : "rich");
  // Live raw text in a ref, not state — it changes on every raw-mode
  // keystroke and would otherwise re-render the whole editor chrome per
  // character. The `rawMarkdown` state below only moves on mode transitions,
  // seeding the freshly mounted CodeMirror; in-session reads use this ref.
  const rawMarkdownRef = useRef("");
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
  const maxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  // The editor mounts *with* its content rather than being written into after
  // the fact, so there is no window in which an autosave could serialize an
  // empty document over a real one.
  const [editor, setEditor] = useState<DocEditorApi | null>(null);
  const [initialBlocks, setInitialBlocks] = useState<Block[] | null>(null);
  const uploadFile = useCallback((file: File) => uploadDocumentAsset(doc.id, file), [doc.id]);

  const handleEditorReady = useCallback((nextEditor: DocEditorApi) => {
    setEditor(nextEditor);
    // Parsing being finished does not mean the lazily-loaded editor has
    // finished mounting. Only release the content hook when Tiptap itself is
    // ready; TiptapDocumentEditor filters its remaining setup transactions
    // until the first interactive frame.
    loaded.current = true;
    setRichLoading(false);
  }, []);

  // Load stored content (block JSON, or legacy Lexical — lazily migrated).
  // Keyed on doc.id: a different document must re-read, and the editor is
  // remounted for it (see the `key` in DocEditor).
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        if (sourceLooksLarge) {
          // Keep parsing, legacy conversion and Markdown serialization in one
          // isolated worker. Returning a giant block tree to the renderer only
          // to turn it straight back into Markdown would itself be a long
          // structured-clone/main-thread task.
          const markdown = await contentToMarkdownOffThread(doc.content, controller.signal);
          if (cancelled) return;
          rawMarkdownRef.current = markdown;
          setRawMarkdown(markdown);
          setInitialBlocks(null);
          setMode("raw");
          loaded.current = true;
          setRichLoading(false);
          return;
        }

        const parsed = await contentToBlocksOffThread(doc.content, controller.signal);
        if (cancelled) return;
        const lifted = liftYouTube(liftMedia(liftMermaid(parsed))) as Block[];
        if (isLargeDocumentBlocks(lifted)) {
          // ProseMirror renders the whole document DOM. Large sources instead
          // start in CodeMirror, whose viewport is virtualized, so opening one
          // can never monopolize the renderer and swallow the next list click.
          const lowered = lowerYouTube(lowerMedia(lowerMermaid(lifted as any)));
          const markdown = await blocksToMarkdownOffThread(lowered, controller.signal);
          if (cancelled) return;
          rawMarkdownRef.current = markdown;
          setRawMarkdown(markdown);
          setInitialBlocks(null);
          setMode("raw");
          loaded.current = true;
          setRichLoading(false);
        } else {
          setInitialBlocks(withTrailingEditorParagraph(lifted) as Block[]);
        }
      } catch (error) {
        if ((error as { name?: string })?.name !== "AbortError") throw error;
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doc.content identity tracks doc.id.
  }, [doc.id]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    onDirty();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, AUTOSAVE_DEBOUNCE_MS);
    if (!maxSaveTimer.current) {
      maxSaveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, AUTOSAVE_MAX_INTERVAL_MS);
    }
  }, [onDirty]);

  const flushSave = useCallback(async () => {
    if (!dirty.current || !loaded.current) return;
    dirty.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    saveTimer.current = null;
    maxSaveTimer.current = null;
    try {
      const blocks = mode === "raw"
        ? liftYouTube(liftMedia(liftMermaid(await markdownToBlocksOffThread(rawMarkdownRef.current))))
        : withoutTrailingEditorParagraph(editor?.document ?? []);
      const { content, contentText, wordCount } = await blocksToStorageOffThread(
        mode === "raw" ? blocks : lowerYouTube(lowerMedia(lowerMermaid(blocks))) as any
      );
      rawDirty.current = false;
      await onSave(content, contentText, wordCount);
      // The user kept typing while this save was in flight; schedule the next
      // debounce instead of silently leaving those changes dirty with no timer.
      if (dirty.current) scheduleSave();
    } catch (error) {
      dirty.current = true;
      // Re-arm at the slow retry interval, not the typing debounce: every
      // caller of flushSave swallows this rejection, so without a timer
      // nothing would retry the failed save until the next user event (a
      // force-quit in between loses the edits) — but re-arming the 1s
      // debounce would hammer a sidecar that is down every second.
      if (!maxSaveTimer.current) {
        maxSaveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, AUTOSAVE_MAX_INTERVAL_MS);
      }
      throw error;
    }
  }, [editor, mode, onSave]);
  flushRef.current = flushSave;

  const handleChange = useCallback(() => {
    if (!loaded.current || !editor) return;
    const cursor = editor.getTextCursorPosition();

    // A YouTube link pasted into the rich editor is just a link until the
    // document is next loaded from storage, which is where `liftYouTube`
    // otherwise runs — so it would sit there as a URL for the whole session
    // and become a player only after a reopen. Promote it here instead, on
    // the block being edited, so it happens where the paste happened.
    //
    // Same test as the markdown path: the block has to be *only* the link,
    // never one inside a sentence.
    const embed = youTubeEmbedOf(cursor.block);
    if (embed) {
      const wasLast = !cursor.nextBlock;
      editor.replaceBlocks([cursor.block], [{ type: "youtube", props: embed }] as any);
      // A player is not a text block, so pasting a link at the end of the
      // document would otherwise leave nowhere to put the cursor and no way to
      // keep writing — the same reason the loader appends one.
      if (wasLast) {
        const last = editor.document[editor.document.length - 1];
        if (last) editor.insertBlocks([{ type: "paragraph" }], last, "after");
      }
      scheduleSave();
      return;
    }

    if (!cursor.nextBlock && !isEmptyParagraph(cursor.block)) {
      editor.insertBlocks([{ type: "paragraph" }], cursor.block, "after");
    }
    scheduleSave();
  }, [editor, scheduleSave]);

  const switchMode = useCallback(async (next: "rich" | "raw") => {
    if (next === mode || switchingMode) return;
    setSwitchingMode(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    saveTimer.current = null;
    maxSaveTimer.current = null;
    try {
      if (next === "raw") {
        const lowered = lowerYouTube(lowerMedia(lowerMermaid(withoutTrailingEditorParagraph(editor?.document ?? []) as any)));
        const markdown = await blocksToMarkdownOffThread(lowered);
        setRawMarkdown(markdown);
        rawMarkdownRef.current = markdown;
        // Mirror the raw→rich branch: pending edits must not be left unsaved
        // with no timer armed (they'd wait for the next blur/visibility
        // flush, which is fire-and-forget and can lose to an app quit).
        if (dirty.current) {
          const { content, contentText, wordCount } = await blocksToStorageOffThread(lowered);
          await onSave(content, contentText, wordCount);
          dirty.current = false;
          rawDirty.current = false;
        }
      } else {
        loaded.current = false;
        setRichLoading(true);
        const blocks = liftYouTube(liftMedia(liftMermaid(await markdownToBlocksOffThread(rawMarkdownRef.current))));
        setInitialBlocks(withTrailingEditorParagraph(blocks) as Block[]);
        if (rawDirty.current) {
          const { content, contentText, wordCount } = await blocksToStorageOffThread(blocks);
          await onSave(content, contentText, wordCount);
          rawDirty.current = false;
          dirty.current = false;
        }
      }
      setMode(next);
    } finally {
      setSwitchingMode(false);
    }
  }, [editor, mode, onSave, switchingMode]);

  const handleRawChange = (markdown: string) => {
    rawDirty.current = true;
    rawMarkdownRef.current = markdown;
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
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
  }, []);

  return {
    editor, handleEditorReady, initialBlocks, uploadFile,
    mode, rawMarkdown, switchingMode, richLoading,
    switchMode, handleChange, handleRawChange, scheduleSave, flushSave,
  };
}

export type DocEditorContentState = ReturnType<typeof useDocEditorContent>;
export type DocEditorInstance = DocEditorContentState["editor"];

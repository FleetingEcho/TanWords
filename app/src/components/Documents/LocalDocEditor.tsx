import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { blocksToMarkdownOffThread, blocksToMarkdownWithStatsOffThread, markdownToBlocksOffThread } from "@/lib/documentWorkerClient";
import { liftMermaid, lowerMermaid } from "./mermaidTransforms";
import { liftMedia, liftYouTube, lowerMedia, lowerYouTube } from "./mediaTransforms";
import { SaveStatus } from "./useDocumentEditor";
import { Button } from "@/components/ui/button";
import { Check, ListTree, Maximize2, Minimize2 } from "lucide-react";
import { CloseIcon } from "@/components/ui/icons";
import { RawMarkdownEditor } from "./RawMarkdownEditor";
import { blocksToText } from "@/lib/docFormat";
import { toast } from "sonner";
import { clipboardImageFiles, clipboardImageFilesOrNative } from "./clipboardImages";
import { readClipboardImage } from "@/ipc/clipboard";
import { useSettingsStore } from "@/store/settingsStore";
import { promoteLocalFileLinks } from "./localFileBlocks";
import { isEmptyParagraph, withTrailingEditorParagraph, withoutTrailingEditorParagraph } from "./trailingEditorParagraph";
import { DocumentPreviewScrollArea } from "./DocumentPreviewScrollArea";
import { DocumentContentSearch } from "./DocumentContentSearch";
import { BlockTemplatesMenu } from "./BlockTemplatesMenu";
import { DocumentOutline } from "./DocumentOutline";
import { exportEditorHtml, exportEditorPdf } from "@/lib/documentExport";
import { DocumentHistoryModal } from "./DocumentHistoryModal";
import {
  saveLocalDocumentRevision,
  listLocalDocumentRevisions,
  type DocumentRevision,
} from "@/lib/documentRevisions";
import { DocumentToolbarActions } from "./DocumentToolbarActions";
import { DocumentChromeToggle } from "./DocumentChromeToggle";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { useIsNarrow } from "@/components/Vocabulary/hooks/useMediaQuery";
import { LazyTiptapDocumentEditor } from "./tiptap/LazyTiptapDocumentEditor";
import type { DocEditorApi } from "./tiptap/DocEditorApi";
import type { Block } from "./tiptap/blocks";

type EditorMode = "rich" | "raw";

interface Props {
  relPath: string;
  initialMarkdown: string;
  initialRawMarkdown: string;
  modifiedMs: number;
  saveStatus: SaveStatus;
  /** Debounced editor content → caller persists to disk. */
  onSave: (markdown: string) => Promise<void>;
  onDirty: () => void;
  onUploadImage: (file: File) => Promise<string>;
  toRawMarkdown: (markdown: string) => string;
  toDisplayMarkdown: (markdown: string) => string;
  /** Title blur with a new file name (stem, no extension). */
  onRename: (newName: string) => void;
  zenMode: boolean;
  onZenModeChange: (enabled: boolean) => void;
}

function fileStem(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.(md|markdown)$/i, "");
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

async function readNativeClipboardImage(): Promise<File | null> {
  try {
    return await readClipboardImage();
  } catch {
    return null;
  }
}

export function LocalDocEditor({ relPath, initialMarkdown, initialRawMarkdown, modifiedMs, saveStatus, onSave, onDirty, onUploadImage, toRawMarkdown, toDisplayMarkdown, onRename, zenMode, onZenModeChange }: Props) {
  const t = useT();
  const isDark = useIsDark();
  const narrow = useIsNarrow();
  const documentFontSize = useSettingsStore((state) => state.documentFontSize);
  const setDocumentFontSize = useSettingsStore((state) => state.setDocumentFontSize);
  const [title, setTitle] = useState(fileStem(relPath));
  const [mode, setMode] = useState<EditorMode>("rich");
  const [rawMarkdown, setRawMarkdown] = useState(initialRawMarkdown);
  const [wordCount, setWordCount] = useState(() => countWords(initialMarkdown));
  // The live raw text in a ref, not state: it changes on every raw-mode
  // keystroke, and routeing that through `useState` re-rendered this
  // component (header, toolbar, everything) per character typed. State
  // (`rawMarkdown`) now moves only on mode transitions, where it seeds the
  // freshly mounted CodeMirror — reads during a session use this ref.
  const rawMarkdownRef = useRef(initialRawMarkdown);
  const [switchingMode, setSwitchingMode] = useState(false);
  // The editor starts empty — content only lands once the
  // (off-thread, so genuinely async) parse below resolves. Without this, the editor
  // area renders blank in between: the title/path header is already there, but the
  // body looks empty rather than loading, for however long the parse takes.
  const [richLoading, setRichLoading] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Outline refresh — see DocEditor: skipped while closed, throttled while
  // typing, so a keystroke no longer re-renders the whole editor chrome.
  const outlineOpenRef = useRef(outlineOpen);
  outlineOpenRef.current = outlineOpen;
  const outlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpOutlineTick = useCallback(() => {
    if (!outlineOpenRef.current || outlineTimer.current) return;
    outlineTimer.current = setTimeout(() => {
      outlineTimer.current = null;
      setOutlineTick((tick) => tick + 1);
    }, 250);
  }, []);
  const toggleOutline = useCallback(() => {
    setOutlineOpen((open) => {
      if (!open) setOutlineTick((tick) => tick + 1);
      return !open;
    });
  }, []);
  useEffect(() => () => {
    if (outlineTimer.current) clearTimeout(outlineTimer.current);
  }, []);
  // See DocEditor: the metadata/toolbar stack starts folded on phones.
  const [chromeOpen, setChromeOpen] = useState(false);
  const [outlineTick, setOutlineTick] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const searchRootRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const dirty = useRef(false);
  const lastSavedRaw = useRef(initialRawMarkdown);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  // Deps deliberately EMPTY, not [relPath]: rename keeps this component
  // mounted (LocalDocsView does not bump editorKey for it), and recreating
  // the editor here would give a brand-new EMPTY instance while the
  // content-load effect below ([] deps) never re-runs — the next autosave
  // would then write that empty document over the renamed file. File
  // switches remount via key={editorKey}, and onUploadImage only depends on
  // root (stable for the mounted folder), so nothing needs re-creation.
  // The editor mounts with its content (see the load effect below), so `editor`
  // is null until then — every consumer here guards for it.
  const [editor, setEditor] = useState<DocEditorApi | null>(null);
  const [initialBlocks, setInitialBlocks] = useState<Block[] | null>(null);

  const flushRaw = useCallback(async (markdown: string, force = false) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    saveTimer.current = null;
    maxSaveTimer.current = null;
    const changed = force || markdown !== lastSavedRaw.current;
    if (changed) {
      await onSave(markdown);
      if (markdown !== lastSavedRaw.current) {
        saveLocalDocumentRevision(relPath, {
          title,
          content: markdown,
          contentText: markdown,
          wordCount: countWords(markdown),
        });
      }
      lastSavedRaw.current = markdown;
    }
  }, [onSave, relPath, title]);

  const flushSave = useCallback(async (force = false) => {
    const hasChanges = dirty.current;
    if (!hasChanges && !force) return;
    dirty.current = false;
    try {
      let markdown = lastSavedRaw.current;
      let nextWordCount: number | null = null;
      if (hasChanges && mode === "raw") {
        markdown = rawMarkdownRef.current;
        nextWordCount = countWords(markdown);
      } else if (hasChanges && editor) {
        const result = await blocksToMarkdownWithStatsOffThread(
          lowerYouTube(lowerMedia(lowerMermaid(withoutTrailingEditorParagraph(editor.document)))) as any,
        );
        markdown = toRawMarkdown(result.markdown);
        nextWordCount = result.wordCount;
      }
      if (nextWordCount !== null) setWordCount(nextWordCount);
      await flushRaw(markdown, force);
    } catch (error) {
      dirty.current = hasChanges;
      throw error;
    }
  }, [editor, flushRaw, mode, toRawMarkdown]);
  flushRef.current = flushSave;

  const scheduleSave = useCallback(() => {
    onDirty();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 1000);
    if (!maxSaveTimer.current) {
      maxSaveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 8000);
    }
  }, [onDirty]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await markdownToBlocksOffThread(initialMarkdown);
        if (cancelled) return;
        const blocks = withTrailingEditorParagraph(promoteLocalFileLinks(liftYouTube(liftMedia(liftMermaid(parsed)))));
        // Tiptap mounts *with* its content rather than being written into
        // after the fact — one less window in which an autosave could fire
        // against an empty document.
        setInitialBlocks(blocks as Block[]);
        setWordCount(countWords(blocksToText(blocks)));
      } catch {
        if (!cancelled) setMode("raw");
      } finally {
        if (!cancelled) requestAnimationFrame(() => { loaded.current = true; setRichLoading(false); });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Rename from the list keeps this editor mounted — keep the title in sync.
  useEffect(() => { setTitle(fileStem(relPath)); }, [relPath]);

  const handleChange = useCallback(() => {
    if (!loaded.current || !editor) return;
    const cursor = editor.getTextCursorPosition();
    if (!cursor.nextBlock && !isEmptyParagraph(cursor.block)) {
      editor.insertBlocks([{ type: "paragraph" }], cursor.block, "after");
    }
    dirty.current = true;
    scheduleSave();
  }, [editor, scheduleSave]);

  const switchMode = useCallback(async (nextMode: EditorMode) => {
    if (nextMode === mode || switchingMode) return;
    setSwitchingMode(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    try {
      if (nextMode === "raw") {
        const raw = dirty.current && editor
          ? toRawMarkdown(await blocksToMarkdownOffThread(
            lowerYouTube(lowerMedia(lowerMermaid(withoutTrailingEditorParagraph(editor.document)))) as any,
          ))
          : lastSavedRaw.current;
        setRawMarkdown(raw);
        rawMarkdownRef.current = raw;
        setWordCount(countWords(raw));
        if (dirty.current && raw !== lastSavedRaw.current) {
          await onSave(raw);
          lastSavedRaw.current = raw;
          dirty.current = false;
        }
        dirty.current = false;
        setMode("raw");
      } else {
        loaded.current = false;
        setRichLoading(true);
        const rawText = rawMarkdownRef.current;
        const parsed = promoteLocalFileLinks(
          liftYouTube(liftMedia(liftMermaid(await markdownToBlocksOffThread(toDisplayMarkdown(rawText)))))
        );
        setInitialBlocks(withTrailingEditorParagraph(parsed) as Block[]);
        setWordCount(countWords(blocksToText(parsed)));
        if (dirty.current && rawText !== lastSavedRaw.current) {
          await onSave(rawText);
          lastSavedRaw.current = rawText;
          dirty.current = false;
        }
        dirty.current = false;
        setMode("rich");
        requestAnimationFrame(() => { loaded.current = true; setRichLoading(false); });
      }
    } catch {
      if (nextMode === "rich") {
        setMode("raw");
        setRichLoading(false);
        loaded.current = true;
      }
    } finally {
      setSwitchingMode(false);
    }
  }, [editor, mode, onSave, switchingMode, toDisplayMarkdown, toRawMarkdown]);

  const handleRawChange = (markdown: string) => {
    dirty.current = true;
    rawMarkdownRef.current = markdown;
    scheduleSave();
  };

  const insertAttachment = async (file: File | undefined) => {
    if (!file || !editor) return;
    try {
      const url = await onUploadImage(file);
      const type = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("audio/") ? "audio"
        : file.type.startsWith("video/") ? "video"
        : "file";
      editor.insertBlocks([{
        type,
        props: { url, name: file.name || "attachment" },
      } as any], editor.getTextCursorPosition().block, "after");
      dirty.current = true;
      scheduleSave();
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleImagePaste = (event: React.ClipboardEvent) => {
    const webImages = clipboardImageFiles(event.clipboardData);
    const advertisesImage = Array.from(event.clipboardData.types)
      .some((type) => type.startsWith("image/"));
    if (webImages.length > 0 || advertisesImage) {
      event.preventDefault();
      event.stopPropagation();
    }
    // Handle clipboard image blobs explicitly. Some desktop WebViews don't
    // expose them as Files at all, so fall back to Tauri's native clipboard.
    void (async () => {
      const images = await clipboardImageFilesOrNative(
        event.clipboardData,
        readNativeClipboardImage,
      );
      for (const image of images) await insertAttachment(image);
    })();
  };


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushRef.current(true).catch((error) => toast.error(String(error)));
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

  const handleTitleBlur = () => {
    const val = title.trim();
    if (!val || val === fileStem(relPath)) {
      setTitle(fileStem(relPath));
      return;
    }
    onRename(val);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filename as title */}
      <div className="px-4 lg:px-12 pt-3 pb-1 lg:pt-8 lg:pb-2 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onZenModeChange(!zenMode)}
            title={zenMode ? t("doc.exitZenMode") : t("doc.zenMode")}
            aria-label={zenMode ? t("doc.exitZenMode") : t("doc.zenMode")}
            className="h-8 w-8 shrink-0 text-muted-foreground"
          >
            {zenMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); titleRef.current?.blur(); } }}
            placeholder={t("doc.untitled")}
            className="document-editor-title min-w-0 flex-1 font-bold tracking-tight bg-transparent border-none outline-hidden placeholder:text-muted-foreground/30 text-foreground"
          />
          <DocumentChromeToggle open={chromeOpen} onToggle={() => setChromeOpen((v) => !v)} />
        </div>
        <div className={`${chromeOpen ? "block" : "hidden"} mt-1 space-y-1.5 lg:mt-2 lg:block lg:space-y-2`}>
          <p className="truncate text-xs font-mono text-muted-foreground/60">{relPath}</p>
          <div className="flex items-center gap-2">
            {mode === "rich" && <DocumentContentSearch rootRef={searchRootRef} className="w-full lg:w-[30%]" />}
            <DocumentToolbarActions
              mode={mode}
              switching={switchingMode}
              onMode={(nextMode) => void switchMode(nextMode)}
              onAttach={() => attachmentInputRef.current?.click()}
              templatesMenu={editor ? <BlockTemplatesMenu editor={editor} /> : null}
              outlineActive={outlineOpen}
              onToggleOutline={toggleOutline}
              onHistory={() => setHistoryOpen(true)}
              onExportHtml={() => editor && void exportEditorHtml(editor, title).catch((error) => toast.error(String(error)))}
              onExportPdf={() => editor && void exportEditorPdf(editor, title).catch((error) => toast.error(String(error)))}
              documentFontSize={documentFontSize}
              onFontSizeChange={setDocumentFontSize}
            />
          </div>
        </div>
        <div className="mt-1.5 border-b border-border/60 lg:mt-3" />
        <input ref={attachmentInputRef} type="file" className="hidden"
          onChange={(event) => { void insertAttachment(event.target.files?.[0]); event.target.value = ""; }} />
      </div>

      {mode === "rich" ? (
        <div ref={searchRootRef} className="contents">
          <div className="flex min-h-0 flex-1">
            <DocumentPreviewScrollArea>
              {richLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
                  <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              )}
              {initialBlocks && (
                <LazyTiptapDocumentEditor
                  // Remount on a mode switch so the editor mounts with its
                  // content rather than being written into afterwards.
                  key={`${relPath}-${mode}`}
                  initialBlocks={initialBlocks}
                  isDark={isDark}
                  onUploadFile={onUploadImage}
                  readNativeImage={readNativeClipboardImage}
                  onReady={setEditor}
                  onError={(message) => toast.error(message)}
                  onChange={() => { bumpOutlineTick(); handleChange(); }}
                  className="tanwords-editor"
                />
              )}
            </DocumentPreviewScrollArea>
            {outlineOpen && !narrow && editor && (
              <div className="w-56 shrink-0">
                <DocumentOutline editor={editor} tick={outlineTick} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <RawMarkdownEditor
          value={rawMarkdown}
          onChange={handleRawChange}
          label={t("doc.rawMode")}
          placeholderText={t("doc.rawPlaceholder")}
          onUploadFile={onUploadImage}
          readNativeImage={readNativeClipboardImage}
        />
      )}

      {/* See DocEditor: on phones the outline is a jump-and-dismiss modal
        * rather than a column that competes with the document for width. */}
      {narrow && editor && (
        <Dialog open={outlineOpen} onClose={() => setOutlineOpen(false)} maxWidth="max-w-sm">
          <div className="relative border-b border-border px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <ListTree className="h-4 w-4 text-muted-foreground" />
              {t("doc.outline")}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOutlineOpen(false)}
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
            onNavigate={() => setOutlineOpen(false)}
          />
        </Dialog>
      )}

      {/* Footer: save status */}
      <div className="h-auto min-h-9 px-4 lg:px-12 border-t border-border flex flex-wrap items-center gap-3 py-2 text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
        <span>
          {saveStatus === "saving" ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-muted-foreground border-t-transparent rounded-full animate-spin" />
              {t("doc.saving")}
            </span>
          ) : saveStatus === "saved" ? (
            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> {t("doc.savedToDisk")}</span>
          ) : saveStatus === "dirty" ? (
            <span>{t("doc.unsavedChanges")}</span>
          ) : null}
        </span>
        <span className="ml-auto">{t("doc.wordCount", { n: wordCount })}</span>
        <span>{modifiedMs ? new Date(modifiedMs).toLocaleString() : ""}</span>
      </div>
      <DocumentHistoryModal
        open={historyOpen}
        revisions={listLocalDocumentRevisions(relPath)}
        onClose={() => setHistoryOpen(false)}
        onRestore={(revision: DocumentRevision) => {
          void (async () => {
            if (!editor) return;
            const blocks = await markdownToBlocksOffThread(revision.content);
            editor.replaceBlocks(
              editor.document,
              withTrailingEditorParagraph(promoteLocalFileLinks(liftYouTube(liftMedia(liftMermaid(blocks))))) as any,
            );
            dirty.current = true;
            scheduleSave();
          })().catch((error) => toast.error(String(error)));
        }}
      />
    </div>
  );
}

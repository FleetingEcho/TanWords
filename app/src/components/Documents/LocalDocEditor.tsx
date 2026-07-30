import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { editorSchema } from "./editorSchema";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { blocksToMarkdownOffThread, blocksToMarkdownWithStatsOffThread, markdownToBlocksOffThread } from "@/lib/documentWorkerClient";
import { liftMermaid, lowerMermaid } from "./mermaidTransforms";
import { CheckIcon } from "@heroicons/react/24/solid";
import { SaveStatus } from "./useDocumentEditor";
import { Button } from "@/components/ui/button";
import { Code2, Eye, Maximize2, Minimize2, Paperclip } from "lucide-react";
import { RawMarkdownEditor } from "./RawMarkdownEditor";
import { blocksToText } from "@/lib/docFormat";
import { toast } from "sonner";
import { selectRichEditorContents } from "./editorSelection";
import { clipboardImageFiles, clipboardImageFilesOrNative } from "./clipboardImages";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { useSettingsStore } from "@/store/settingsStore";
import { promoteLocalFileLinks } from "./localFileBlocks";
import { isEmptyParagraph, withTrailingEditorParagraph, withoutTrailingEditorParagraph } from "./trailingEditorParagraph";
import { DocumentPreviewScrollArea } from "./DocumentPreviewScrollArea";
import { DocumentContentSearch } from "./DocumentContentSearch";

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
    const image = await readImage();
    const [rgba, size] = await Promise.all([
      image.rgba(),
      image.size(),
    ]);
    const { width, height } = size;
    if (!width || !height || rgba.length === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable");
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("Clipboard image conversion failed")),
        "image/png",
      )
    );
    return new File([blob], `clipboard-${Date.now()}.png`, { type: "image/png" });
  } catch {
    return null;
  }
}

export function LocalDocEditor({ relPath, initialMarkdown, initialRawMarkdown, modifiedMs, saveStatus, onSave, onDirty, onUploadImage, toRawMarkdown, toDisplayMarkdown, onRename, zenMode, onZenModeChange }: Props) {
  const t = useT();
  const isDark = useIsDark();
  const documentFontSize = useSettingsStore((state) => state.documentFontSize);
  const setDocumentFontSize = useSettingsStore((state) => state.setDocumentFontSize);
  const [title, setTitle] = useState(fileStem(relPath));
  const [mode, setMode] = useState<EditorMode>("rich");
  const [rawMarkdown, setRawMarkdown] = useState(initialRawMarkdown);
  const [wordCount, setWordCount] = useState(() => countWords(initialMarkdown));
  const [switchingMode, setSwitchingMode] = useState(false);
  // useCreateBlockNote starts with an empty document — content only lands once the
  // (off-thread, so genuinely async) parse below resolves. Without this, the editor
  // area renders blank in between: the title/path header is already there, but the
  // body looks empty rather than loading, for however long the parse takes.
  const [richLoading, setRichLoading] = useState(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const searchRootRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const dirty = useRef(false);
  const lastSavedRaw = useRef(initialRawMarkdown);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  const editor = useCreateBlockNote({
    schema: editorSchema,
    uploadFile: onUploadImage,
  }, [relPath]);

  const flushRaw = useCallback(async (markdown: string, force = false) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    saveTimer.current = null;
    maxSaveTimer.current = null;
    if (force || markdown !== lastSavedRaw.current) {
      await onSave(markdown);
      lastSavedRaw.current = markdown;
    }
  }, [onSave]);

  const flushSave = useCallback(async (force = false) => {
    const hasChanges = dirty.current;
    if (!hasChanges && !force) return;
    dirty.current = false;
    try {
      let markdown = lastSavedRaw.current;
      let nextWordCount: number | null = null;
      if (hasChanges && mode === "raw") {
        markdown = rawMarkdown;
        nextWordCount = countWords(markdown);
      } else if (hasChanges) {
        const result = await blocksToMarkdownWithStatsOffThread(
          lowerMermaid(withoutTrailingEditorParagraph(editor.document)) as any,
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
  }, [editor, flushRaw, mode, rawMarkdown, toRawMarkdown]);
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
        const blocks = withTrailingEditorParagraph(promoteLocalFileLinks(liftMermaid(parsed)));
        editor.replaceBlocks(editor.document, blocks as any);
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
    if (!loaded.current) return;
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
        const raw = dirty.current
          ? toRawMarkdown(await blocksToMarkdownOffThread(
            lowerMermaid(withoutTrailingEditorParagraph(editor.document)) as any,
          ))
          : lastSavedRaw.current;
        setRawMarkdown(raw);
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
        const parsed = promoteLocalFileLinks(
          liftMermaid(await markdownToBlocksOffThread(toDisplayMarkdown(rawMarkdown)))
        );
        editor.replaceBlocks(editor.document, withTrailingEditorParagraph(parsed) as any);
        setWordCount(countWords(blocksToText(parsed)));
        if (dirty.current && rawMarkdown !== lastSavedRaw.current) {
          await onSave(rawMarkdown);
          lastSavedRaw.current = rawMarkdown;
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
  }, [editor, mode, onSave, rawMarkdown, switchingMode, toDisplayMarkdown, toRawMarkdown]);

  const handleRawChange = (markdown: string) => {
    dirty.current = true;
    setRawMarkdown(markdown);
    scheduleSave();
  };

  const insertAttachment = async (file: File | undefined) => {
    if (!file) return;
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

  const handleRichEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") return;
    if (!(event.target as Element).closest(".bn-editor")) return;
    event.preventDefault();
    event.stopPropagation();
    selectRichEditorContents(event.currentTarget);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushRef.current(true).catch((error) => toast.error(String(error)));
      }
    };
    const flushPending = () => { void flushRef.current().catch(() => {}); };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", flushPending);
    window.addEventListener("pagehide", flushPending);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", flushPending);
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
      <div className="px-12 pt-8 pb-2 shrink-0">
        <div className="flex items-start gap-3">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); titleRef.current?.blur(); } }}
            placeholder={t("doc.untitled")}
            className="document-editor-title flex-1 font-bold tracking-tight bg-transparent border-none outline-none placeholder:text-muted-foreground/30 text-foreground"
          />
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
        </div>
        <div className="mt-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs font-mono text-muted-foreground/60">{relPath}</p>
          <div className="flex items-center rounded-md bg-muted p-0.5">
            {mode === "rich" && <DocumentContentSearch rootRef={searchRootRef} />}
            <Button type="button" variant="ghost" onClick={() => attachmentInputRef.current?.click()}
              title={t("doc.attachFile")} className="h-6 gap-1 px-2 text-[10px]">
              <Paperclip className="h-3 w-3" /> {t("doc.attach")}
            </Button>
            <Button type="button" variant="ghost" disabled={switchingMode} onClick={() => void switchMode("rich")} className={`h-6 gap-1 px-2 text-[10px] ${mode === "rich" ? "bg-background shadow-sm" : ""}`}>
              <Eye className="h-3 w-3" /> {t("doc.richMode")}
            </Button>
            <Button type="button" variant="ghost" disabled={switchingMode} onClick={() => void switchMode("raw")} className={`h-6 gap-1 px-2 text-[10px] ${mode === "raw" ? "bg-background shadow-sm" : ""}`}>
              <Code2 className="h-3 w-3" /> {t("doc.rawMode")}
            </Button>
            <span className="mx-0.5 h-3.5 w-px bg-border" />
            <Button type="button" variant="ghost" size="icon"
              disabled={documentFontSize <= 12}
              onClick={() => setDocumentFontSize(documentFontSize - 1)}
              title={`${t("settings.documentFontSize")}: ${documentFontSize - 1}px`}
              aria-label={`${t("settings.documentFontSize")} -`}
              className="h-6 w-auto rounded-md px-1.5 text-[11px] font-semibold text-muted-foreground">
              A−
            </Button>
            <Button type="button" variant="ghost" size="icon"
              disabled={documentFontSize >= 24}
              onClick={() => setDocumentFontSize(documentFontSize + 1)}
              title={`${t("settings.documentFontSize")}: ${documentFontSize + 1}px`}
              aria-label={`${t("settings.documentFontSize")} +`}
              className="h-6 w-auto rounded-md px-1.5 text-[13px] font-semibold text-muted-foreground">
              A+
            </Button>
          </div>
        </div>
        <div className="mt-3 border-b border-border/60" />
        <input ref={attachmentInputRef} type="file" className="hidden"
          onChange={(event) => { void insertAttachment(event.target.files?.[0]); event.target.value = ""; }} />
      </div>

      {mode === "rich" ? (
        <div ref={searchRootRef} className="contents">
          <DocumentPreviewScrollArea onPasteCapture={handleImagePaste}
            onKeyDownCapture={handleRichEditorKeyDown}>
            {richLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
                <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
            <BlockNoteView editor={editor} theme={isDark ? "dark" : "light"} onChange={handleChange}
              className="tanwords-editor" />
          </DocumentPreviewScrollArea>
        </div>
      ) : (
        <RawMarkdownEditor value={rawMarkdown} onChange={handleRawChange} label={t("doc.rawMode")} />
      )}

      {/* Footer: save status */}
      <div className="h-9 px-12 border-t border-border flex items-center gap-3 text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
        <span>
          {saveStatus === "saving" ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-muted-foreground border-t-transparent rounded-full animate-spin" />
              {t("doc.saving")}
            </span>
          ) : saveStatus === "saved" ? (
            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckIcon className="w-3 h-3" /> {t("doc.savedToDisk")}</span>
          ) : saveStatus === "dirty" ? (
            <span>{t("doc.unsavedChanges")}</span>
          ) : null}
        </span>
        <span className="ml-auto">{t("doc.wordCount", { n: wordCount })}</span>
        <span>{modifiedMs ? new Date(modifiedMs).toLocaleString() : ""}</span>
      </div>
    </div>
  );
}

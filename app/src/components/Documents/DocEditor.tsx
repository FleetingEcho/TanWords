import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { editorSchema } from "./editorSchema";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { DocumentDetail } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { blocksToStorageOffThread, contentToBlocksOffThread, markdownToBlocksOffThread } from "@/lib/documentWorkerClient";
import { parseDbTimestamp } from "@/lib/dbTime";
import { liftMermaid, lowerMermaid } from "./mermaidTransforms";
import { PinIcon } from "@/components/ui/icons";
import { CheckIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";
import { Code2, Eye, Link2, Paperclip, Search } from "lucide-react";
import { RawMarkdownEditor } from "./RawMarkdownEditor";
import { resolveDocumentAssetUrl, uploadDocumentAsset } from "@/lib/documentAssets";
import type { SaveStatus } from "./useDocumentEditor";
import { invoke } from "@tauri-apps/api/core";
import { Dialog, DialogTitle } from "@/components/ui/dialog";

interface Props {
  doc: DocumentDetail;
  onSave: (content: string, contentText: string, wordCount: number) => Promise<void>;
  onDirty: () => void;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string) => void;
  onPinToggle: () => void;
  saveStatus: SaveStatus;
}

interface DocumentLinkItem { id: number; title: string }
interface DocumentLinkContext {
  outgoing: DocumentLinkItem[];
  backlinks: DocumentLinkItem[];
  candidates: DocumentLinkItem[];
}

export function DocEditor({ doc, onSave, onDirty, onTitleChange, onTagsChange, onPinToggle, saveStatus }: Props) {
  const t = useT();
  const isDark = useIsDark();
  const [title, setTitle] = useState(doc.title);
  const [tagsInput, setTagsInput] = useState(
    (() => { try { return (JSON.parse(doc.tags) as string[]).join(", "); } catch { return ""; } })()
  );
  const [mode, setMode] = useState<"rich" | "raw">("rich");
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [switchingMode, setSwitchingMode] = useState(false);
  // useCreateBlockNote starts with an empty document — content only lands once the
  // (off-thread, so genuinely async) parse below resolves. Without this, the editor
  // area renders blank in between: the title/tags header is already there, but the
  // body looks empty rather than loading, for however long the parse takes.
  const [richLoading, setRichLoading] = useState(true);
  const [linkContext, setLinkContext] = useState<DocumentLinkContext>({ outgoing: [], backlinks: [], candidates: [] });
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  const rawDirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const editor = useCreateBlockNote({
    schema: editorSchema,
    uploadFile: (file) => uploadDocumentAsset(doc.id, file),
    resolveFileUrl: resolveDocumentAssetUrl,
  }, [doc.id]);

  // Load stored content (BlockNote JSON, or legacy Lexical — lazily migrated)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await contentToBlocksOffThread(doc.content);
        if (cancelled) return;
        const blocks = liftMermaid(parsed);
        if (blocks.length > 0) editor.replaceBlocks(editor.document, blocks);
      } finally {
        if (!cancelled) requestAnimationFrame(() => { loaded.current = true; setRichLoading(false); });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    invoke<DocumentLinkContext>("db_get_document_link_context", { documentId: doc.id })
      .then(setLinkContext)
      .catch(() => {});
  }, [doc.id, doc.content]);

  const insertDocumentLink = (target: DocumentLinkItem) => {
    editor.insertInlineContent([{
      type: "link",
      href: `tanwords-doc://${target.id}`,
      content: target.title,
    }]);
    setLinkPickerOpen(false);
    setLinkQuery("");
    scheduleSave();
  };

  const insertAttachment = async (file: File | undefined) => {
    if (!file) return;
    const url = await uploadDocumentAsset(doc.id, file);
    const type = file.type.startsWith("image/") ? "image"
      : file.type.startsWith("audio/") ? "audio"
      : file.type.startsWith("video/") ? "video"
      : "file";
    const current = editor.getTextCursorPosition().block;
    editor.insertBlocks([{
      type,
      props: { url, name: file.name || "attachment" },
    } as any], current, "after");
    scheduleSave();
  };

  const handleEditorClick = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='tanwords-doc://']");
    if (!anchor) return;
    event.preventDefault();
    const id = Number(anchor.getAttribute("href")?.slice("tanwords-doc://".length));
    if (id > 0) window.dispatchEvent(new CustomEvent("tanwords:open-document", { detail: { id } }));
  };

  const flushSave = useCallback(async () => {
    if (!dirty.current || !loaded.current) return;
    dirty.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    saveTimer.current = null;
    maxSaveTimer.current = null;
    try {
      const blocks = mode === "raw"
        ? liftMermaid(await markdownToBlocksOffThread(rawMarkdown))
        : structuredClone(editor.document);
      const { content, contentText, wordCount } = await blocksToStorageOffThread(
        mode === "raw" ? blocks : lowerMermaid(blocks) as any
      );
      rawDirty.current = false;
      await onSave(content, contentText, wordCount);
    } catch (error) {
      dirty.current = true;
      throw error;
    }
  }, [editor, mode, onSave, rawMarkdown]);
  flushRef.current = flushSave;

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    onDirty();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 1000);
    if (!maxSaveTimer.current) {
      maxSaveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 8000);
    }
  }, [onDirty]);

  const handleChange = useCallback(() => {
    if (!loaded.current) return;
    scheduleSave();
  }, [scheduleSave]);

  const switchMode = useCallback(async (next: "rich" | "raw") => {
    if (next === mode || switchingMode) return;
    setSwitchingMode(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    try {
      if (next === "raw") {
        setRawMarkdown(await editor.blocksToMarkdownLossy(lowerMermaid(editor.document) as any));
      } else {
        loaded.current = false;
        setRichLoading(true);
        const blocks = liftMermaid(await markdownToBlocksOffThread(rawMarkdown));
        editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph" }]);
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
    const val = title.trim() || t("doc.untitled");
    setTitle(val);
    onTitleChange(val);
  };

  const handleTagsBlur = () => {
    const tags = tagsInput.split(",").map((s) => s.trim()).filter(Boolean);
    onTagsChange(JSON.stringify(tags));
  };

  const tagChips = tagsInput.split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <div className="flex flex-col h-full">
      {/* Title + metadata */}
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
            className="flex-1 text-3xl font-bold tracking-tight bg-transparent border-none outline-none placeholder:text-muted-foreground/30 text-foreground"
          />
          <Button
            variant="ghost"
            onClick={onPinToggle}
            title={doc.pinned ? t("doc.unpin") : t("doc.pin")}
            className={`mt-2 w-8 h-8 p-0 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
              doc.pinned
                ? "text-amber-500 bg-amber-500/10 hover:bg-amber-500/10"
                : "text-muted-foreground/50 hover:text-foreground hover:bg-muted"
            }`}
          >
            <PinIcon filled={doc.pinned} className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0">
            <path d="M3.5 10.5v-6a1 1 0 011-1h6l6 6-7 7-6-6z" strokeLinejoin="round" />
            <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
          </svg>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onBlur={handleTagsBlur}
            placeholder={t("doc.tagsPlaceholder")}
            className="flex-1 text-xs bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40"
          />
          {tagChips.length > 0 && (
            <div className="flex gap-1 shrink-0">
              {tagChips.slice(0, 4).map((tag) => (
                <span key={tag} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center rounded-md bg-muted p-0.5">
            <Button type="button" variant="ghost" onClick={() => attachmentInputRef.current?.click()}
              title={t("doc.attachFile")} className="h-6 gap-1 px-2 text-[10px]">
              <Paperclip className="h-3 w-3" /> {t("doc.attach")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setLinkPickerOpen(true)}
              title={t("doc.insertDocumentLink")} className="h-6 gap-1 px-2 text-[10px]">
              <Link2 className="h-3 w-3" /> {t("doc.link")}
            </Button>
            <Button type="button" variant="ghost" disabled={switchingMode} onClick={() => void switchMode("rich")} className={`h-6 gap-1 px-2 text-[10px] ${mode === "rich" ? "bg-background shadow-sm" : ""}`}>
              <Eye className="h-3 w-3" /> {t("doc.richMode")}
            </Button>
            <Button type="button" variant="ghost" disabled={switchingMode} onClick={() => void switchMode("raw")} className={`h-6 gap-1 px-2 text-[10px] ${mode === "raw" ? "bg-background shadow-sm" : ""}`}>
              <Code2 className="h-3 w-3" /> {t("doc.rawMode")}
            </Button>
          </div>
        </div>
        <div className="mt-3 border-b border-border/60" />
        <input ref={attachmentInputRef} type="file" className="hidden"
          onChange={(event) => { void insertAttachment(event.target.files?.[0]); event.target.value = ""; }} />
      </div>

      {mode === "rich" ? (
        <div className="flex-1 overflow-y-auto relative" onClickCapture={handleEditorClick}>
          {richLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
              <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}
          <BlockNoteView editor={editor} theme={isDark ? "dark" : "light"} onChange={handleChange}
            className="tanwords-editor" />
        </div>
      ) : (
        <RawMarkdownEditor value={rawMarkdown} onChange={handleRawChange} label={t("doc.rawMode")} />
      )}

      {(linkContext.outgoing.length > 0 || linkContext.backlinks.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-12 py-2 text-[10px]">
          {linkContext.outgoing.length > 0 && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Link2 className="h-3 w-3" /> {t("doc.outgoingLinks")}:
              {linkContext.outgoing.map((item) => (
                <button key={item.id} onClick={() => window.dispatchEvent(new CustomEvent("tanwords:open-document", { detail: { id: item.id } }))}
                  className="text-primary hover:underline">{item.title}</button>
              ))}
            </span>
          )}
          {linkContext.backlinks.length > 0 && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {t("doc.backlinks")}:
              {linkContext.backlinks.map((item) => (
                <button key={item.id} onClick={() => window.dispatchEvent(new CustomEvent("tanwords:open-document", { detail: { id: item.id } }))}
                  className="text-primary hover:underline">{item.title}</button>
              ))}
            </span>
          )}
        </div>
      )}

      {/* Footer: save status + word count */}
      <div className="px-12 py-2.5 border-t border-border flex items-center gap-3 text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
        <span>
          {saveStatus === "saving" ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-muted-foreground border-t-transparent rounded-full animate-spin" />
              {t("doc.saving")}
            </span>
          ) : saveStatus === "saved" ? (
            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckIcon className="w-3 h-3" /> {t("doc.autoSaved")}</span>
          ) : saveStatus === "dirty" ? (
            <span>{t("doc.unsavedChanges")}</span>
          ) : null}
        </span>
        <span className="ml-auto">{t("doc.wordCount", { n: doc.word_count })}</span>
        <span>{parseDbTimestamp(doc.updated_at).toLocaleDateString()}</span>
      </div>

      <Dialog open={linkPickerOpen} onClose={() => setLinkPickerOpen(false)} maxWidth="max-w-md" className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold">{t("doc.insertDocumentLink")}</DialogTitle>
        </div>
        <div className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input autoFocus value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)}
              placeholder={t("doc.searchDocumentsToLink")}
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="mt-3 max-h-80 overflow-y-auto">
            {linkContext.candidates
              .filter((item) => item.title.toLowerCase().includes(linkQuery.trim().toLowerCase()))
              .map((item) => (
                <button key={item.id} onClick={() => insertDocumentLink(item)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

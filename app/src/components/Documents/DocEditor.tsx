import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { editorSchema } from "./editorSchema";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { DocumentDetail } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { blocksToStorage, contentToBlocks, editorToStorage, markdownToBlocks } from "@/lib/docFormat";
import { liftMermaid, lowerMermaid } from "./mermaidTransforms";
import { PinIcon } from "@/components/ui/icons";
import { CheckIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";
import { Code2, Eye } from "lucide-react";
import { RawMarkdownEditor } from "./RawMarkdownEditor";

interface Props {
  doc: DocumentDetail;
  onSave: (content: string, contentText: string, wordCount: number) => void;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string) => void;
  onPinToggle: () => void;
  saveStatus: "saved" | "saving" | "idle";
}

export function DocEditor({ doc, onSave, onTitleChange, onTagsChange, onPinToggle, saveStatus }: Props) {
  const t = useT();
  const isDark = useIsDark();
  const [title, setTitle] = useState(doc.title);
  const [tagsInput, setTagsInput] = useState(
    (() => { try { return (JSON.parse(doc.tags) as string[]).join(", "); } catch { return ""; } })()
  );
  const [mode, setMode] = useState<"rich" | "raw">("rich");
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [switchingMode, setSwitchingMode] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  const rawDirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useCreateBlockNote({ schema: editorSchema });

  // Load stored content (BlockNote JSON, or legacy Lexical — lazily migrated)
  useEffect(() => {
    let cancelled = false;
    contentToBlocks(doc.content).then((parsed) => {
      if (cancelled) return;
      const blocks = liftMermaid(parsed);
      if (blocks.length > 0) editor.replaceBlocks(editor.document, blocks);
      // Enable saving only after initial content is in place
      requestAnimationFrame(() => { loaded.current = true; });
    });
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback(() => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { content, contentText, wordCount } = editorToStorage(editor);
      onSave(content, contentText, wordCount);
    }, 500);
  }, [editor, onSave]);

  const switchMode = useCallback(async (next: "rich" | "raw") => {
    if (next === mode || switchingMode) return;
    setSwitchingMode(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      if (next === "raw") {
        setRawMarkdown(await editor.blocksToMarkdownLossy(lowerMermaid(editor.document) as any));
      } else {
        loaded.current = false;
        const blocks = liftMermaid(await markdownToBlocks(rawMarkdown));
        editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph" }]);
        if (rawDirty.current) {
          const { content, contentText, wordCount } = blocksToStorage(blocks);
          onSave(content, contentText, wordCount);
          rawDirty.current = false;
        }
        requestAnimationFrame(() => { loaded.current = true; });
      }
      setMode(next);
    } finally {
      setSwitchingMode(false);
    }
  }, [editor, mode, onSave, rawMarkdown, switchingMode]);

  const handleRawChange = (markdown: string) => {
    rawDirty.current = true;
    setRawMarkdown(markdown);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const blocks = liftMermaid(await markdownToBlocks(markdown));
      const { content, contentText, wordCount } = blocksToStorage(blocks);
      onSave(content, contentText, wordCount);
      rawDirty.current = false;
    }, 500);
  };

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

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
            <Button type="button" variant="ghost" disabled={switchingMode} onClick={() => void switchMode("rich")} className={`h-6 gap-1 px-2 text-[10px] ${mode === "rich" ? "bg-background shadow-sm" : ""}`}>
              <Eye className="h-3 w-3" /> {t("doc.richMode")}
            </Button>
            <Button type="button" variant="ghost" disabled={switchingMode} onClick={() => void switchMode("raw")} className={`h-6 gap-1 px-2 text-[10px] ${mode === "raw" ? "bg-background shadow-sm" : ""}`}>
              <Code2 className="h-3 w-3" /> {t("doc.rawMode")}
            </Button>
          </div>
        </div>
        <div className="mt-3 border-b border-border/60" />
      </div>

      {mode === "rich" ? (
        <div className="flex-1 overflow-y-auto">
          <BlockNoteView editor={editor} theme={isDark ? "dark" : "light"} onChange={handleChange} className="tanwords-editor" />
        </div>
      ) : (
        <RawMarkdownEditor value={rawMarkdown} onChange={handleRawChange} label={t("doc.rawMode")} />
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
          ) : null}
        </span>
        <span className="ml-auto">{t("doc.wordCount", { n: doc.word_count })}</span>
        <span>{new Date(doc.updated_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

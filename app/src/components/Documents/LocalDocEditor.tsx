import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { editorSchema } from "./editorSchema";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { markdownToBlocks } from "@/lib/docFormat";
import { liftMermaid, lowerMermaid } from "./mermaidTransforms";
import { CheckIcon } from "@heroicons/react/24/solid";
import { SaveStatus } from "./useDocumentEditor";
import { Button } from "@/components/ui/button";
import { Code2, Eye, Maximize2, Minimize2 } from "lucide-react";
import { RawMarkdownEditor } from "./RawMarkdownEditor";

type EditorMode = "rich" | "raw";

interface Props {
  relPath: string;
  initialMarkdown: string;
  initialRawMarkdown: string;
  modifiedMs: number;
  saveStatus: SaveStatus;
  /** Debounced editor content → caller persists to disk. */
  onSave: (markdown: string) => void;
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

export function LocalDocEditor({ relPath, initialMarkdown, initialRawMarkdown, modifiedMs, saveStatus, onSave, toRawMarkdown, toDisplayMarkdown, onRename, zenMode, onZenModeChange }: Props) {
  const t = useT();
  const isDark = useIsDark();
  const [title, setTitle] = useState(fileStem(relPath));
  const [mode, setMode] = useState<EditorMode>("rich");
  const [rawMarkdown, setRawMarkdown] = useState(initialRawMarkdown);
  const [switchingMode, setSwitchingMode] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  const dirty = useRef(false);
  const lastSavedRaw = useRef(initialRawMarkdown);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useCreateBlockNote({ schema: editorSchema });

  const scheduleSave = useCallback((markdown: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (markdown !== lastSavedRaw.current) {
        onSave(markdown);
        lastSavedRaw.current = markdown;
      }
      dirty.current = false;
    }, 500);
  }, [onSave]);

  useEffect(() => {
    let cancelled = false;
    markdownToBlocks(initialMarkdown).then((parsed) => {
      if (cancelled) return;
      const blocks = liftMermaid(parsed);
      if (blocks.length > 0) editor.replaceBlocks(editor.document, blocks);
      requestAnimationFrame(() => { loaded.current = true; });
    });
    return () => { cancelled = true; };
  }, []);

  // Rename from the list keeps this editor mounted — keep the title in sync.
  useEffect(() => { setTitle(fileStem(relPath)); }, [relPath]);

  const handleChange = useCallback(() => {
    if (!loaded.current) return;
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const markdown = await editor.blocksToMarkdownLossy(lowerMermaid(editor.document) as any);
      const raw = toRawMarkdown(markdown);
      if (raw !== lastSavedRaw.current) {
        onSave(raw);
        lastSavedRaw.current = raw;
      }
      dirty.current = false;
    }, 500);
  }, [editor, onSave, toRawMarkdown]);

  const switchMode = useCallback(async (nextMode: EditorMode) => {
    if (nextMode === mode || switchingMode) return;
    setSwitchingMode(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      if (nextMode === "raw") {
        const raw = dirty.current
          ? toRawMarkdown(await editor.blocksToMarkdownLossy(lowerMermaid(editor.document) as any))
          : lastSavedRaw.current;
        setRawMarkdown(raw);
        if (dirty.current && raw !== lastSavedRaw.current) {
          onSave(raw);
          lastSavedRaw.current = raw;
        }
        dirty.current = false;
        setMode("raw");
      } else {
        loaded.current = false;
        const parsed = liftMermaid(await markdownToBlocks(toDisplayMarkdown(rawMarkdown)));
        editor.replaceBlocks(editor.document, parsed.length ? parsed : [{ type: "paragraph" }]);
        if (dirty.current && rawMarkdown !== lastSavedRaw.current) {
          onSave(rawMarkdown);
          lastSavedRaw.current = rawMarkdown;
        }
        dirty.current = false;
        setMode("rich");
        requestAnimationFrame(() => { loaded.current = true; });
      }
    } finally {
      setSwitchingMode(false);
    }
  }, [editor, mode, onSave, rawMarkdown, switchingMode, toDisplayMarkdown, toRawMarkdown]);

  const handleRawChange = (markdown: string) => {
    dirty.current = true;
    setRawMarkdown(markdown);
    scheduleSave(markdown);
  };

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

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
            className="flex-1 text-3xl font-bold tracking-tight bg-transparent border-none outline-none placeholder:text-muted-foreground/30 text-foreground"
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

      {/* Footer: save status */}
      <div className="px-12 py-2.5 border-t border-border flex items-center gap-3 text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
        <span>
          {saveStatus === "saving" ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-muted-foreground border-t-transparent rounded-full animate-spin" />
              {t("doc.saving")}
            </span>
          ) : saveStatus === "saved" ? (
            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckIcon className="w-3 h-3" /> {t("doc.savedToDisk")}</span>
          ) : null}
        </span>
        <span className="ml-auto">{modifiedMs ? new Date(modifiedMs).toLocaleString() : ""}</span>
      </div>
    </div>
  );
}

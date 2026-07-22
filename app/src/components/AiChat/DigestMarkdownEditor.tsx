import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { Expand, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsDark } from "@/hooks/useIsDark";
import { useT } from "@/hooks/useT";
import { markdownToBlocks } from "@/lib/docFormat";
import { editorSchema } from "@/components/Documents/editorSchema";
import { liftMermaid, lowerMermaid } from "@/components/Documents/mermaidTransforms";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function DigestMarkdownEditor({ value, onChange }: Props) {
  const t = useT();
  const isDark = useIsDark();
  const editor = useCreateBlockNote({ schema: editorSchema });
  const [fullscreen, setFullscreen] = useState(false);
  const loaded = useRef(false);
  const lastEmitted = useRef("");
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loaded.current && value === lastEmitted.current) return;
    let cancelled = false;
    loaded.current = false;
    markdownToBlocks(value).then((blocks) => {
      if (cancelled) return;
      const lifted = liftMermaid(blocks);
      editor.replaceBlocks(editor.document, lifted.length ? lifted : [{ type: "paragraph" }]);
      lastEmitted.current = value;
      requestAnimationFrame(() => { loaded.current = true; });
    });
    return () => { cancelled = true; };
  }, [editor, value]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => () => { if (changeTimer.current) clearTimeout(changeTimer.current); }, []);

  const handleChange = useCallback(() => {
    if (!loaded.current) return;
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(async () => {
      const markdown = await editor.blocksToMarkdownLossy(lowerMermaid(editor.document) as any);
      lastEmitted.current = markdown;
      onChange(markdown);
    }, 250);
  }, [editor, onChange]);

  const workspace = <div role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen ? true : undefined} className={fullscreen ? "fixed inset-0 z-[300] flex flex-col bg-background shadow-2xl" : "overflow-hidden rounded-2xl border border-border/60 bg-background/50"}>
    <div className={`flex shrink-0 items-center justify-between border-b border-border/60 ${fullscreen ? "h-14 px-5" : "h-10 px-3"}`}>
      <div><span className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">{t("aichat.digestRichEditor")}</span>{fullscreen && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{t("aichat.digestEditorHint")}</p>}</div>
      <Button variant="ghost" onClick={() => setFullscreen((value) => !value)} title={fullscreen ? t("aichat.digestExitFullscreen") : t("aichat.digestFullscreen")} aria-label={fullscreen ? t("aichat.digestExitFullscreen") : t("aichat.digestFullscreen")} className="h-8 w-8 rounded-lg p-0">
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-3.5 w-3.5" />}
      </Button>
    </div>
    <div className={fullscreen ? "min-h-0 flex-1 overflow-y-auto px-[max(2rem,calc((100vw-900px)/2))] py-8" : "h-[420px] overflow-y-auto py-3"}>
      <BlockNoteView editor={editor} theme={isDark ? "dark" : "light"} onChange={handleChange} className="tanwords-editor" />
    </div>
  </div>;

  // The digest panel uses transforms for its slide-in animation, which makes
  // position:fixed descendants relative to the panel. Portal fullscreen mode
  // to body so it covers the entire application window instead.
  return fullscreen ? createPortal(workspace, document.body) : workspace;
}

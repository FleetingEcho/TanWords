import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useIsDark } from "@/hooks/useIsDark";
import { useT } from "@/hooks/useT";
import { markdownToBlocks, blocksToText } from "@/lib/docFormat";
import { CheckIcon } from "@heroicons/react/24/solid";

interface Props {
  /** Reload key — full reload of editor content happens when this changes (e.g. word switch). */
  wordId: number | null;
  /** Current source-of-truth plain text. Column stays plain text (see docFormat.ts);
   * this editor is a BlockNote shell over it, same look as Documents, formatting
   * (bold/lists/etc.) is flattened back to plain text on save. */
  text: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
}

/**
 * BlockNote-styled editor for word notes — reuses the same editor chrome as
 * the Documents feature (see DocEditor.tsx), but bound to a plain-text column
 * instead of BlockNote JSON: loads via markdownToBlocks, saves via
 * blocksToText (lossy round trip — rich formatting doesn't persist — by
 * design, so the `words.notes` column and VocabularyPage's inline editor stay
 * plain text).
 */
export function WordNotesEditor({ wordId, text, onChange, readOnly = false }: Props) {
  const isDark = useIsDark();
  const t = useT();
  const editor = useCreateBlockNote();
  const lastKnownText = useRef<string | null>(null);
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Full reload when switching words.
  useEffect(() => {
    loaded.current = false;
    lastKnownText.current = null;
    setStatus("idle");
    let cancelled = false;
    markdownToBlocks(text).then((blocks) => {
      if (cancelled) return;
      editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph", content: [] }]);
      lastKnownText.current = text;
      requestAnimationFrame(() => { loaded.current = true; });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordId]);

  // Pick up text saved from elsewhere (e.g. VocabularyPage's inline notes box)
  // without remounting — skip when it's just our own last save echoing back.
  useEffect(() => {
    if (!loaded.current || text === lastKnownText.current) return;
    let cancelled = false;
    markdownToBlocks(text).then((blocks) => {
      if (cancelled) return;
      editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph", content: [] }]);
      lastKnownText.current = text;
    });
    return () => { cancelled = true; };
  }, [text]);

  const handleChange = useCallback(() => {
    if (!loaded.current || readOnly) return;
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const newText = blocksToText(editor.document);
      lastKnownText.current = newText;
      onChange(newText);
      setStatus("saved");
    }, 600);
  }, [editor, onChange, readOnly]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-background">
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          theme={isDark ? "dark" : "light"}
          onChange={handleChange}
          className="tanwords-editor tanwords-editor-compact"
        />
      </div>
      {status !== "idle" && (
        <p className="text-[10px] text-muted-foreground mt-1.5 text-right shrink-0">
          {status === "saving" ? (
            t("chat.saving")
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><CheckIcon className="w-3 h-3" /> {t("doc.autoSaved")}</span>
          )}
        </p>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { toast } from "sonner";
import { BookmarkPlus, Check } from "lucide-react";
import { SparkIcon } from "@/components/ui/icons";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Markdown } from "./Markdown";
import { saveNoteAsDocument } from "./tools";

export interface NoteToolInput {
  title: string;
  content: string;
}

/** Tool calls whose input carries a note meant to render as a preview card
 *  rather than the generic collapsed ToolCallCard. */
export const NOTE_CARD_TOOL_NAMES = new Set(["summarize_conversation"]);

export function noteFromToolInput(input: Record<string, unknown>): NoteToolInput {
  return { title: String(input.title ?? ""), content: String(input.content ?? "") };
}

/** Renders a summarize_conversation tool call as a preview card — pure
 *  preview with an explicit save action. The AI can still save on its own via
 *  save_note_as_document; alreadySaved is set when that tool already ran. */
export function NoteCard({ note, alreadySaved = false }: { note: NoteToolInput; alreadySaved?: boolean }) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(alreadySaved);
  if (!note.title && !note.content) return null;

  const save = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      await saveNoteAsDocument(note.title, note.content);
      setSaved(true);
      toast.success(t("aichat.note.saved"));
    } catch (e) {
      toast.error(t("aichat.note.saveFailed", { error: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="my-1 w-full rounded-2xl border border-border overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        <SparkIcon className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold flex-1 truncate">{note.title}</span>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check className="w-3 h-3" />
            {t("aichat.note.saved")}
          </span>
        ) : (
          <Button
            variant="ghost"
            onClick={save}
            disabled={saving}
            className="h-7 gap-1 rounded-lg px-2 text-[11px] font-semibold text-primary hover:bg-primary/10"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            {saving ? t("aichat.note.saving") : t("aichat.note.saveToDocuments")}
          </Button>
        )}
      </div>
      <div className="px-4 py-3 max-h-80 overflow-y-auto text-sm leading-relaxed">
        <Markdown text={note.content} />
      </div>
    </div>
  );
}

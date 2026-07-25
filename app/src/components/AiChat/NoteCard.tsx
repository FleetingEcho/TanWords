import React from "react";
import { SparkIcon } from "@/components/ui/icons";
import { Markdown } from "./Markdown";

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
 *  preview, no save action here. Saving is a separate tool (save_note_as_document)
 *  the AI calls when the user says "save it", keeping the two steps distinct. */
export function NoteCard({ note }: { note: NoteToolInput }) {
  if (!note.title && !note.content) return null;

  return (
    <div className="my-1 w-full rounded-2xl border border-border overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        <SparkIcon className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold flex-1 truncate">{note.title}</span>
      </div>
      <div className="px-4 py-3 max-h-80 overflow-y-auto text-sm leading-relaxed">
        <Markdown text={note.content} />
      </div>
    </div>
  );
}

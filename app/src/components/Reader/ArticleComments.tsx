import React, { useState } from "react";
import { Bot, Trash2, User } from "lucide-react";
import { useT } from "@/hooks/useT";
import type { ReadingComment } from "@/hooks/useDB.reading";
import { Markdown } from "@/components/AiChat/Markdown";
import { Button } from "@/components/ui/button";

/**
 * Notes attached to an article — written here, or left by an agent through
 * MCP while you weren't looking.
 *
 * A note carrying `anchor_text` is about one sentence, and leads with that
 * sentence quoted, so the note reads as a margin annotation rather than a
 * loose remark. That quote is also what a later version needs to place these
 * beside the text itself.
 */
export function ArticleComments({
  comments,
  onAdd,
  onDelete,
}: {
  comments: ReadingComment[];
  onAdd: (body: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      await onAdd(body);
      setDraft("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {comments.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("library.commentsEmpty")}</p>
        )}
        {comments.map((comment) => (
          <div key={comment.id} className="group rounded-xl border border-border/60 bg-card/60 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {comment.author === "ai" ? <Bot className="h-3 w-3 text-primary" /> : <User className="h-3 w-3" />}
              <span className="font-semibold">{comment.author === "ai" ? "AI" : t("library.commentMine")}</span>
              <span className="tabular-nums">{comment.created_at.slice(0, 16)}</span>
              <Button
                variant="ghost"
                onClick={() => void onDelete(comment.id)}
                title={t("common.delete")}
                className="ml-auto h-5 w-5 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {comment.anchor_text && (
              <blockquote className="mb-1.5 border-l-2 border-primary/40 pl-2 text-[11px] italic leading-relaxed text-muted-foreground">
                {comment.anchor_text}
              </blockquote>
            )}
            <div className="text-xs leading-relaxed">
              <Markdown text={comment.body} />
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-border/60 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }}
          placeholder={t("library.commentPlaceholder")}
          rows={2}
          className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={() => void submit()} disabled={!draft.trim() || saving} className="h-7 rounded-lg px-3 text-xs font-semibold disabled:opacity-40">
            {t("library.commentAdd")}
          </Button>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { BookmarkPlus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { renderInline } from "./Markdown";
import { Button } from "@/components/ui/button";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useWordModalStore } from "@/store/wordModalStore";

function lookupWord(word: string) {
  useWordModalStore.getState().openWordModal(word);
}

/** One or more blockquote lines from a Speaking Coach answer. Each line gets
 *  TTS, word lookup, save-to-sentence-library, and a local discard action.
 *  Discard is deliberately non-persistent: the AI answer stays in the chat,
 *  and a discarded line simply stops being offered again in this render. */
export function SpeakingBlockquote({
  lines,
  source = "speaking",
  skeleton = "Speaking Coach",
}: {
  lines: string[];
  source?: string;
  skeleton?: string;
}) {
  const db = useDB();
  const t = useT();
  const [saved, setSaved] = useState<Set<number>>(() => new Set());
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState<number | null>(null);

  if (lines.length === 0) return null;

  const save = async (index: number) => {
    if (saving !== null) return;
    setSaving(index);
    const result = await db.saveSentencePattern(
      lines[index].trim(),
      "",
      skeleton,
      "",
      "",
      source,
    );
    setSaving(null);
    if (!result) return;
    setSaved((prev) => new Set(prev).add(index));
    toast.success(result.created ? t("aichat.speaking.toastSaved") : t("aichat.speaking.toastAlreadySaved"));
  };

  return (
    <div className="my-2 space-y-2 border-l-2 border-primary/40 pl-3">
      {lines.map((line, index) => {
        if (dismissed.has(index)) return null;
        const trimmed = line.trim();
        if (!trimmed) return null;
        const isSaved = saved.has(index);
        return (
          <div key={`${index}-${trimmed}`} className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1 text-sm font-semibold leading-relaxed">
              {renderInline(trimmed, `speaking-${index}`, lookupWord)}
            </div>
            <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center">
            </span>
            {isSaved ? (
              <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
              </span>
            ) : (
              <Button
                variant="ghost"
                onClick={() => void save(index)}
                disabled={saving === index}
                title={t("aichat.speaking.savePhrase")}
                className="mt-1 h-6 w-6 shrink-0 rounded-lg p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
              >
                {saving === index ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                ) : (
                  <BookmarkPlus className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => setDismissed((prev) => new Set(prev).add(index))}
              title={t("aichat.speaking.discardPhrase")}
              className="mt-1 h-6 w-6 shrink-0 rounded-lg p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** Stable renderer so MessageBubble's React.memo is not defeated by a new
 *  function identity on every AiChatPage render. */
export const renderSpeakingBlockquote = (lines: string[], key: string) => (
  <SpeakingBlockquote key={key} lines={lines} />
);

/** Same interactive quote treatment for the Reader's AI study notes. */
export const renderStudyBlockquote = (lines: string[], key: string) => (
  <SpeakingBlockquote key={key} lines={lines} source="reading" skeleton="Reading notes" />
);

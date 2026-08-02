import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { SparkIcon } from "@/components/ui/icons";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LevelBadge } from "@/components/shared/LevelBadge";

export interface ExtractedVocabItem {
  word: string;
  zh: string;
  word_type?: string;
  level?: string;
  context?: string;
}

/** Tool calls whose input carries a vocab item list meant to render as
 *  review cards rather than the generic collapsed ToolCallCard —
 *  extract_vocabulary (nothing saved yet) and add_words_to_vocab (already
 *  saved by executeTool; the card's own DB check below then shows them as
 *  "已加入" instead of offering an add button). */
export const VOCAB_CARD_TOOL_NAMES = new Set(["extract_vocabulary", "add_words_to_vocab"]);

/** extract_vocabulary keys its list "items"; add_words_to_vocab keys it "words". */
export function vocabItemsFromToolInput(input: Record<string, unknown>): ExtractedVocabItem[] {
  return ((input.items ?? input.words) as ExtractedVocabItem[] | undefined) ?? [];
}

type ItemStatus = "pending" | "added" | "known";

function LevelDot({ level }: { level?: string }) {
  return <LevelBadge level={level} />;
}

/** Renders the items array from an extract_vocabulary tool call as
 *  reviewable cards — each can be individually added or marked known,
 *  or the whole batch can be added in one click. */
export function VocabExtractionCard({ items }: { items: ExtractedVocabItem[] }) {
  const db = useDB();
  const t = useT();
  const [statuses, setStatuses] = useState<Record<number, ItemStatus>>({});
  const [addingAll, setAddingAll] = useState(false);
  // Multi-select is opt-out: every pending item starts selected, the user
  // unchecks what they don't want before hitting "Add selected".
  const [deselected, setDeselected] = useState<Record<number, boolean>>({});

  // Reopening a saved chat re-renders this card from the tool call's raw
  // input — it has no memory of what got added last time, so check the
  // vocabulary/known lists once on mount rather than always starting pending.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [words, known] = await Promise.all([db.getWords(), db.getKnownWords()]);
      if (cancelled) return;
      const savedSet = new Set(words.map((w) => w.word.toLowerCase()));
      const knownSet = new Set(known.map((w) => w.toLowerCase()));
      setStatuses((prev) => {
        const next = { ...prev };
        items.forEach((item, i) => {
          if (next[i]) return; // an action already taken this session wins
          const lower = item.word.toLowerCase();
          if (savedSet.has(lower)) next[i] = "added";
          else if (knownSet.has(lower)) next[i] = "known";
        });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) return null;

  const pendingIdx = items.map((_, i) => i).filter((i) => !statuses[i]);
  const selectedIdx = pendingIdx.filter((i) => !deselected[i]);
  const pendingCount = pendingIdx.length;
  const headerChecked: boolean | "indeterminate" =
    selectedIdx.length === 0 ? false : selectedIdx.length === pendingIdx.length ? true : "indeterminate";

  const toggleAll = () => {
    const selectAll = selectedIdx.length < pendingIdx.length;
    setDeselected((prev) => {
      const next = { ...prev };
      pendingIdx.forEach((i) => { next[i] = !selectAll; });
      return next;
    });
  };

  const addOne = async (i: number) => {
    const item = items[i];
    const result = await db.addWordsBatch([item], "chat");
    // added=0 AND skipped=0 means the write itself failed (addWordsBatch has
    // already shown the error toast) — keep the item pending, and don't claim
    // the word was a duplicate.
    if (result.added === 0 && result.skipped === 0) return;
    setStatuses((prev) => ({ ...prev, [i]: "added" }));
    if (result.added > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
    else toast.info(t("aichat.vocab.alreadyInVocab", { word: item.word }));
  };

  const markKnown = async (i: number) => {
    const item = items[i];
    await db.addKnownWords([item.word], "chat");
    setStatuses((prev) => ({ ...prev, [i]: "known" }));
  };

  const addSelected = async () => {
    const chosen = selectedIdx;
    if (chosen.length === 0 || addingAll) return;
    setAddingAll(true);
    const result = await db.addWordsBatch(chosen.map((i) => items[i]), "chat");
    if (result.added === 0 && result.skipped === 0) {
      // The write failed (error already toasted) — leave everything pending.
      setAddingAll(false);
      return;
    }
    const next: Record<number, ItemStatus> = { ...statuses };
    chosen.forEach((i) => { next[i] = "added"; });
    setStatuses(next);
    setAddingAll(false);
    if (result.added > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
    toast.success(
      t("aichat.vocab.toastAdded", { added: result.added }) +
        (result.skipped > 0 ? t("aichat.vocab.toastSkipped", { skipped: result.skipped }) : "")
    );
  };

  return (
    <div className="my-1 w-full rounded-2xl border border-border overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        <SparkIcon className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold flex-1">{t("aichat.vocab.extractedCount", { n: items.length })}</span>
        {pendingCount > 0 && (
          <>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
              <Checkbox checked={headerChecked} onCheckedChange={toggleAll} className="h-3.5 w-3.5" />
              {t("aichat.selectAll")}
            </label>
            <Button
              onClick={addSelected}
              disabled={addingAll || selectedIdx.length === 0}
              className="h-7 px-3 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {addingAll ? t("aichat.vocab.adding") : t("aichat.vocab.addSelected", { n: selectedIdx.length })}
            </Button>
          </>
        )}
      </div>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {items.map((item, i) => {
          const status = statuses[i] ?? "pending";
          return (
            <div key={i} className={`px-4 py-2.5 space-y-1 transition-opacity ${status !== "pending" ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-2">
                {status === "pending" && (
                  <Checkbox
                    checked={!deselected[i]}
                    onCheckedChange={(v) => setDeselected((prev) => ({ ...prev, [i]: v !== true }))}
                    className="h-3.5 w-3.5"
                  />
                )}
                <span className="text-sm font-semibold text-foreground">{item.word}</span>
                <LevelDot level={item.level} />
                <span className="text-xs text-muted-foreground truncate flex-1">{item.zh}</span>
              </div>
              {item.context && (
                <p className="text-[11px] text-muted-foreground/70 italic leading-relaxed line-clamp-2">
                  “{item.context}”
                </p>
              )}
              <div className="flex items-center gap-2 pt-0.5">
                {status === "pending" ? (
                  <>
                    <Button variant="link" onClick={() => addOne(i)} className="h-auto p-0 text-[11px] font-semibold text-primary hover:underline">
                      {t("aichat.vocab.addOne")}
                    </Button>
                    <Button variant="link" onClick={() => markKnown(i)} className="h-auto p-0 text-[11px] text-muted-foreground hover:text-foreground">
                      {t("aichat.vocab.markKnown")}
                    </Button>
                  </>
                ) : status === "added" ? (
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> {t("aichat.vocab.statusAdded")}</span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{t("aichat.vocab.statusKnown")}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

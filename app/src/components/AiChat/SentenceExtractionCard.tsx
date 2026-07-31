import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { SparkIcon } from "@/components/ui/icons";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export interface GeneratedSentenceItem {
  sentence: string;
  zh: string;
  level?: string;
  skeleton?: string;
  note?: string;
}

/** Tool calls whose input carries a sentence list meant to render as review
 *  cards rather than the generic collapsed ToolCallCard — generate_sentences
 *  (sentences the model wrote) and extract_patterns (sentences quoted verbatim
 *  from a text the user shared); same item shape, different header wording. */
export const SENTENCE_CARD_TOOL_NAMES = new Set(["generate_sentences", "extract_patterns"]);

export function sentenceItemsFromToolInput(input: Record<string, unknown>): GeneratedSentenceItem[] {
  return (input.items as GeneratedSentenceItem[] | undefined) ?? [];
}

/** Renders the items array from a generate_sentences tool call as reviewable
 *  cards — each can be individually added to the sentence library, or the
 *  whole batch at once. Mirrors VocabExtractionCard's shape and behavior. */
export function SentenceExtractionCard({ items, variant = "generated" }: { items: GeneratedSentenceItem[]; variant?: "generated" | "extracted" }) {
  const db = useDB();
  const t = useT();
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const [addingAll, setAddingAll] = useState(false);
  // Multi-select is opt-out: every pending item starts selected, the user
  // unchecks what they don't want before hitting "Add selected".
  const [deselected, setDeselected] = useState<Record<number, boolean>>({});

  // Reopening a saved chat re-renders this card from the tool call's raw
  // input — check the sentence library once on mount rather than always
  // starting every item as pending.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const patterns = await db.listPatterns();
      if (cancelled) return;
      const savedSet = new Set(patterns.flatMap((p) => p.examples.map((e) => e.sentence)));
      setAdded((prev) => {
        const next = { ...prev };
        items.forEach((item, i) => {
          if (savedSet.has(item.sentence)) next[i] = true;
        });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) return null;

  const pendingIdx = items.map((_, i) => i).filter((i) => !added[i]);
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
    const saved = await db.saveSentencePattern(item.sentence, item.zh, item.skeleton ?? "", item.note ?? "", item.level ?? "", "chat");
    if (saved) {
      setAdded((prev) => ({ ...prev, [i]: true }));
      if (saved.created) toast.success(t("aichat.sentence.toastAddedOne"));
      else toast.info(t("aichat.sentence.alreadySaved"));
    }
  };

  const addSelected = async () => {
    const chosen = selectedIdx.map((i) => ({ item: items[i], i }));
    if (chosen.length === 0 || addingAll) return;
    setAddingAll(true);
    let count = 0;
    const next = { ...added };
    for (const { item, i } of chosen) {
      const saved = await db.saveSentencePattern(item.sentence, item.zh, item.skeleton ?? "", item.note ?? "", item.level ?? "", "chat");
      if (saved) { next[i] = true; if (saved.created) count += 1; }
    }
    setAdded(next);
    setAddingAll(false);
    toast.success(t("aichat.sentence.toastAdded", { added: count }));
  };

  return (
    <div className="my-1 w-full rounded-2xl border border-border overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        <SparkIcon className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold flex-1">{t(variant === "extracted" ? "aichat.sentence.extractedCount" : "aichat.sentence.generatedCount", { n: items.length })}</span>
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
              {addingAll ? t("aichat.sentence.adding") : t("aichat.sentence.addSelected", { n: selectedIdx.length })}
            </Button>
          </>
        )}
      </div>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {items.map((item, i) => {
          const isAdded = !!added[i];
          return (
            <div key={i} className={`px-4 py-2.5 space-y-1 transition-opacity ${isAdded ? "opacity-50" : ""}`}>
              <div className="flex items-start gap-2">
                {!isAdded && (
                  <Checkbox
                    checked={!deselected[i]}
                    onCheckedChange={(v) => setDeselected((prev) => ({ ...prev, [i]: v !== true }))}
                    className="h-3.5 w-3.5 mt-0.5 shrink-0"
                  />
                )}
                <span className="text-sm font-semibold text-foreground min-w-0 flex-1 wrap-break-word">{item.sentence}</span>
                <SpeakButton text={item.sentence} className="w-3 h-3 mt-0.5 shrink-0" />
                <LevelBadge level={item.level} />
              </div>
              {item.zh && <p className="text-xs text-muted-foreground">{item.zh}</p>}
              {(item.skeleton || item.note) && (
                <p className="text-[11px] text-muted-foreground/70 italic leading-relaxed">
                  {[item.skeleton, item.note].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="flex items-center gap-2 pt-0.5">
                {isAdded ? (
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5">
                    <Check className="w-3 h-3" /> {t("aichat.sentence.statusAdded")}
                  </span>
                ) : (
                  <Button variant="link" onClick={() => addOne(i)} className="h-auto p-0 text-[11px] font-semibold text-primary hover:underline">
                    {t("aichat.sentence.addOne")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { SparkIcon } from "@/components/ui/icons";
import { CheckIcon } from "@heroicons/react/24/solid";

export interface ExtractedVocabItem {
  word: string;
  zh: string;
  word_type?: string;
  level?: string;
  context?: string;
}

const LEVEL_COLORS: Record<string, string> = {
  C2: "#a855f7", C1: "#3b82f6", B2: "#14b8a6",
};

type ItemStatus = "pending" | "added" | "known";

function LevelDot({ level }: { level?: string }) {
  if (!level) return null;
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{ color: LEVEL_COLORS[level] ?? "#64748b", backgroundColor: `${LEVEL_COLORS[level] ?? "#64748b"}18` }}
    >
      {level}
    </span>
  );
}

/** Renders the items array from an extract_vocabulary tool call as
 *  reviewable cards — each can be individually added or marked known,
 *  or the whole batch can be added in one click. */
export function VocabExtractionCard({ items }: { items: ExtractedVocabItem[] }) {
  const db = useDB();
  const [statuses, setStatuses] = useState<Record<number, ItemStatus>>({});
  const [addingAll, setAddingAll] = useState(false);

  const pendingCount = items.filter((_, i) => !statuses[i]).length;

  const addOne = async (i: number) => {
    const item = items[i];
    const result = await db.addWordsBatch([item], "chat");
    setStatuses((prev) => ({ ...prev, [i]: "added" }));
    if (result.added > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
    else toast.info(`"${item.word}" 已在词库中`);
  };

  const markKnown = async (i: number) => {
    const item = items[i];
    await db.addKnownWords([item.word], "chat");
    setStatuses((prev) => ({ ...prev, [i]: "known" }));
  };

  const addAll = async () => {
    const pending = items.filter((_, i) => !statuses[i]);
    if (pending.length === 0 || addingAll) return;
    setAddingAll(true);
    const result = await db.addWordsBatch(pending, "chat");
    const next: Record<number, ItemStatus> = { ...statuses };
    items.forEach((_, i) => { if (!next[i]) next[i] = "added"; });
    setStatuses(next);
    setAddingAll(false);
    if (result.added > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
    toast.success(`已加入 ${result.added} 个词${result.skipped > 0 ? `，跳过 ${result.skipped} 个已存在` : ""}`);
  };

  return (
    <div className="my-1 rounded-2xl border border-border overflow-hidden bg-card max-w-lg">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        <SparkIcon className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold flex-1">提取到 {items.length} 个词条</span>
        {pendingCount > 0 && (
          <button
            onClick={addAll}
            disabled={addingAll}
            className="h-7 px-3 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {addingAll ? "添加中…" : `全部加入 (${pendingCount})`}
          </button>
        )}
      </div>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {items.map((item, i) => {
          const status = statuses[i] ?? "pending";
          return (
            <div key={i} className={`px-4 py-2.5 space-y-1 transition-opacity ${status !== "pending" ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{item.word}</span>
                <SpeakButton text={item.word} className="w-3 h-3" />
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
                    <button onClick={() => addOne(i)} className="text-[11px] font-semibold text-primary hover:underline">
                      加入词库
                    </button>
                    <button onClick={() => markKnown(i)} className="text-[11px] text-muted-foreground hover:text-foreground">
                      已认识
                    </button>
                  </>
                ) : status === "added" ? (
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5"><CheckIcon className="w-3 h-3" /> 已加入</span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">已认识</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

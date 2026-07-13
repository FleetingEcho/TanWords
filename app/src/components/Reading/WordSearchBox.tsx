import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB, WordListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useWordModalStore } from "@/store/wordModalStore";
import { SearchIcon } from "@/components/ui/icons";

/** Vocabulary lookup box for the lesson panel: type any word from the article
 * (not just the AI's picks) to see whether it's already collected — click
 * through to its detail — or add it on the spot. */
export function WordSearchBox() {
  const db = useDB();
  const t = useT();
  const openWordModal = useWordModalStore((s) => s.openWordModal);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<WordListItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setMatches([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const rows = await db.getWords({ search: q });
      setMatches(rows.slice(0, 4));
      setSearched(true);
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, db]);

  const q = query.trim();
  const exactMatch = matches.find((w) => w.word.toLowerCase() === q.toLowerCase());

  const handleAdd = async () => {
    if (!q || adding) return;
    setAdding(true);
    try {
      const { id } = await db.addWord(q, "");
      if (id > 0) {
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(t("reading.search.added", { word: q }));
        setQuery("");
        openWordModal(q);
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-3 space-y-2">
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q && searched && !exactMatch) handleAdd();
          }}
          placeholder={t("reading.search.placeholder")}
          className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
        />
      </div>

      {q && searched && (
        <div className="space-y-1">
          {matches.map((w) => (
            <button
              key={w.id}
              onClick={() => openWordModal(w.word)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors text-left"
            >
              <span className="text-xs font-semibold text-foreground">{w.word}</span>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 ml-auto shrink-0">
                {t("reading.search.inVocab")}
              </span>
            </button>
          ))}
          {!exactMatch && (
            <button
              onClick={handleAdd}
              disabled={adding}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors text-left"
            >
              + {adding ? t("reading.search.adding") : t("reading.search.add", { word: q })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

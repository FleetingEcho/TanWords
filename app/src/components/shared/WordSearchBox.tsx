import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB, WordListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useWordModalStore } from "@/store/wordModalStore";
import { SearchIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

/** Global vocabulary lookup box: type any word to see whether it's already
 * collected — click through to its detail — or add it on the spot.
 * `variant="inline"` renders the results as a floating dropdown so it can sit
 * directly in a fixed-height bar (the top CommandBar) without growing it;
 * the default `"popover"` stacks results in normal flow for use inside a
 * Popover (see the Reading lesson panel). */
export function WordSearchBox({ variant = "popover" }: { variant?: "popover" | "inline" }) {
  const inline = variant === "inline";
  const db = useDB();
  const t = useT();
  const openWordModal = useWordModalStore((s) => s.openWordModal);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<WordListItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [markingKnown, setMarkingKnown] = useState(false);
  const [markedKnown, setMarkedKnown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    setMarkedKnown(false);
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

  const handleMarkKnown = async () => {
    if (!q || markingKnown) return;
    setMarkingKnown(true);
    try {
      await db.addKnownWords([q], "marked");
      setMarkedKnown(true);
      toast.success(t("reading.search.markedKnown", { word: q }));
    } finally {
      setMarkingKnown(false);
    }
  };

  return (
    <div className={inline ? "relative" : "space-y-2"}>
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          autoFocus={!inline}
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
        <div className={inline ? "absolute left-0 right-0 top-full z-50 mt-2 space-y-1 rounded-xl border border-border bg-popover p-2 shadow-2xl" : "space-y-1"}>
          {matches.map((w) => (
            <Button
              key={w.id}
              variant="ghost"
              onClick={() => openWordModal(w.word)}
              className="h-auto w-full flex items-center justify-start gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors text-left"
            >
              <span className="text-xs font-semibold text-foreground">{w.word}</span>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 ml-auto shrink-0">
                {t("reading.search.inVocab")}
              </span>
            </Button>
          ))}
          {!exactMatch && (
            <Button
              variant="ghost"
              onClick={handleAdd}
              disabled={adding}
              className="h-auto w-full flex items-center justify-start gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors text-left"
            >
              + {adding ? t("reading.search.adding") : t("reading.search.add", { word: q })}
            </Button>
          )}
          {!exactMatch && (
            <Button
              variant="ghost"
              onClick={handleMarkKnown}
              disabled={markingKnown || markedKnown}
              className="h-auto w-full flex items-center justify-start gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors text-left"
            >
              {markedKnown
                ? t("reading.search.markedKnown", { word: q })
                : markingKnown
                ? t("reading.search.marking")
                : t("reading.search.markKnown", { word: q })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

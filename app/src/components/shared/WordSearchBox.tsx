import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookPlus, Sparkles } from "lucide-react";
import { useDB, WordListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useWordModalStore } from "@/store/wordModalStore";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { QUICK_LOOKUP_SYSTEM_PROMPT, buildQuickLookupUserPrompt } from "@/providers/base";
import { parseEnrichmentStream, ParsedEnrichment } from "@/lib/enrichMeta";
import { EnrichmentText } from "@/components/EnrichmentText";
import { SearchIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

/** Global vocabulary lookup box: type any word to see whether it's already
 * collected — click through to its full detail — or, for a word that isn't
 * collected yet, get a fast AI gloss (one-line meaning + 2 examples) right
 * inline, then either add it on the spot or open the full deep-analysis
 * modal. One box covers search, quick lookup, add, and deep-analyze so
 * there's a single place to do all of it instead of scattering "add a word"
 * across several toolbar controls.
 * `variant="inline"` renders the results as a floating dropdown so it can sit
 * directly in a fixed-height bar (the top CommandBar) without growing it;
 * the default `"popover"` stacks results in normal flow for use inside a
 * Popover. */
export function WordSearchBox({ variant = "popover" }: { variant?: "popover" | "inline" }) {
  const inline = variant === "inline";
  const db = useDB();
  const t = useT();
  const openWordModal = useWordModalStore((s) => s.openWordModal);
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<WordListItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [quick, setQuick] = useState<ParsedEnrichment | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [noProvider, setNoProvider] = useState(false);
  const [adding, setAdding] = useState(false);
  const [markingKnown, setMarkingKnown] = useState(false);
  const [markedKnown, setMarkedKnown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const quickAbortRef = useRef<AbortController>();

  const q = query.trim();
  const exactMatch = matches.find((w) => w.word.toLowerCase() === q.toLowerCase());

  useEffect(() => {
    clearTimeout(debounceRef.current);
    quickAbortRef.current?.abort();
    setMarkedKnown(false);
    setQuick(null);
    setQuickError(null);
    setQuickLoading(false);
    setNoProvider(false);
    if (!q) {
      setMatches([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const rows = await db.getWords({ search: q });
      setMatches(rows.slice(0, 4));
      setSearched(true);
      if (rows.some((w) => w.word.toLowerCase() === q.toLowerCase())) return;
      if (q.length < 2) return;

      const provider = findBestProvider();
      if (!provider) {
        setNoProvider(true);
        return;
      }
      const controller = new AbortController();
      quickAbortRef.current = controller;
      setQuickLoading(true);
      let raw = "";
      try {
        for await (const chunk of provider.generate(QUICK_LOOKUP_SYSTEM_PROMPT, buildQuickLookupUserPrompt(q, targetLevel), controller.signal)) {
          if (controller.signal.aborted) return;
          raw += chunk;
          setQuick(parseEnrichmentStream(raw));
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") setQuickError(t("reading.search.quickFailed"));
      } finally {
        if (!controller.signal.aborted) setQuickLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(debounceRef.current);
      quickAbortRef.current?.abort();
    };
  }, [query, db, targetLevel]);

  const handleAdd = async () => {
    if (!q || adding) return;
    setAdding(true);
    try {
      const result = quick?.text
        ? await db.addWordEnriched(q, quick.zhShort || q, null, { text: quick.text, zhShort: quick.zhShort, level: quick.level })
        : await db.addWord(q, quick?.zhShort || "");
      if (result.id > 0) {
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(t("reading.search.added", { word: q }));
        setQuery("");
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
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2">
              {quickLoading && !quick && <p className="px-1 text-xs text-muted-foreground animate-pulse">{t("reading.search.quickFetching")}</p>}
              {quickError && <p className="px-1 text-xs text-destructive">{quickError}</p>}
              {noProvider && <p className="px-1 text-xs text-muted-foreground">{t("modal.noProvider")}</p>}

              {quick?.text && (
                <div className="space-y-1 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{q}</span>
                    {quick.zhShort && <span className="text-xs text-muted-foreground">{quick.zhShort}</span>}
                    {quick.level && <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{quick.level}</span>}
                  </div>
                  <div className="text-xs leading-relaxed [&_blockquote]:my-1 [&_blockquote]:text-[11px]">
                    <EnrichmentText text={quick.text} />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  onClick={handleAdd}
                  disabled={adding}
                  className="h-auto flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                >
                  <BookPlus className="h-3.5 w-3.5" />
                  {adding ? t("reading.search.adding") : t("reading.search.add", { word: q })}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => openWordModal(q)}
                  className="h-auto flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("reading.search.deepAnalyze")}
                </Button>
              </div>

              <button
                onClick={handleMarkKnown}
                disabled={markingKnown || markedKnown}
                className="w-full px-1 text-left text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                {markedKnown
                  ? t("reading.search.markedKnown", { word: q })
                  : markingKnown
                  ? t("reading.search.marking")
                  : t("reading.search.markKnown", { word: q })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

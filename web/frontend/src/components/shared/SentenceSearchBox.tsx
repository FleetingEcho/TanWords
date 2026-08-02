import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { BookPlus } from "lucide-react";
import { useDB } from "@/hooks/useDB";
import type { PatternItem } from "@/hooks/useDB.patterns";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { analyzeSentence, type GeneratedSentence } from "@/features/patterns/generate";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SearchIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { useNavStore } from "@/store/navStore";
import { filterSentencePatterns } from "./sentenceSearch";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
/** Global sentence-library box, the Sentences-mode sibling of WordSearchBox:
 *  fuzzy-search the saved sentence library (pattern, translation, note, or
 *  any example sentence) and, if nothing matches, save the typed sentence
 *  on the spot — AI fills in the translation/level/pattern the same way the
 *  Sentences tab's quick-add does.
 *  `variant="inline"` renders results as a floating dropdown so it can sit
 *  in the fixed-height top CommandBar without growing it. */
export function SentenceSearchBox({ variant = "popover" }: { variant?: "popover" | "inline" }) {
  const inline = variant === "inline";
  const db = useDB();
  const t = useT();
  const levels = useSettingsStore((s) => s.targetLevels.join("/"));
  const openVocabularySentence = useNavStore((s) => s.openVocabularySentence);

  const [allPatterns, setAllPatterns] = useState<PatternItem[]>([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PatternItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState(false);
  /** The AI reading of the typed sentence, shown before it is saved. */
  const [analysis, setAnalysis] = useState<GeneratedSentence | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeFailed, setAnalyzeFailed] = useState(false);
  const [noProvider, setNoProvider] = useState(false);
  /** Whether the results dropdown is showing. Separate from `searched` so
   *  dismissing it only hides the panel — the analysis behind it survives,
   *  and re-opening costs nothing. */
  const [open, setOpen] = useState(false);
  const analyzeAbortRef = useRef<AbortController | undefined>(undefined);
  const anchorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const loadPatterns = () => db.listPatterns().then(setAllPatterns);
  useEffect(() => { loadPatterns(); }, []);
  useEffect(() => {
    window.addEventListener("patterns-updated", loadPatterns);
    return () => window.removeEventListener("patterns-updated", loadPatterns);
  }, []);

  const q = query.trim();
  const canAddSentence = q.split(/\s+/).filter(Boolean).length >= 3;
  const exactMatch = matches.some((p) =>
    p.examples.some((e) => e.sentence.trim().toLowerCase() === q.toLowerCase()));

  // Editing the query invalidates whatever was last searched — reset instead of
  // re-searching automatically. This box used to search on every keystroke,
  // which popped the dropdown open over a half-typed sentence; a sentence is
  // only meaningful once it is finished, so nothing happens until Enter. Same
  // contract as WordSearchBox.
  useEffect(() => {
    analyzeAbortRef.current?.abort();
    setSearched(false);
    setMatches([]);
    setAnalysis(null);
    setAnalyzing(false);
    setAnalyzeFailed(false);
    setNoProvider(false);
  }, [query]);

  useEffect(() => () => analyzeAbortRef.current?.abort(), []);

  useDismissOnOutside(inline && open, () => setOpen(false), [containerRef, panelRef]);

  // Pressing Enter before `listPatterns()` resolves would otherwise search an
  // empty snapshot and never retry; recompute if the library lands afterwards.
  useEffect(() => {
    if (!searched || !q) return;
    setMatches(filterSentencePatterns(allPatterns, q).slice(0, 8));
  }, [allPatterns]);

  const runSearch = async () => {
    if (!q) return;
    setOpen(true);
    analyzeAbortRef.current?.abort();
    const found = filterSentencePatterns(allPatterns, q).slice(0, 8);
    setMatches(found);
    setSearched(true);

    // Only worth an AI call for something sentence-shaped, and not for a
    // sentence the library already holds verbatim — that one has a stored
    // analysis already, reachable by clicking the match.
    const alreadySaved = found.some((p) =>
      p.examples.some((e) => e.sentence.trim().toLowerCase() === q.toLowerCase()));
    if (alreadySaved || q.split(/\s+/).filter(Boolean).length < 3) return;

    const provider = findBestProvider();
    if (!provider) {
      setNoProvider(true);
      return;
    }
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    setAnalyzing(true);
    setAnalyzeFailed(false);
    try {
      const result = await analyzeSentence(provider, q, levels, controller.signal);
      if (!controller.signal.aborted) setAnalysis(result);
    } catch {
      if (!controller.signal.aborted) setAnalyzeFailed(true);
    } finally {
      if (!controller.signal.aborted) setAnalyzing(false);
    }
  };

  const handleAdd = async () => {
    if (!q || adding || exactMatch) return;
    setAdding(true);
    try {
      // Whatever runSearch already analyzed and put on screen — saving is now
      // just committing what was shown, rather than a second (and possibly
      // differently-worded) AI call behind the user's back.
      let result: GeneratedSentence = analysis ?? { sentence: q, zh: "", level: "", skeleton: "", note: "" };
      if (!analysis) {
        const provider = findBestProvider();
        if (provider) {
          try { result = await analyzeSentence(provider, q, levels); }
          catch { toast.error(t("vocab.patterns.analyzeFailed")); }
        } else {
          toast.info(t("vocab.noApiKey"));
        }
      }
      const saved = await db.saveSentencePattern(result.sentence, result.zh, result.skeleton, result.note, result.level, "manual");
      if (saved) {
        toast.success(t("vocab.patterns.savedOne"));
        setQuery("");
        loadPatterns();
        window.dispatchEvent(new CustomEvent("patterns-updated"));
      }
    } finally {
      setAdding(false);
    }
  };

  const resultsPanel = (
    <div className="space-y-1">
      {matches.map((p) => {
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        const sentence = p.examples.find((e) =>
          tokens.every((token) => e.sentence.toLowerCase().includes(token))
        )?.sentence ?? p.examples[0]?.sentence ?? p.pattern;
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setQuery("");
              openVocabularySentence(p.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setQuery("");
                openVocabularySentence(p.id);
              }
            }}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
          >
            <span className="min-w-0 flex-1 whitespace-normal text-xs font-medium leading-relaxed text-foreground">{sentence}</span>
            <LevelBadge level={p.level} />
            <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              {t("vocab.patterns.inLibrary")}
            </span>
          </div>
        );
      })}

      {!matches.length && (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("vocab.patterns.noMatch")}</p>
      )}

      {/* The typed sentence, read by the AI. Words have shown this since the
        * beginning (WordSearchBox's quick lookup); sentences were analyzed too,
        * but only ever inside `handleAdd` — so the reading existed and was
        * saved without the learner being shown it once. */}
      {canAddSentence && !exactMatch && (
        <div className="mt-1 rounded-lg border border-border bg-muted/30 p-2.5">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-foreground">{q}</p>
            {analysis?.level && <LevelBadge level={analysis.level} />}
          </div>

          {analyzing && (
            <div className="mt-2 space-y-1.5 animate-pulse" aria-hidden>
              <div className="h-2.5 w-3/4 rounded-full bg-muted" />
              <div className="h-2.5 w-1/2 rounded-full bg-muted" />
            </div>
          )}

          {analysis && !analyzing && (
            <div className="mt-2 space-y-1.5">
              {analysis.zh && <p className="text-xs leading-relaxed text-muted-foreground">{analysis.zh}</p>}
              {analysis.skeleton && (
                <p className="font-mono text-[11px] leading-relaxed text-primary">{analysis.skeleton}</p>
              )}
              {analysis.note && (
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">{analysis.note}</p>
              )}
            </div>
          )}

          {analyzeFailed && !analyzing && (
            <p className="mt-2 text-[11px] text-muted-foreground">{t("vocab.patterns.analyzeFailed")}</p>
          )}
          {noProvider && <p className="mt-2 text-[11px] text-muted-foreground">{t("vocab.noApiKey")}</p>}

          <Button
            variant="ghost"
            onClick={handleAdd}
            disabled={adding || analyzing}
            className="mt-2 h-auto w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
          >
            <BookPlus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{adding ? t("vocab.patterns.adding") : t("vocab.patterns.add")}</span>
          </Button>
        </div>
      )}
    </div>
  );

  const anchorRect = inline ? anchorRef.current?.getBoundingClientRect() : undefined;

  return (
    <div ref={containerRef} className={inline ? "relative" : "space-y-2"}>
      <div ref={anchorRef} className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          autoFocus={!inline}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (searched) setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            // Editing the query resets `searched`, so reaching here with it
            // still set means the text is unchanged and the analysis on file
            // is the answer to it — re-open rather than ask the model again.
            // A run that failed left nothing to re-open, so that one retries.
            if (searched && !analyzeFailed && !noProvider) { setOpen(true); return; }
            runSearch();
          }}
          placeholder={t("vocab.patterns.quickSearchPlaceholder")}
          className="w-full h-10 lg:h-8 pl-8 pr-7 rounded-lg border border-input bg-background text-[16px] lg:text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
        />
        {q && (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground pointer-events-none">
            ↵
          </kbd>
        )}
      </div>

      {q && searched && open && (
        inline && anchorRect
          ? createPortal(
              <div
                ref={panelRef}
                className="fixed z-100 max-h-[min(28rem,calc(100vh-5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-2xl"
                style={{
                  left: anchorRect.left,
                  top: anchorRect.bottom + 8,
                  width: Math.min(720, window.innerWidth - anchorRect.left - 16),
                }}
              >
                {/* Only in the floating variant: the inline one renders in
                  * normal flow and is not an overlay. On the Browser page the
                  * native panel is composited above this document, so `z-100`
                  * loses to it — the panel has to step aside instead. */}
                {resultsPanel}
              </div>,
              document.body
            )
          : <div>{resultsPanel}</div>
      )}
    </div>
  );
}

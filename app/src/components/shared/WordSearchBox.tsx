import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookPlus, Check, Sparkles } from "lucide-react";
import { useDB, WordListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useWordModalStore } from "@/store/wordModalStore";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { QUICK_LOOKUP_SYSTEM_PROMPT, buildQuickLookupUserPrompt } from "@/providers/base";
import { parseEnrichmentStream, ParsedEnrichment } from "@/lib/enrichMeta";
import { fetchBasicInfo, BasicInfo } from "@/lib/basicInfo";
import { fetchReverseLookup, ReverseCandidate } from "@/lib/reverseLookup";
import { EnrichmentText } from "@/components/EnrichmentText";
import { SearchIcon } from "@/components/ui/icons";
import { BrowserPanelBlocker } from "@/store/browserPanelStore";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/Skeleton";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { useNavStore } from "@/store/navStore";
import { LevelBadge } from "@/components/shared/LevelBadge";

/** Placeholder shaped like a real candidate card (title row, usage note,
 * example, action row) so the dropdown doesn't jump when results land. */
function CandidateSkeleton() {
  return (
    <div className="space-y-1.5 rounded-lg border border-border/50 bg-background/60 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3 w-10 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-2.5 w-3/5" />
      <Skeleton className="h-6 w-full" />
    </div>
  );
}

/** Global vocabulary lookup box: type any word to see whether it's already
 * collected — click through to its full detail — or, for a word that isn't
 * collected yet, get a fast AI gloss (one-line meaning + 2 examples) right
 * inline, then either add it on the spot or open the full deep-analysis
 * modal. One box covers search, quick lookup, add, and deep-analyze so
 * there's a single place to do all of it instead of scattering "add a word"
 * across several toolbar controls.
 * Typing Chinese flips it into reverse lookup: up to 4 English candidates,
 * each with its own gloss, usage note, example and add/deep-analyze actions,
 * so "什么词表示…" is answered in the same box (see lib/reverseLookup.ts).
 * `variant="inline"` renders the results as a floating dropdown so it can sit
 * directly in a fixed-height bar (the top CommandBar) without growing it;
 * the default `"popover"` stacks results in normal flow for use inside a
 * Popover. */
export function WordSearchBox({ variant = "popover" }: { variant?: "popover" | "inline" }) {
  const inline = variant === "inline";
  const db = useDB();
  const t = useT();
  const openWordModal = useWordModalStore((s) => s.openWordModal);
  const navigate = useNavStore((s) => s.navigate);
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  const showLevelBadges = useSettingsStore((s) => s.showLevelBadges);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<WordListItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [quick, setQuick] = useState<ParsedEnrichment | null>(null);
  const [quickBasicInfo, setQuickBasicInfo] = useState<BasicInfo>({});
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [noProvider, setNoProvider] = useState(false);
  const [adding, setAdding] = useState(false);
  const [markingKnown, setMarkingKnown] = useState(false);
  const [markedKnown, setMarkedKnown] = useState(false);
  const [candidates, setCandidates] = useState<ReverseCandidate[]>([]);
  const [expanded, setExpanded] = useState(0);
  const [addedEn, setAddedEn] = useState<string[]>([]);
  const [collectedEn, setCollectedEn] = useState<string[]>([]);
  const quickAbortRef = useRef<AbortController>();

  const q = query.trim();
  const exactMatch = matches.find((w) => w.word.toLowerCase() === q.toLowerCase());
  /** A Chinese query means "find me the English for this" (reverse lookup),
   * not "explain this word" — the two modes share the box but nothing else. */
  const isZh = /[\u4e00-\u9fff]/.test(q);

  // Editing the query invalidates whatever was last searched — reset instead
  // of re-searching automatically, so the AI quick-lookup only ever fires on
  // an explicit Enter (see runSearch) instead of once per keystroke pause.
  useEffect(() => {
    quickAbortRef.current?.abort();
    setSearched(false);
    setMatches([]);
    setMarkedKnown(false);
    setQuick(null);
    setQuickBasicInfo({});
    setQuickError(null);
    setQuickLoading(false);
    setNoProvider(false);
    setCandidates([]);
    setExpanded(0);
    setAddedEn([]);
    setCollectedEn([]);
  }, [query]);

  useEffect(() => () => quickAbortRef.current?.abort(), []);

  // A candidate can already be in the vocabulary under a gloss unrelated to
  // the Chinese query (so `matches` wouldn't show it) — check each one by
  // its own English spelling before offering to add it again.
  const candidateWords = candidates.map((c) => c.en).join("|");
  useEffect(() => {
    if (!candidateWords) return;
    let cancelled = false;
    void (async () => {
      const words = candidateWords.split("|");
      const found = await Promise.all(
        words.map(async (en) => {
          const rows = await db.getWords({ search: en });
          return rows.some((w) => w.word.toLowerCase() === en.toLowerCase()) ? en.toLowerCase() : null;
        })
      );
      if (!cancelled) setCollectedEn(found.filter((w): w is string => w !== null));
    })();
    return () => { cancelled = true; };
  }, [candidateWords]);

  const runSearch = async () => {
    if (!q) return;
    quickAbortRef.current?.abort();
    const rows = await db.getWords({ search: q });
    setMatches(rows.slice(0, 4));
    setSearched(true);
    // A single Chinese character is already a searchable word; a single
    // Latin letter isn't worth an AI call.
    if (!isZh && q.length < 2) return;

    const provider = findBestProvider();
    if (!provider) {
      setNoProvider(true);
      return;
    }
    const controller = new AbortController();
    quickAbortRef.current = controller;
    setQuickLoading(true);
    setQuickError(null);
    if (isZh) {
      try {
        await fetchReverseLookup(provider, q, targetLevel, setCandidates, controller.signal);
      } catch (e: any) {
        if (e?.name !== "AbortError") setQuickError(t("reading.search.reverse.failed"));
      } finally {
        if (!controller.signal.aborted) setQuickLoading(false);
      }
      return;
    }

    let raw = "";
    try {
      fetchBasicInfo(provider, q, targetLevel, controller.signal).then((info) => {
        if (!controller.signal.aborted) setQuickBasicInfo(info);
      });
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
  };

  const handleAdd = async () => {
    if (!q || adding) return;
    setAdding(true);
    try {
      const zhShort = quickBasicInfo.zh || quick?.zhShort;
      const result = quick?.text
        ? await db.addWordEnriched(q, zhShort || q, quickBasicInfo.wordType || null, { text: quick.text, zhShort, level: quickBasicInfo.level || quick.level })
        : await db.addWord(q, zhShort || "");
      if (result.id > 0) {
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(t("reading.search.added", { word: q }));
        setQuery("");
      }
    } finally {
      setAdding(false);
    }
  };

  /** Adds one reverse-lookup candidate. The gloss/type/level already came
   * back with the candidate, so this needs no further AI call — the box
   * stays open so the learner can pick more than one. */
  const handleAddCandidate = async (c: ReverseCandidate) => {
    if (addedEn.includes(c.en)) return;
    setAddedEn((prev) => [...prev, c.en]);
    const result = await db.addWord(c.en, c.zh || "", c.wordType, c.level);
    if (result.id > 0) {
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(t("reading.search.added", { word: c.en }));
    } else {
      setAddedEn((prev) => prev.filter((w) => w !== c.en));
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
            if (e.key === "Enter") { e.preventDefault(); void runSearch(); }
          }}
          placeholder={t("reading.search.placeholder")}
          className="w-full h-8 pl-8 pr-7 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
        />
        {q && (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground pointer-events-none">
            ↵
          </kbd>
        )}
      </div>

      {q && searched && (
        <div className={inline ? "absolute left-0 right-0 top-full z-50 mt-2 space-y-1 rounded-xl border border-border bg-popover p-2 shadow-2xl" : "space-y-1"}>
          {/* Only in the floating variant: the inline one renders in normal
            * flow and is not an overlay. On the Browser page the native panel
            * is composited above this document, so `z-50` loses to it — the
            * panel has to step aside instead. */}
          {inline && <BrowserPanelBlocker />}
          {matches.map((w) => (
            <div
              key={w.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setQuery("");
                navigate("vocabulary", w.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setQuery("");
                  navigate("vocabulary", w.id);
                }
              }}
              className="h-auto w-full flex items-center justify-start gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors text-left"
            >
              <span className="text-xs font-semibold text-foreground">{w.word}</span>
              <SpeakButton text={w.word} className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 ml-auto shrink-0">
                {t("reading.search.inVocab")}
              </span>
            </div>
          ))}

          {isZh ? (
            <div className="space-y-1.5 rounded-lg">
              {quickError && <p className="px-1 text-xs text-destructive">{quickError}</p>}
              {noProvider && <p className="px-1 text-xs text-muted-foreground">{t("modal.noProvider")}</p>}
              {!quickLoading && !quickError && !noProvider && candidates.length === 0 && (
                <p className="px-1 text-xs text-muted-foreground">{t("reading.search.reverse.empty")}</p>
              )}

              {candidates.map((c, i) => {
                const added = addedEn.includes(c.en) || collectedEn.includes(c.en.toLowerCase());
                const meta = [c.wordType, showLevelBadges ? c.level : null].filter(Boolean);
                return (
                  <div key={c.en} className="rounded-lg border border-border/50 bg-background/60 px-2 py-1.5">
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => setExpanded(expanded === i ? -1 : i)}
                        className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                      >
                        <span className="text-xs font-semibold text-foreground">{c.en}</span>
                        {meta.length > 0 && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                            {meta.join(" · ")}
                          </span>
                        )}
                        {c.zh && <span className="truncate text-[11px] text-muted-foreground">{c.zh}</span>}
                      </button>
                      <SpeakButton text={c.en} className="mt-0.5 h-3.5 w-3.5" />
                    </div>

                    {c.note && <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{c.note}</p>}

                    {expanded === i && c.example && (
                      <blockquote className="mt-1 border-l-2 border-border pl-2 text-[11px] leading-relaxed">
                        <p className="text-foreground">{c.example}</p>
                        {c.exampleZh && <p className="text-muted-foreground">{c.exampleZh}</p>}
                      </blockquote>
                    )}

                    <div className="mt-1 flex items-center gap-1">
                      {added ? (
                        <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <Check className="h-3 w-3 shrink-0" />
                          <span className="truncate">{t("reading.search.inVocab")}</span>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => void handleAddCandidate(c)}
                          className="h-auto min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors"
                        >
                          <BookPlus className="h-3 w-3 shrink-0" />
                          <span className="truncate">{t("reading.search.addShort")}</span>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => openWordModal(c.en)}
                        className="h-auto min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted transition-colors"
                      >
                        <Sparkles className="h-3 w-3 shrink-0" />
                        <span className="truncate">{t("reading.search.deepAnalyze")}</span>
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* Keep the block at ~3 cards while streaming: each candidate
                  that lands replaces one placeholder, so nothing reflows. */}
              {quickLoading &&
                Array.from({ length: Math.max(1, 3 - candidates.length) }, (_, i) => <CandidateSkeleton key={`sk-${i}`} />)}
            </div>
          ) : (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2">
            {quickLoading && !quick && (
              <div className="space-y-1.5 px-1 py-0.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="ml-auto h-3 w-8 rounded-full" />
                </div>
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-2.5 w-4/5" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}
            {quickError && <p className="px-1 text-xs text-destructive">{quickError}</p>}
            {noProvider && <p className="px-1 text-xs text-muted-foreground">{t("modal.noProvider")}</p>}

            {quick?.text && (
              <div className="space-y-1 px-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">{q}</span>
                  <SpeakButton text={q} className="h-3.5 w-3.5" />
                  {(quickBasicInfo.zh || quick.zhShort) && <span className="text-xs text-muted-foreground">{quickBasicInfo.zh || quick.zhShort}</span>}
                  {showLevelBadges && <span className="ml-auto"><LevelBadge level={quickBasicInfo.level || quick.level} /></span>}
                </div>
                <div className="text-xs leading-relaxed [&_blockquote]:my-1 [&_blockquote]:text-[11px]">
                  <EnrichmentText text={quick.text} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              {!exactMatch && (
                <Button
                  variant="ghost"
                  onClick={handleAdd}
                  disabled={adding}
                  className="h-auto min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                >
                  <BookPlus className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{adding ? t("reading.search.adding") : t("reading.search.addShort")}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => openWordModal(q)}
                className="h-auto min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t("reading.search.deepAnalyze")}</span>
              </Button>
            </div>

            {!exactMatch && (
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
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

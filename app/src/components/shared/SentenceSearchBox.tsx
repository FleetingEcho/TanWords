import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { BookPlus } from "lucide-react";
import { useDB } from "@/hooks/useDB";
import type { PatternItem } from "@/hooks/useDB.patterns";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { analyzeSentence } from "@/features/patterns/generate";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SearchIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { useNavStore } from "@/store/navStore";
import { filterSentencePatterns } from "./sentenceSearch";
import { BrowserPanelBlocker } from "@/store/browserPanelStore";

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
  const anchorRef = useRef<HTMLDivElement>(null);

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

  // Search live and recompute once the async library load finishes. Previously,
  // pressing Enter before `listPatterns()` resolved searched an empty snapshot
  // and never retried.
  useEffect(() => {
    if (!q) {
      setSearched(false);
      setMatches([]);
      return;
    }
    setMatches(filterSentencePatterns(allPatterns, q).slice(0, 8));
    setSearched(true);
  }, [q, allPatterns]);

  const runSearch = () => {
    if (!q) return;
    setMatches(filterSentencePatterns(allPatterns, q).slice(0, 8));
    setSearched(true);
  };

  const handleAdd = async () => {
    if (!q || adding || exactMatch) return;
    setAdding(true);
    try {
      const provider = findBestProvider();
      let result = { sentence: q, zh: "", level: "", skeleton: "", note: "" };
      if (provider) {
        try { result = await analyzeSentence(provider, q, levels); }
        catch { toast.error(t("vocab.patterns.analyzeFailed")); }
      } else {
        toast.info(t("vocab.noApiKey"));
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
            <SpeakButton text={sentence} className="mt-0.5 h-3.5 w-3.5" />
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

      {canAddSentence && !exactMatch && (
        <div className="p-2">
          <Button
            variant="ghost"
            onClick={handleAdd}
            disabled={adding}
            className="h-auto w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
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
    <div className={inline ? "relative" : "space-y-2"}>
      <div ref={anchorRef} className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          autoFocus={!inline}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); runSearch(); }
          }}
          placeholder={t("vocab.patterns.quickSearchPlaceholder")}
          className="w-full h-8 pl-8 pr-7 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
        />
        {q && (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground pointer-events-none">
            ↵
          </kbd>
        )}
      </div>

      {q && searched && (
        inline && anchorRect
          ? createPortal(
              <div
                className="fixed z-[100] max-h-[min(28rem,calc(100vh-5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-2xl"
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
                <BrowserPanelBlocker />
                {resultsPanel}
              </div>,
              document.body
            )
          : <div>{resultsPanel}</div>
      )}
    </div>
  );
}

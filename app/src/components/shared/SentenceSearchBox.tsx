import React, { useEffect, useState } from "react";
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

  const [allPatterns, setAllPatterns] = useState<PatternItem[]>([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PatternItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState(false);

  const loadPatterns = () => db.listPatterns().then(setAllPatterns);
  useEffect(() => { loadPatterns(); }, []);
  useEffect(() => {
    window.addEventListener("patterns-updated", loadPatterns);
    return () => window.removeEventListener("patterns-updated", loadPatterns);
  }, []);

  const q = query.trim();
  const exactMatch = matches.some((p) =>
    p.examples.some((e) => e.sentence.trim().toLowerCase() === q.toLowerCase()));

  // Editing the query invalidates whatever was last searched, mirroring
  // WordSearchBox — results only refresh on an explicit Enter.
  useEffect(() => {
    setSearched(false);
    setMatches([]);
  }, [query]);

  const runSearch = () => {
    if (!q) return;
    const needle = q.toLowerCase();
    const found = allPatterns.filter((p) =>
      `${p.pattern} ${p.zh} ${p.note} ${p.examples.map((e) => e.sentence).join(" ")}`.toLowerCase().includes(needle));
    setMatches(found.slice(0, 4));
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

  return (
    <div className={inline ? "relative" : "space-y-2"}>
      <div className="relative">
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
        <div className={inline ? "absolute left-0 right-0 top-full z-50 mt-2 space-y-1 rounded-xl border border-border bg-popover p-2 shadow-2xl" : "space-y-1"}>
          {matches.map((p) => {
            const sentence = p.examples[0]?.sentence ?? p.pattern;
            return (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                <span className="text-xs font-medium text-foreground truncate">{sentence}</span>
                <LevelBadge level={p.level} />
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 ml-auto shrink-0">
                  {t("vocab.patterns.inLibrary")}
                </span>
              </div>
            );
          })}

          {!matches.length && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t("vocab.patterns.noMatch")}</p>
          )}

          {!exactMatch && (
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
      )}
    </div>
  );
}

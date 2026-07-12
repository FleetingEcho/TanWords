import React, { useEffect, useMemo, useState } from "react";
import { useDiscover, GeneratedWord, WordFamily } from "@/hooks/useDiscover";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useWordModalStore } from "@/store/wordModalStore";
import { toast } from "sonner";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";

const TOPICS = ["Programming", "System Design", "DevOps", "Machine Learning", "Frontend", "Databases", "Security", "Startup & VC", "AI"];
const ROOTS = ["-spect", "-ject", "-duct", "-mit", "bene-", "trans-", "-vert", "circum-"];

export function DiscoverPage() {
  const { generateTopicVocabulary, generateWordFamily, isGenerating, isGeneratingFamily } = useDiscover();
  const db = useDB();
  const t = useT();
  const openWordModal = useWordModalStore((s) => s.openWordModal);

  // Words already in the vocabulary — generated results diff against this
  const [vocabWords, setVocabWords] = useState<Set<string>>(new Set());
  const loadVocab = async () => {
    const words = await db.getWords();
    setVocabWords(new Set(words.map((w) => w.word.toLowerCase())));
  };
  useEffect(() => { loadVocab(); }, []);

  // ── Topic generation ─────────────────────────────────────────────────────

  const [topic, setTopic] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("Programming");
  const [count, setCount] = useState(50);
  const [generated, setGenerated] = useState<GeneratedWord[]>([]);
  const [generatedTopic, setGeneratedTopic] = useState("");
  const [selectedGen, setSelectedGen] = useState<Set<string>>(new Set());
  const [savingGen, setSavingGen] = useState(false);

  const isKnown = (word: string) => vocabWords.has(word.toLowerCase());
  const newGenerated = useMemo(() => generated.filter((w) => !isKnown(w.word)), [generated, vocabWords]);

  const handleGenerate = async () => {
    const topicVal = topic.trim() || selectedTopic;
    if (!topicVal || isGenerating) return;
    setGenerated([]);
    const toastId = toast.loading(t("discover.generating"));
    try {
      const parsed = await generateTopicVocabulary(topicVal, count);
      setGenerated(parsed);
      setGeneratedTopic(topicVal);
      setSelectedGen(new Set(parsed.filter((w) => !isKnown(w.word)).map((w) => w.word)));
      toast.success(t("discover.generatedOk", { n: parsed.length }), { id: toastId });
    } catch (e: any) {
      toast.error(e.message || t("discover.errFail"), { id: toastId });
    }
  };

  const saveGenSelected = async () => {
    const picked = generated.filter((g) => selectedGen.has(g.word) && !isKnown(g.word));
    if (picked.length === 0 || savingGen) return;
    setSavingGen(true);
    try {
      const result = await db.addWordsBatch(
        picked.map((w) => ({ word: w.word, zh: w.zh, level: w.level, context: w.example })),
        "discover",
        generatedTopic
      );
      if (result.added > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
      await loadVocab();
      setSelectedGen(new Set());
      toast.success(t("discover.addedOk", { n: result.added }));
    } finally {
      setSavingGen(false);
    }
  };

  // ── Word family explorer ─────────────────────────────────────────────────

  const [rootInput, setRootInput] = useState("");
  const [family, setFamily] = useState<WordFamily | null>(null);
  const [savingFamily, setSavingFamily] = useState(false);

  const exploreRoot = async (root: string) => {
    if (!root.trim() || isGeneratingFamily) return;
    setRootInput(root);
    const toastId = toast.loading(t("discover.family.loading"));
    try {
      const result = await generateWordFamily(root.trim());
      setFamily(result);
      toast.success(t("discover.family.ok", { n: result.words.length }), { id: toastId });
    } catch (e: any) {
      toast.error(e.message || t("discover.errFail"), { id: toastId });
    }
  };

  const addFamilyWord = async (w: { word: string; zh: string; level: string; breakdown: string }) => {
    const result = await db.addWordsBatch(
      [{ word: w.word, zh: w.zh, level: w.level, context: w.breakdown }],
      "discover",
      family?.root
    );
    if (result.added > 0) {
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      await loadVocab();
      toast.success(t("discover.addedOk", { n: 1 }));
    } else {
      toast.info(t("discover.alreadyIn", { word: w.word }));
    }
  };

  const addAllFamilyWords = async () => {
    if (!family || savingFamily) return;
    const pending = family.words.filter((w) => !isKnown(w.word));
    if (pending.length === 0) return;
    setSavingFamily(true);
    try {
      const result = await db.addWordsBatch(
        pending.map((w) => ({ word: w.word, zh: w.zh, level: w.level, context: w.breakdown })),
        "discover",
        family.root
      );
      if (result.added > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
      await loadVocab();
      toast.success(t("discover.addedOk", { n: result.added }));
    } finally {
      setSavingFamily(false);
    }
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">{t("discover.title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("discover.subtitle")}</p>
      </div>

      {/* Topic vocabulary generator */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-primary">✦</span>
          <h2 className="text-sm font-semibold">{t("discover.generateTitle")}</h2>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            placeholder={t("discover.placeholder")}
            className="flex-1 h-9 px-3 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
          />
          <div className="flex items-center border border-input rounded-lg overflow-hidden shrink-0">
            {[10, 20, 50, 100].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`px-3 h-9 text-xs font-semibold transition-colors ${
                  count === n ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t("discover.wordCount", { n })}
              </button>
            ))}
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
          >
            {isGenerating ? t("discover.generating") : t("discover.generate")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TOPICS.map((topic_item) => (
            <button
              key={topic_item}
              onClick={() => { setSelectedTopic(topic_item); setTopic(""); }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedTopic === topic_item && !topic
                  ? "bg-primary text-white border-primary"
                  : "border-border text-foreground hover:border-primary/50"
              }`}
            >
              {topic_item}
            </button>
          ))}
        </div>
      </div>

      {/* Generated results */}
      {generated.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedGen.size === newGenerated.length && newGenerated.length > 0}
                onChange={() =>
                  selectedGen.size === newGenerated.length
                    ? setSelectedGen(new Set())
                    : setSelectedGen(new Set(newGenerated.map((w) => w.word)))
                }
                className="rounded"
              />
              <span className="text-sm font-semibold">{t("discover.results", { n: generated.length })}</span>
              <span className="text-xs text-muted-foreground">{t("discover.selected", { n: selectedGen.size })}</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                #{generatedTopic}
              </span>
            </div>
            <button
              onClick={saveGenSelected}
              disabled={selectedGen.size === 0 || savingGen}
              className="text-xs font-semibold text-primary disabled:text-muted-foreground hover:underline"
            >
              {savingGen ? t("discover.saving") : t("discover.addToVocab")}
            </button>
          </div>
          <div className="divide-y divide-border max-h-80 overflow-y-auto">
            {generated.map((w, i) => {
              const known = isKnown(w.word);
              return (
                <div key={i} className={`flex items-center gap-3 px-5 py-2.5 ${known ? "opacity-45" : "hover:bg-muted/40"}`}>
                  <input
                    type="checkbox"
                    disabled={known}
                    checked={!known && selectedGen.has(w.word)}
                    onChange={() => {
                      setSelectedGen((prev) => {
                        const next = new Set(prev);
                        next.has(w.word) ? next.delete(w.word) : next.add(w.word);
                        return next;
                      });
                    }}
                    className="rounded shrink-0"
                  />
                  <div className="w-32 shrink-0 flex items-center gap-1">
                    <button
                      onClick={() => openWordModal(w.word)}
                      className="font-semibold text-sm text-primary hover:underline"
                    >
                      {w.word}
                    </button>
                    <SpeakButton text={w.word} className="w-3 h-3" />
                    <span className="text-[10px] text-muted-foreground ml-1">{w.ipa}</span>
                  </div>
                  <LevelBadge level={w.level} />
                  <span className="text-sm text-muted-foreground w-24 shrink-0">{w.zh}</span>
                  <span className="text-xs text-muted-foreground truncate flex-1">{w.example}</span>
                  {known && (
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                      {t("discover.inVocab")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Word family explorer */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-primary">⌘</span>
          <h2 className="text-sm font-semibold">{t("discover.family.title")}</h2>
          <span className="text-xs text-muted-foreground">{t("discover.family.sub")}</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={rootInput}
            onChange={(e) => setRootInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && exploreRoot(rootInput)}
            placeholder={t("discover.family.placeholder")}
            className="flex-1 h-9 px-3 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground font-mono"
          />
          <button
            onClick={() => exploreRoot(rootInput)}
            disabled={isGeneratingFamily || !rootInput.trim()}
            className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
          >
            {isGeneratingFamily ? t("discover.family.loadingBtn") : t("discover.family.explore")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ROOTS.map((r) => (
            <button
              key={r}
              onClick={() => exploreRoot(r)}
              disabled={isGeneratingFamily}
              className="px-3 py-1 rounded-full text-xs font-mono border border-border text-foreground hover:border-primary/50 disabled:opacity-50 transition-colors"
            >
              {r}
            </button>
          ))}
        </div>

        {family && (
          <div className="mt-2 border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b border-border">
              <span className="font-mono font-bold text-primary">{family.root}</span>
              <span className="text-sm text-muted-foreground flex-1">{family.meaning}</span>
              <button
                onClick={addAllFamilyWords}
                disabled={savingFamily || family.words.every((w) => isKnown(w.word))}
                className="text-xs font-semibold text-primary disabled:text-muted-foreground hover:underline shrink-0"
              >
                {savingFamily ? t("discover.saving") : t("discover.family.addAll")}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2">
              {family.words.map((w, i) => {
                const known = isKnown(w.word);
                return (
                  <div key={i} className={`px-4 py-3 space-y-1 border-t border-border first:border-t-0 sm:[&:nth-child(2)]:border-t-0 ${i % 2 === 0 ? "sm:border-r sm:border-border" : ""} ${known ? "opacity-45" : ""}`}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openWordModal(w.word)}
                        className="font-semibold text-sm text-primary hover:underline"
                      >
                        {w.word}
                      </button>
                      <SpeakButton text={w.word} className="w-3 h-3" />
                      <LevelBadge level={w.level} />
                      <span className="text-xs text-muted-foreground truncate flex-1">{w.zh}</span>
                      {known ? (
                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                          {t("discover.inVocab")}
                        </span>
                      ) : (
                        <button
                          onClick={() => addFamilyWord(w)}
                          className="text-[11px] font-semibold text-primary hover:underline shrink-0"
                        >
                          + {t("discover.addOne")}
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground/70">{w.breakdown}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

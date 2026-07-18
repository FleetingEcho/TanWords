import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useDB } from "@/hooks/useDB";
import type { PatternItem } from "@/hooks/useDB.patterns";
import { useT } from "@/hooks/useT";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { generateSentences, type GeneratedSentence } from "@/features/patterns/generate";

const PAGE_SIZE = 10;

/** Browse the sentence-pattern library: skeleton + translation + explanation
 * with the saved example sentences underneath. Also generates sentences for
 * any word/topic — results are auto-saved into the library, with per-row
 * delete to prune the ones not worth keeping. */
export function PatternLibrary({ initialQuery, onSeedConsumed }: { initialQuery?: string | null; onSeedConsumed?: () => void }) {
  const db = useDB();
  const t = useT();
  const levels = useSettingsStore((state) => state.targetLevels.join("/"));
  const [patterns, setPatterns] = useState<PatternItem[]>([]);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PatternItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [genQuery, setGenQuery] = useState("");
  const [genTopic, setGenTopic] = useState("");
  const [candidates, setCandidates] = useState<GeneratedSentence[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  // sentence → pattern_id for auto-saved candidates of this session
  const [savedMap, setSavedMap] = useState<Map<string, number>>(new Map());

  const [page, setPage] = useState(0);

  const load = () => db.listPatterns().then(setPatterns);
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(0); }, [search]);

  const generate = async (more: boolean, queryOverride?: string) => {
    const query = (queryOverride ?? (more ? genTopic : genQuery)).trim();
    if (!query || genBusy) return;
    const provider = findBestProvider();
    if (!provider) { toast.error(t("knowledgeMap.configureAI")); return; }
    setGenBusy(true);
    setGenTopic(query);
    const base = more ? candidates : [];
    const baseMap = more ? savedMap : new Map<string, number>();
    if (!more) { setCandidates([]); setSavedMap(new Map()); }
    try {
      const existing = new Set([
        ...base.map((c) => c.sentence),
        ...patterns.flatMap((p) => p.examples.map((e) => e.sentence)),
      ]);
      const applyBatch = (batch: GeneratedSentence[]) =>
        setCandidates([...base, ...batch.filter((c) => !existing.has(c.sentence))]);
      const generated = (await generateSentences(provider, query, levels, [...existing], undefined, applyBatch))
        .filter((c) => !existing.has(c.sentence));
      if (!generated.length) throw new Error(t("vocab.patterns.genEmpty"));
      setCandidates([...base, ...generated]);
      const entries = new Map(baseMap);
      let count = 0;
      for (const candidate of generated) {
        const saved = await db.saveSentencePattern(candidate.sentence, candidate.zh, candidate.skeleton, candidate.note, candidate.level, "generated");
        if (saved) { entries.set(candidate.sentence, saved.pattern_id); count += 1; }
      }
      setSavedMap(entries);
      if (count) { toast.success(t("vocab.patterns.autoSaved", { count })); await load(); }
    } catch (error: any) {
      setCandidates(base);
      toast.error(error?.message || t("vocab.patterns.genFailed"));
    } finally { setGenBusy(false); }
  };

  // A word picked in the Words tab ("generate sentences" button) seeds a run.
  useEffect(() => {
    if (!initialQuery?.trim()) return;
    setGenQuery(initialQuery);
    onSeedConsumed?.();
    void generate(false, initialQuery);
  }, [initialQuery]);

  const saveOne = async (candidate: GeneratedSentence) => {
    if (savedMap.has(candidate.sentence)) return;
    const saved = await db.saveSentencePattern(candidate.sentence, candidate.zh, candidate.skeleton, candidate.note, candidate.level, "generated");
    if (saved) {
      setSavedMap((current) => new Map(current).set(candidate.sentence, saved.pattern_id));
      toast.success(t("vocab.patterns.savedOne"));
      await load();
    }
  };

  const removeCandidate = async (candidate: GeneratedSentence) => {
    const patternId = savedMap.get(candidate.sentence);
    if (patternId !== undefined) {
      const deleted = await db.deletePattern(patternId);
      if (!deleted) return;
    }
    setCandidates((current) => current.filter((c) => c.sentence !== candidate.sentence));
    setSavedMap((current) => { const next = new Map(current); next.delete(candidate.sentence); return next; });
    toast.success(t("vocab.patterns.deleted"));
    await load();
  };

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return patterns;
    return patterns.filter((item) =>
      `${item.pattern} ${item.zh} ${item.note} ${item.examples.map((e) => e.sentence).join(" ")}`.toLowerCase().includes(query));
  }, [patterns, search]);

  // Deleting the last item of the last page must not leave an empty page.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [visible.length, page]);

  const remove = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const deleted = await db.deletePattern(deleteTarget.id);
    if (deleted) {
      toast.success(t("vocab.patterns.deleted"));
      setDeleteTarget(null);
      await load();
    }
    setDeleting(false);
  };

  return <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="font-serif text-2xl font-bold">{t("vocab.patterns.title")}</h1>
      <div className="mt-4 rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-4">
        <p className="text-sm font-bold">✨ {t("vocab.patterns.genTitle")}</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={genQuery}
            onChange={(event) => {
              const value = event.target.value;
              setGenQuery(value);
              // Everything is already saved to the library, so clearing the
              // input dismisses the working set too.
              if (!value.trim() && !genBusy) { setCandidates([]); setSavedMap(new Map()); }
            }}
            onKeyDown={(event) => event.key === "Enter" && void generate(false)}
            placeholder={t("vocab.patterns.genPlaceholder")}
            className="h-9 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
          />
          <Button size="sm" className="h-9" disabled={genBusy || !genQuery.trim()} onClick={() => void generate(false)}>{genBusy ? t("vocab.patterns.generating") : t("vocab.patterns.generate")}</Button>
        </div>

        {genBusy && <div className="mt-4">
          <div className="flex items-center gap-2 text-xs text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {t("vocab.patterns.genProgress", { count: candidates.length })}
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-primary/40 to-primary" />
          </div>
        </div>}

        {!!candidates.length && <>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{t("vocab.patterns.candidates", { count: candidates.length, topic: genTopic })}</span>
            <div className="flex items-center gap-2">
              <button disabled={genBusy} onClick={() => void generate(true)} className="text-xs font-medium text-primary disabled:opacity-40">{genBusy ? t("vocab.patterns.generating") : t("vocab.patterns.genMore")}</button>
              <button disabled={genBusy} onClick={() => { setCandidates([]); setSavedMap(new Map()); }} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">{t("vocab.patterns.genClear")}</button>
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {candidates.map((candidate) => {
              const saved = savedMap.has(candidate.sentence);
              return <div key={candidate.sentence} className="group flex items-start gap-3 rounded-xl border bg-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <strong className="min-w-0 break-words font-serif text-[15px]">{candidate.sentence}</strong>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{candidate.zh}</span>
                  {(candidate.skeleton || candidate.note) && <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{[candidate.skeleton, candidate.note].filter(Boolean).join(" · ")}</span>}
                </div>
                {candidate.level && <span className="mt-1 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{candidate.level}</span>}
                {saved && <span className="mt-1 shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">✓</span>}
                <SpeakButton text={candidate.sentence} className="mt-1.5 h-4 w-4 shrink-0" />
                {saved
                  ? <button
                      onClick={() => void removeCandidate(candidate)}
                      title={t("vocab.patterns.delete")}
                      aria-label={`${t("vocab.patterns.delete")}: ${candidate.sentence}`}
                      className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs text-muted-foreground transition hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                    >×</button>
                  : <button
                      disabled={genBusy}
                      onClick={() => void saveOne(candidate)}
                      title={t("knowledgeMap.savePattern")}
                      aria-label={t("knowledgeMap.savePattern")}
                      className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-40"
                    >+</button>}
              </div>;
            })}
          </div>
        </>}
      </div>

      <div className="mt-8 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-lg font-bold">{t("vocab.patterns.savedTitle")} <span className="ml-1 text-sm font-normal text-muted-foreground">({patterns.length})</span></h2>
        <div className="flex h-8 w-64 max-w-full items-center rounded-lg border bg-background px-2.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
          <span className="mr-2 text-xs text-muted-foreground">⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("vocab.patterns.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          {search && <button onClick={() => setSearch("")} className="text-xs text-muted-foreground">×</button>}
        </div>
      </div>

      {!visible.length && <div className="mt-6 rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        {patterns.length ? t("vocab.patterns.noMatch") : t("vocab.patterns.empty")}
      </div>}

      <div className="mt-4 space-y-3">
        {visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => <article key={item.id} className="group rounded-2xl border bg-card p-4 transition hover:border-primary/40">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <strong className="min-w-0 break-words font-serif text-lg">{item.pattern}</strong>
                {item.level && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{item.level}</span>}
                <SpeakButton text={item.pattern} className="h-4 w-4 shrink-0" />
              </div>
              {item.zh && <p className="mt-1 text-sm text-muted-foreground">{item.zh}</p>}
              {item.note && !item.note.startsWith("__") && <p className="mt-2 rounded-xl bg-muted/50 px-3 py-2 text-sm leading-6">{item.note}</p>}
            </div>
            <button onClick={() => setDeleteTarget(item)} title={t("vocab.patterns.delete")} aria-label={`${t("vocab.patterns.delete")}: ${item.pattern}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 focus:opacity-100">×</button>
          </div>
          {item.examples.filter((example) => example.sentence !== item.pattern).length > 0 && <div className="mt-3 space-y-1.5 border-t pt-3">
            {item.examples.filter((example) => example.sentence !== item.pattern).map((example) => <div key={example.id} className="flex items-start gap-2">
              <SpeakButton text={example.sentence} className="mt-1 h-3.5 w-3.5 shrink-0" />
              <p className="min-w-0 flex-1 break-words text-sm leading-6">{example.sentence}</p>
              {example.source && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{example.source}</span>}
            </div>)}
          </div>}
        </article>)}
      </div>

      {visible.length > PAGE_SIZE && <div className="mt-4 flex items-center justify-center gap-4 text-sm">
        <button disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-30">‹</button>
        <span className="text-xs text-muted-foreground">{page + 1} / {Math.ceil(visible.length / PAGE_SIZE)}</span>
        <button disabled={(page + 1) * PAGE_SIZE >= visible.length} onClick={() => setPage((value) => value + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-30">›</button>
      </div>}
      </div>
    </div>

    <ConfirmModal
      open={Boolean(deleteTarget)}
      title={t("vocab.patterns.delete")}
      message={t("vocab.patterns.deleteConfirm", { name: deleteTarget?.pattern ?? "" })}
      confirmLabel={deleting ? t("vocab.patterns.deleting") : t("vocab.patterns.delete")}
      confirmDisabled={deleting}
      onConfirm={remove}
      onCancel={() => !deleting && setDeleteTarget(null)}
    />
  </div>;
}

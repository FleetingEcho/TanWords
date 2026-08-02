import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { findBestProvider } from "@/providers/select";
import { useSettingsStore } from "@/store/settingsStore";
import { generateSentences, analyzeSentence, type GeneratedSentence } from "@/features/patterns/generate";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { SparkIcon, CloseIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { hostCapabilities } from "@/platform";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which tab to open on ("add" for the header's + button, "generate" for
   *  its sparkle button or a word seeded from the Words tab). */
  initialMode: "add" | "generate";
  /** Pre-fills and immediately runs the generate tab — used when a word on
   *  the Words tab asks for example sentences. */
  initialQuery?: string | null;
  /** Every sentence already saved — generate dedupes candidates against this. */
  existingSentences: string[];
  onAdded: () => void;
}

/** Add sentences to the library two ways: type/paste one and let AI fill in
 *  the translation, level and reusable pattern (quick add), or generate a
 *  batch of new example sentences for a word/topic (same flow the old
 *  inline "Generate sentences" box offered, just moved into a modal so the
 *  list/detail layout has room to breathe). */
export function SentenceModal({ open, onClose, initialMode, initialQuery, existingSentences, onAdded }: Props) {
  const db = useDB();
  const t = useT();
  const levels = useSettingsStore((s) => s.targetLevels.join("/"));
  const [mode, setMode] = useState<"add" | "generate">(initialMode);

  // ── Quick add: one sentence, AI fills the rest ──────────────────────────

  const [quickText, setQuickText] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);

  const quickAdd = async () => {
    const sentence = quickText.trim();
    if (!sentence || quickBusy) return;
    setQuickBusy(true);
    try {
      const provider = findBestProvider();
      let result: GeneratedSentence = { sentence, zh: "", level: "", skeleton: "", note: "" };
      if (provider) {
        try { result = await analyzeSentence(provider, sentence, levels); }
        catch { toast.error(t("vocab.patterns.analyzeFailed")); }
      } else {
        toast.info(t("vocab.noApiKey"));
      }
      const saved = await db.saveSentencePattern(result.sentence, result.zh, result.skeleton, result.note, result.level, "manual");
      if (saved) {
        toast.success(t("vocab.patterns.savedOne"));
        setQuickText("");
        onAdded();
      }
    } finally {
      setQuickBusy(false);
    }
  };

  // ── Generate from word/topic: multi-candidate ───────────────────────────

  const [genQuery, setGenQuery] = useState("");
  const [genTopic, setGenTopic] = useState("");
  const [candidates, setCandidates] = useState<GeneratedSentence[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  // sentence → pattern_id, for candidates saved during this session
  const [savedMap, setSavedMap] = useState<Map<string, number>>(new Map());
  // Sentences ticked for saving. Nothing is written to the library until the
  // user confirms — generating is a preview, not a commit.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const generate = async (more: boolean, queryOverride?: string) => {
    const query = (queryOverride ?? (more ? genTopic : genQuery)).trim();
    if (!query || genBusy) return;
    const provider = findBestProvider();
    if (!provider) { toast.error(t("vocab.noApiKey")); return; }
    setGenBusy(true);
    setGenTopic(query);
    const base = more ? candidates : [];
    if (!more) { setCandidates([]); setSavedMap(new Map()); setSelected(new Set()); }
    try {
      const existing = new Set([...base.map((c) => c.sentence), ...existingSentences]);
      // Fresh candidates arrive pre-ticked so the common "keep them all" case is
      // still one click, but the write only happens when the user says so.
      const tick = (batch: GeneratedSentence[]) =>
        setSelected((current) => {
          const next = new Set(current);
          for (const c of batch) next.add(c.sentence);
          return next;
        });
      const applyBatch = (batch: GeneratedSentence[]) => {
        const fresh = batch.filter((c) => !existing.has(c.sentence));
        setCandidates([...base, ...fresh]);
        tick(fresh);
      };
      const generated = (await generateSentences(provider, query, levels, [...existing], undefined, applyBatch))
        .filter((c) => !existing.has(c.sentence));
      if (!generated.length) throw new Error(t("vocab.patterns.genEmpty"));
      setCandidates([...base, ...generated]);
      tick(generated);
    } catch (error: any) {
      setCandidates(base);
      toast.error(error?.message || t("vocab.patterns.genFailed"));
    } finally { setGenBusy(false); }
  };

  /** Candidates the user could still act on — already-saved ones are frozen. */
  const selectable = candidates.filter((c) => !savedMap.has(c.sentence));
  const selectedCount = selectable.filter((c) => selected.has(c.sentence)).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;

  const toggleOne = (sentence: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sentence)) next.delete(sentence);
      else next.add(sentence);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.sentence)));

  const addSelected = async () => {
    const toAdd = selectable.filter((c) => selected.has(c.sentence));
    if (!toAdd.length || addBusy) return;
    setAddBusy(true);
    try {
      const entries = new Map(savedMap);
      let count = 0;
      for (const candidate of toAdd) {
        const saved = await db.saveSentencePattern(candidate.sentence, candidate.zh, candidate.skeleton, candidate.note, candidate.level, "generated");
        if (saved) { entries.set(candidate.sentence, saved.pattern_id); count += 1; }
      }
      setSavedMap(entries);
      if (count) { toast.success(t("vocab.patterns.savedMany", { count })); onAdded(); }
    } finally { setAddBusy(false); }
  };

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    if (initialMode === "generate" && initialQuery?.trim()) {
      setGenQuery(initialQuery);
      void generate(false, initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Undo for a candidate already written to the library this session. */
  const removeCandidate = async (candidate: GeneratedSentence) => {
    const patternId = savedMap.get(candidate.sentence);
    if (patternId !== undefined) {
      const deleted = await db.deletePattern(patternId);
      if (!deleted) return;
    }
    setCandidates((current) => current.filter((c) => c.sentence !== candidate.sentence));
    setSavedMap((current) => { const next = new Map(current); next.delete(candidate.sentence); return next; });
    setSelected((current) => { const next = new Set(current); next.delete(candidate.sentence); return next; });
    toast.success(t("vocab.patterns.deleted"));
    onAdded();
  };

  const handleClose = () => {
    onClose();
    setQuickText("");
    setGenQuery("");
    setGenTopic("");
    setCandidates([]);
    setSavedMap(new Map());
    setSelected(new Set());
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="max-w-2xl">
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <SparkIcon className="w-3.5 h-3.5 text-primary" />
          <DialogTitle className="text-sm font-semibold">{t("vocab.patterns.modalTitle")}</DialogTitle>
        </div>
        <Button
          variant="ghost"
          onClick={handleClose}
          className="w-10 h-10 lg:w-7 lg:h-7 p-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <CloseIcon className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex gap-1 px-6 pt-3">
        <Button
          variant="ghost"
          onClick={() => setMode("generate")}
          className={`h-auto px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            mode === "generate" ? "bg-primary text-white hover:bg-primary" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {t("vocab.patterns.tabGenerate")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setMode("add")}
          className={`h-auto px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            mode === "add" ? "bg-primary text-white hover:bg-primary" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {t("vocab.patterns.tabAdd")}
        </Button>
      </div>

      <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        {mode === "add" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("vocab.patterns.addHint")}</p>
            <div className="flex gap-2">
              <input
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void quickAdd()}
                placeholder={t("vocab.patterns.addPlaceholder")}
                className="flex-1 h-9 px-3 text-sm rounded-lg border border-input bg-background focus:outline-hidden focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
              />
              <Button
                onClick={quickAdd}
                disabled={quickBusy || !quickText.trim()}
                className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
              >
                {quickBusy ? t("vocab.patterns.adding") : t("vocab.patterns.add")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                value={genQuery}
                onChange={(e) => setGenQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void generate(false)}
                placeholder={t("vocab.patterns.genPlaceholder")}
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-hidden focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              />
              <Button className="h-9" disabled={genBusy || !genQuery.trim()} onClick={() => void generate(false)}>
                {genBusy ? t("vocab.patterns.generating") : t("vocab.patterns.generate")}
              </Button>
            </div>

            {genBusy && (
              <div>
                <div className="flex items-center gap-2 text-xs text-primary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  {t("vocab.patterns.genProgress", { count: candidates.length })}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-linear-to-r from-primary/40 to-primary" />
                </div>
              </div>
            )}

            {!!candidates.length && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t("vocab.patterns.candidates", { count: candidates.length, topic: genTopic })}</span>
                  <div className="flex items-center gap-2">
                    {selectable.length > 0 && (
                      <button disabled={genBusy} onClick={toggleAll} className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40">
                        {allSelected ? t("vocab.patterns.unselectAll") : t("vocab.patterns.selectAll")}
                      </button>
                    )}
                    <button disabled={genBusy} onClick={() => void generate(true)} className="text-xs font-medium text-primary disabled:opacity-40">
                      {genBusy ? t("vocab.patterns.generating") : t("vocab.patterns.genMore")}
                    </button>
                    <button disabled={genBusy} onClick={() => { setCandidates([]); setSavedMap(new Map()); setSelected(new Set()); }} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
                      {t("vocab.patterns.genClear")}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {candidates.map((candidate) => {
                    const saved = savedMap.has(candidate.sentence);
                    const isSelected = selected.has(candidate.sentence);
                    return (
                      <div
                        key={candidate.sentence}
                        onClick={saved ? undefined : () => toggleOne(candidate.sentence)}
                        className={`group flex items-start gap-3 rounded-xl border bg-card px-3 py-2 transition-colors ${
                          saved
                            ? "border-emerald-500/30"
                            : `cursor-pointer ${isSelected ? "border-primary/50 bg-primary/5" : "hover:border-border/80"}`
                        }`}
                      >
                        {saved ? (
                          <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-500">✓</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(candidate.sentence)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={candidate.sentence}
                            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-1.5">
                            <strong className="min-w-0 wrap-break-word font-serif text-[15px] block">{candidate.sentence}</strong>
                            {hostCapabilities.nativeTts && <SpeakButton text={candidate.sentence} className="mt-1.5 h-4 w-4 shrink-0" />}
                          </div>
                          <span className="mt-0.5 block text-sm text-muted-foreground">{candidate.zh}</span>
                          {(candidate.skeleton || candidate.note) && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
                              {[candidate.skeleton, candidate.note].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </div>
                        <LevelBadge level={candidate.level} />
                        {/* Row click toggles selection, so anything interactive
                          * inside it has to keep its click to itself. */}
                        <span onClick={(e) => e.stopPropagation()} className="contents">
                          {saved && (
                            <button
                              onClick={() => void removeCandidate(candidate)}
                              title={t("vocab.patterns.delete")}
                              className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs text-muted-foreground transition hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                            >×</button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Outside the scroll area: with a long candidate list the confirm action
        * must not scroll out of reach. */}
      {mode === "generate" && candidates.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3">
          <span className="text-xs text-muted-foreground">
            {t("vocab.patterns.selectedCount", { count: selectedCount })}
          </span>
          <Button
            onClick={addSelected}
            disabled={genBusy || addBusy || selectedCount === 0}
            className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {addBusy ? t("vocab.patterns.adding") : t("vocab.patterns.addSelected", { count: selectedCount })}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

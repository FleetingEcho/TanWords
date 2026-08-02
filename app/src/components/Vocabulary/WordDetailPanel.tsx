import React, { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { ParsedEnrichment } from "@/lib/enrichMeta";
import { parseEnrichOutline } from "@/lib/enrichSections";
import { EnrichmentText } from "@/components/EnrichmentText";
import { LevelBadge } from "@/components/shared/LevelBadge";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { LazyWordNotesEditor } from "@/components/LazyWordNotesEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { SparkIcon, RefreshIcon, NotesIcon, ChevronDownIcon } from "@/components/ui/icons";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hostCapabilities } from "@/platform";

/** Shared by the header and the scrolling body so the word, its jump nav and the
 * prose it points at all sit on the same measure — a centred column of text under
 * a full-bleed left-aligned header reads as two unrelated layouts. */
const MEASURE = "mx-auto w-full max-w-3xl px-6";

interface SelectedInfo {
  word: string;
  zh: string | null;
  wordType: string | null;
  level: string | null;
  ipa: string;
}

interface Props {
  selected: SelectedInfo;
  wordId: number | null;
  enriched: ParsedEnrichment | null;
  enriching: boolean;
  enrichError: string;
  /** True when this word only has old structured enrichment (pre-rewrite) — offer regenerate instead of rendering it. */
  legacy: boolean;
  notes: string;
  /** Dictionary lookup of a word not (yet) in the vocabulary */
  lookupMode?: boolean;
  lookupAdded?: boolean;
  onAddToVocab?: () => void;
  onNotesChange: (v: string) => void;
  onClearNotes: () => void;
  onRetry: () => void;
  onReenrich: () => void;
  /** Shown as a header action when provided — jumps to the pattern library
   * and generates example sentences for this word. */
  onGeneratePatterns?: () => void;
}

export function WordDetailPanel({
  selected, wordId, enriched, enriching, enrichError, legacy, notes,
  lookupMode = false, lookupAdded = false, onAddToVocab,
  onNotesChange, onClearNotes, onRetry, onReenrich, onGeneratePatterns,
}: Props) {
  const t = useT();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Condensing the header on scroll keeps the word, its reading and the actions
  // reachable through a long explanation without spending 100px on them the whole
  // way down — the old header scrolled away entirely.
  const [condensed, setCondensed] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const outline = useMemo(
    () => (enriched && !legacy ? parseEnrichOutline(enriched.text) : null),
    [enriched?.text, legacy]
  );
  const sections = outline?.sections ?? [];

  // Switching words reuses this component, so without an explicit reset the new
  // word opens at the previous one's scroll offset.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setCondensed(false);
    setActiveSection(null);
    setNotesOpen(false);
  }, [selected.word, wordId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setCondensed(el.scrollTop > 16);
      // The active chip is the last section whose heading has crossed into the
      // top third of the viewport — the section you are reading is the one whose
      // heading is just overhead, not the one whose heading is still mid-screen.
      // Headings are in document order, so the first one still below that line
      // ends the search.
      const line = el.clientHeight * 0.35;
      let active: string | null = null;
      // Parked at the top you are reading the lead, however close the first
      // heading happens to sit to the fold line.
      if (el.scrollTop > 8) {
        for (const mark of Array.from(el.querySelectorAll<HTMLElement>("[data-section-id]"))) {
          if (mark.offsetTop - el.scrollTop > line) break;
          active = mark.dataset.sectionId ?? null;
        }
      }
      setActiveSection(active);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    el.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections.length]);

  const jumpTo = (id: string | null) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!id) return el.scrollTo({ top: 0, behavior: "smooth" });
    const target = el.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
    if (target) el.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: "smooth" });
  };

  const notesPreview = notes.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

  const gloss = [selected.wordType && `${selected.wordType}.`, selected.zh].filter(Boolean).join(" ");

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      {/* ── Identity + actions: pinned, so they survive a long explanation ── */}
      <header className="shrink-0 border-b border-border/60 bg-background">
        <div className={`${MEASURE} transition-[padding] duration-200 ${condensed ? "py-2.5" : "pb-4 pt-6"}`}>
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className={`font-bold tracking-tight transition-[font-size] duration-200 ${condensed ? "text-xl" : "text-[2rem] leading-none"}`}>
                  {selected.word}
                </h1>
                {selected.ipa && <span className="font-mono text-sm text-muted-foreground">/{selected.ipa}/</span>}
                <LevelBadge level={selected.level} />
                {hostCapabilities.nativeTts && <SpeakButton text={selected.word} className={condensed ? "h-4 w-4" : "h-[1.15rem] w-[1.15rem]"} />}
                {/* Condensed, the gloss rides the title row — it is the one piece of
                 * meaning worth keeping on screen while reading the analysis. */}
                {condensed && gloss && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{gloss}</span>
                )}
              </div>
              {!condensed && gloss && (
                <p className="truncate text-[0.95rem] text-muted-foreground">{gloss}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {onGeneratePatterns && (
                <Button
                  variant="outline"
                  onClick={onGeneratePatterns}
                  className="h-8 gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <SparkIcon className="h-3.5 w-3.5 text-primary" />
                  <span className="hidden sm:inline">{t("vocab.genPatterns")}</span>
                </Button>
              )}
              {lookupMode ? (
                lookupAdded ? (
                  <span className="inline-flex items-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t("search.added")}</span>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={onAddToVocab}
                    disabled={enriching || !enriched}
                    className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {t("search.addToVocab")}
                  </Button>
                )
              ) : (
                enriched && !enriching && (
                  // Icon-only: the label lives in title/aria-label so the action
                  // stays discoverable without competing with "Generate sentences".
                  <Button
                    variant="ghost"
                    onClick={onReenrich}
                    title={t("vocab.reenrich")}
                    aria-label={t("vocab.reenrich")}
                    className="flex h-8 w-8 items-center justify-center rounded-lg p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <RefreshIcon className="h-4 w-4" />
                  </Button>
                )
              )}
            </div>
          </div>
        </div>

        {/* ── Jump nav: the explanation's own table of contents ── */}
        {sections.length > 1 && (
          <div className={`${MEASURE} -mt-1 pb-2`}>
            {/* Wraps rather than scrolls horizontally: a table of contents whose
                last entries are off-screen is not one. */}
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => jumpTo(null)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  activeSection === null ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t("vocab.outlineTop")}
              </button>
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => jumpTo(section.id)}
                  title={section.label}
                  className={`max-w-44 truncate rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    activeSection === section.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* ── Explanation ── */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        <div className={`${MEASURE} animate-fade-in pb-12 pt-5`}>
          {/* Legacy structured enrichment from before the freeform-text rewrite */}
          {!lookupMode && legacy && !enriching && (
            <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-xs">
              <span className="text-amber-600 dark:text-amber-400">{t("vocab.legacyEnrichment")}</span>
              <Button variant="link" onClick={onReenrich} className="inline-flex h-auto items-center gap-1 p-0 font-semibold text-primary hover:underline">
                <SparkIcon className="h-3 w-3" /> {t("vocab.reenrich")}
              </Button>
            </div>
          )}

          {enriching && (
            <div className="mb-4 flex items-center gap-2">
              <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs text-muted-foreground">{t("vocab.analyzing")}</span>
            </div>
          )}

          {enriched && !legacy && <EnrichmentText text={enriched.text} outline={outline ?? undefined} />}

          {/* Enrich error */}
          {!enriched && !enriching && enrichError && (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <p className="inline-flex items-center gap-1.5 text-sm text-destructive"><TriangleAlert className="h-4 w-4" /> {enrichError}</p>
              <Button variant="outline" onClick={onRetry} className="h-8 rounded-lg px-4 text-xs font-semibold">{t("vocab.retry")}</Button>
            </div>
          )}

          {/* No enrichment, no error, not enriching */}
          {!enriched && !legacy && !enriching && !enrichError && (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <p className="text-sm text-muted-foreground">{t("vocab.noData")}</p>
              <Button variant="outline" onClick={onRetry} className="h-8 gap-1.5 rounded-lg px-4 text-xs font-semibold">
                <SparkIcon className="h-3.5 w-3.5 text-primary" /> {t("vocab.aiEnrich")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Notes: a drawer off the bottom edge rather than the tail of the
           explanation, which on a long word was several screens down ── */}
      {!lookupMode && (
        <div className="shrink-0 border-t border-border/60 bg-card/40">
          <div className={MEASURE}>
            <div className="flex items-center gap-2 py-2">
              <button
                onClick={() => setNotesOpen((v) => !v)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-expanded={notesOpen}
              >
                <NotesIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("vocab.myNotes")}
                </span>
                {!notesOpen && (
                  <span className={`min-w-0 truncate text-xs ${notesPreview ? "text-foreground/70" : "text-muted-foreground/60"}`}>
                    {notesPreview || t("vocab.notesEmptyHint")}
                  </span>
                )}
                <ChevronDownIcon className={`ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${notesOpen ? "" : "rotate-180"}`} />
              </button>
              {notesOpen && notes && (
                <Button variant="link" onClick={() => setConfirmClearOpen(true)} className="h-auto shrink-0 p-0 text-[11px] text-muted-foreground transition-colors hover:text-destructive">
                  {t("vocab.clear")}
                </Button>
              )}
            </div>
            {notesOpen && (
              <div className="mb-3 h-44 rounded-xl border border-border bg-background">
                <LazyWordNotesEditor wordId={wordId} text={notes} onChange={onNotesChange} />
              </div>
            )}
          </div>
          <ConfirmModal
            open={confirmClearOpen}
            title={t("vocab.clearNotesTitle")}
            message={t("vocab.clearNotesMessage")}
            confirmLabel={t("vocab.clear")}
            onConfirm={() => { onClearNotes(); setConfirmClearOpen(false); }}
            onCancel={() => setConfirmClearOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

import React from "react";
import { useT } from "@/hooks/useT";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import { SpeakButton } from "@/components/ui/SpeakButton";

export interface EnrichedData {
  definitions?: { pos: string; zh: string; en?: string; exampleEn?: string; exampleZh?: string }[];
  synonyms?: { word: string; note?: string; noteZh?: string }[];
  antonyms?: string[];
  collocations?: string[];
  derivatives?: { word: string; wordType?: string; word_type?: string; zh?: string }[];
  sentencePatterns?: { pattern: string; explanation?: string; example?: string }[];
  idioms?: { idiom: string; explanation?: string; example?: string }[];
  authorityQuotes?: { text: string; source?: string }[];
  authority_quotes?: { text: string; source?: string }[];
  sentence_patterns?: { pattern: string; explanation?: string; example?: string }[];
  /** AI-generated example sentences (label: casual|formal|technical|business) */
  sentences?: { text: string; label: string }[];
  etymology?: { parts?: any[]; story?: string; originLang?: string; origin_lang?: string };
  level?: string;
  mnemonic?: string;
  complete?: boolean;
}

interface SectionsProps {
  enriched: EnrichedData | null;
  enriching: boolean;
  vocabBilingual: boolean;
  openWordModal: (word: string) => void;
}

export function EnrichmentSections({ enriched, enriching, vocabBilingual, openWordModal }: SectionsProps) {
  const t = useT();
  const quotes = (enriched?.sentences || enriched?.authority_quotes || enriched?.authorityQuotes || []) as any[];
  const patterns = enriched?.sentence_patterns || enriched?.sentencePatterns || [];
  const derivatives = enriched?.derivatives || [];

  return (
    <>
      {/* Definitions */}
      {enriched?.definitions && enriched.definitions.length > 0 ? (
        <section>
          <div className="space-y-2">
            {enriched.definitions.map((def, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-muted-foreground text-sm font-medium w-4 shrink-0 mt-0.5">{i + 1}</span>
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-semibold text-muted-foreground border border-border px-1.5 py-0.5 rounded">{def.pos}</span>
                    <span className="text-sm font-medium">（{def.zh}）</span>
                  </div>
                  {def.en && <p className="text-xs text-muted-foreground italic">{def.en}</p>}
                  {def.exampleEn && (
                    <p className="text-xs mt-0.5 flex items-start gap-1">
                      <span>{def.exampleEn}</span>
                      <SpeakButton text={def.exampleEn} className="w-3 h-3 mt-0.5" />
                    </p>
                  )}
                  {vocabBilingual && def.exampleZh && <p className="text-xs mt-0.5 text-muted-foreground">{def.exampleZh}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : enriching && enriched?.definitions === undefined ? (
        <section><SectionSkeleton rows={3} /></section>
      ) : null}

      {/* Derivatives */}
      {enriching && enriched?.derivatives === undefined && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.derivatives")}</p>
          <SectionSkeleton />
        </section>
      )}
      {derivatives.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.derivatives")}</p>
          <div className="flex flex-wrap gap-1.5">
            {derivatives.map((d, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-accent text-accent-foreground">
                <button onClick={() => openWordModal(d.word)} className="hover:text-primary transition-colors">
                  {d.word}{(d.wordType || d.word_type) && <span className="text-muted-foreground ml-1">{d.wordType || d.word_type}</span>}{vocabBilingual && d.zh && <span className="text-muted-foreground ml-1 font-normal">· {d.zh}</span>}
                </button>
                <SpeakButton text={d.word} className="w-3 h-3" />
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Authority quotes */}
      {enriching && enriched?.sentences === undefined && enriched?.authorityQuotes === undefined && enriched?.authority_quotes === undefined && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.quotes")}</p>
          <SectionSkeleton rows={3} />
        </section>
      )}
      {quotes.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.quotes")}</p>
          <div className="bg-accent/40 rounded-xl p-4 border-l-4 border-primary/40">
            <p className="text-sm italic leading-relaxed flex items-start gap-1.5">
              <span>{quotes[0].text}</span>
              <SpeakButton text={quotes[0].text} className="w-3.5 h-3.5 mt-0.5" />
            </p>
            {quotes[0].source && <p className="text-[10px] text-muted-foreground mt-1">— {quotes[0].source}</p>}
            {!quotes[0].source && quotes[0].label && <p className="text-[10px] text-muted-foreground mt-1">— {quotes[0].label}</p>}
          </div>
        </section>
      )}

      {/* Synonyms + Collocations */}
      {enriching && enriched?.synonyms === undefined && (
        <div className="grid grid-cols-2 gap-4">
          <section><p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.synonyms")}</p><SectionSkeleton rows={4} /></section>
          <section><p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.collocations")}</p><SectionSkeleton rows={3} /></section>
        </div>
      )}
      {((enriched?.synonyms?.length ?? 0) > 0 || (enriched?.collocations?.length ?? 0) > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {(enriched?.synonyms?.length ?? 0) > 0 && (
            <section>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.synonyms")}</p>
              <div className="space-y-1.5">
                {enriched!.synonyms!.slice(0, 4).map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <button onClick={() => openWordModal(s.word)} className="text-sm font-semibold text-primary hover:underline shrink-0">{s.word}</button>
                    <span className="text-xs text-muted-foreground leading-5">{vocabBilingual && s.noteZh ? s.noteZh : s.note}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {(enriched?.collocations?.length ?? 0) > 0 && (
            <section>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.collocations")}</p>
              <div className="flex flex-wrap gap-1.5">
                {enriched!.collocations!.map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border border-border bg-card font-mono">
                    {c}
                    <SpeakButton text={c} className="w-3 h-3" />
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Antonyms */}
      {(enriched?.antonyms?.length ?? 0) > 0 && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.antonyms")} <span className="normal-case text-muted-foreground/60">{t("vocab.antonymNote")}</span></p>
          <div className="flex flex-wrap gap-1.5">
            {enriched!.antonyms!.map((a, i) => (
              <button key={i} onClick={() => openWordModal(a)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors">{a}</button>
            ))}
          </div>
        </section>
      )}

      {/* Sentence patterns */}
      {enriching && enriched?.sentencePatterns === undefined && enriched?.sentence_patterns === undefined && (
        <section><p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.patterns")}</p><SectionSkeleton rows={3} /></section>
      )}
      {patterns.length > 0 && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.patterns")}</p>
          <div className="space-y-2">
            {patterns.map((p, i) => (
              <div key={i} className="p-3 rounded-xl bg-card border border-border">
                <p className="text-sm font-semibold">{p.pattern}</p>
                {p.explanation && <p className="text-xs text-muted-foreground mt-0.5">{p.explanation}</p>}
                {p.example && (
                  <p className="text-xs italic mt-1 text-foreground/70 flex items-start gap-1">
                    <span>{p.example}</span>
                    <SpeakButton text={p.example} className="w-3 h-3 mt-0.5" />
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Idioms */}
      {(enriched?.idioms?.length ?? 0) > 0 && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.idioms")}</p>
          <div className="space-y-2">
            {enriched!.idioms!.map((id, i) => (
              <div key={i} className="p-3 rounded-xl bg-card border border-border">
                <p className="text-sm font-semibold flex items-center gap-1">
                  <span>{id.idiom}</span>
                  <SpeakButton text={id.idiom} className="w-3 h-3" />
                </p>
                {id.explanation && <p className="text-xs text-muted-foreground mt-0.5">{id.explanation}</p>}
                {vocabBilingual && id.example && <p className="text-xs italic mt-1 text-foreground/70">{id.example}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* More quotes */}
      {quotes.length > 1 && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.moreQuotes")} <span className="normal-case text-muted-foreground/60">{t("vocab.moreQuotesNote")}</span></p>
          <div className="space-y-2">
            {quotes.slice(1).map((q, i) => (
              <div key={i} className="p-3 rounded-xl bg-card border border-border">
                <p className="text-sm italic leading-relaxed flex items-start gap-1.5">
                  <span>"{q.text}"</span>
                  <SpeakButton text={q.text} className="w-3.5 h-3.5 mt-0.5" />
                </p>
                {q.source && <p className="text-[10px] text-muted-foreground mt-1">— {q.source}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Etymology */}
      {enriching && enriched?.etymology === undefined && (
        <section><p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.etymology")}</p><SectionSkeleton rows={2} /></section>
      )}
      {enriched?.etymology && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.etymology")}</p>
          <div className="p-4 rounded-xl bg-card border border-border space-y-3">
            {Array.isArray(enriched.etymology.parts) && enriched.etymology.parts.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {enriched.etymology.parts.map((p: any, i: number) => (
                  <div key={i} className="text-center">
                    <div className="px-3 py-1.5 rounded-lg border border-primary/30 bg-accent/50 text-xs font-mono font-semibold">{p.seg}</div>
                    <p className="text-[10px] text-muted-foreground mt-1">{p.meaning}</p>
                  </div>
                ))}
              </div>
            )}
            {enriched.etymology.story && <p className="text-xs text-muted-foreground leading-relaxed">{enriched.etymology.story}</p>}
          </div>
        </section>
      )}

      {/* Mnemonic */}
      {enriched?.mnemonic && (
        <section>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("vocab.mnemonic")}</p>
          <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
            <p className="text-sm leading-relaxed">{enriched.mnemonic}</p>
          </div>
        </section>
      )}
    </>
  );
}

import React from "react";
import { Badge } from "@/components/ui/badge";
import { WordEnrichment } from "@/providers/base";
import { Skeleton, SectionSkeleton } from "@/components/ui/Skeleton";
import { SpeakButton } from "@/components/ui/SpeakButton";

// ── Skeleton Components ────────────────────────────────────────────────────

export function LoadingSkeleton({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <p className="text-xs text-center text-muted-foreground">{t("modal.fetching")}</p>
    </div>
  );
}

export function ErrorState({ message, t }: { message: string; t: (k: string) => string }) {
  return (
    <div className="py-8 text-center space-y-3">
      <p className="text-destructive text-sm">⚠️ {message}</p>
      <p className="text-xs text-muted-foreground">{t("modal.noProviderSub")}</p>
    </div>
  );
}

// ── Enrichment Content ─────────────────────────────────────────────────────

interface Props {
  data: Partial<WordEnrichment>;
  word: string;
  t: (k: string) => string;
  pendingSlices: number;
}

export function EnrichmentContent({ data, word, t, pendingSlices }: Props) {
  const loading = pendingSlices > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-2xl font-bold">{word}</h2>
        {data.level && (
          <Badge variant="default" className="text-xs">
            {data.level}
          </Badge>
        )}
        <SpeakButton text={word} className="w-5 h-5" />
      </div>

      {/* Definitions — slice 1 */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t("modal.definitions")}
        </h3>
        {data.definitions === undefined ? (
          <SectionSkeleton />
        ) : data.definitions.length > 0 ? (
          <div className="space-y-2">
            {data.definitions.map((def, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-[10px]">{def.pos}</Badge>
                  <span className="font-medium text-sm">{def.zh}</span>
                </div>
                <p className="text-xs text-muted-foreground italic">"{def.en}"</p>
                {def.exampleEn && (
                  <div className="mt-1.5">
                    <p className="text-xs flex items-start gap-1">
                      <span>{def.exampleEn}</span>
                      <SpeakButton text={def.exampleEn} className="w-3 h-3 mt-0.5" />
                    </p>
                    {def.exampleZh && (
                      <p className="text-xs text-muted-foreground">{def.exampleZh}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* Synonyms + Antonyms — slice 2 */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t("modal.synonymsAntonyms")}
        </h3>
        {data.synonyms === undefined ? (
          <SectionSkeleton />
        ) : (data.synonyms.length > 0 || (data.antonyms?.length ?? 0) > 0) ? (
          <div className="flex flex-wrap gap-1.5">
            {data.synonyms.map((s, i) => (
              <Badge key={i} variant="secondary" className="text-xs" title={s.note}>
                {s.word}
              </Badge>
            ))}
            {data.antonyms?.map((a, i) => (
              <Badge key={`a-${i}`} variant="destructive" className="text-xs">{a}</Badge>
            ))}
          </div>
        ) : null}
      </section>

      {/* Collocations — slice 2 */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t("modal.collocations")}
        </h3>
        {data.collocations === undefined ? (
          <SectionSkeleton />
        ) : data.collocations.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {data.collocations.map((c, i) => (
              <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
            ))}
          </div>
        ) : null}
      </section>

      {/* Derivatives — slice 2 */}
      {(data.derivatives === undefined || (data.derivatives?.length ?? 0) > 0) && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("modal.derivatives")}
          </h3>
          {data.derivatives === undefined ? (
            <SectionSkeleton />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.derivatives.map((d, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {d.word}{" "}
                  <span className="text-muted-foreground ml-1">{d.wordType}</span>
                </Badge>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Sentence Patterns — slice 3 */}
      {(data.sentencePatterns === undefined || (data.sentencePatterns?.length ?? 0) > 0) && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("modal.patterns")}
          </h3>
          {data.sentencePatterns === undefined ? (
            <SectionSkeleton />
          ) : (
            data.sentencePatterns.map((p, i) => (
              <div key={i} className="p-2 rounded bg-muted/30 mb-1.5">
                <span className="text-sm font-medium">{p.pattern}</span>
                <p className="text-xs text-muted-foreground">{p.explanation}</p>
                {p.example && (
                  <p className="text-xs mt-0.5 italic flex items-start gap-1">
                    <span>{p.example}</span>
                    <SpeakButton text={p.example} className="w-3 h-3 mt-0.5" />
                  </p>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {/* Idioms — slice 3 */}
      {(data.idioms === undefined || (data.idioms?.length ?? 0) > 0) && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("modal.idioms")}
          </h3>
          {data.idioms === undefined ? (
            <SectionSkeleton />
          ) : (
            data.idioms.map((idiom, i) => (
              <div key={i} className="p-2 rounded bg-muted/30 mb-1.5">
                <span className="text-sm font-medium inline-flex items-center gap-1">
                  {idiom.idiom}
                  <SpeakButton text={idiom.idiom} className="w-3 h-3" />
                </span>
                <p className="text-xs text-muted-foreground">{idiom.explanation}</p>
              </div>
            ))
          )}
        </section>
      )}

      {/* Mnemonic — slice 3 */}
      {(data.mnemonic === undefined || data.mnemonic) && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("modal.mnemonic")}
          </h3>
          {data.mnemonic === undefined ? (
            <SectionSkeleton />
          ) : (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
              <p className="text-sm">{data.mnemonic}</p>
            </div>
          )}
        </section>
      )}

      {/* Etymology — slice 4 */}
      {(data.etymology === undefined || (data.etymology?.parts?.length ?? 0) > 0) && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("modal.etymology")}
          </h3>
          {data.etymology === undefined ? (
            <SectionSkeleton />
          ) : (
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="flex gap-2 mb-2">
                {data.etymology.parts.map((p, i) => (
                  <div key={i} className="text-center">
                    <Badge variant="outline" className="text-xs font-mono">{p.seg}</Badge>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{p.meaning}</p>
                  </div>
                ))}
              </div>
              {data.etymology.story && (
                <p className="text-xs text-muted-foreground">{data.etymology.story}</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Example Sentences — slice 4 */}
      {(data && (data.sentences !== undefined || data.authorityQuotes !== undefined)) && (
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("modal.quotes")}
          </h3>
          {data.sentences === undefined && data.authorityQuotes === undefined ? (
            <SectionSkeleton />
          ) : ((data.sentences ?? data.authorityQuotes) as any[])?.length > 0 ? (
            ((data.sentences ?? data.authorityQuotes) as any[]).map((q: any, i: number) => (
              <div key={i} className="p-2 rounded bg-muted/20 mb-1.5">
                <p className="text-xs italic flex items-start gap-1">
                  <span>"{q.text}"</span>
                  <SpeakButton text={q.text} className="w-3 h-3 mt-0.5" />
                </p>
                {q.source && <p className="text-[10px] text-muted-foreground mt-0.5">— {q.source}</p>}
                {!q.source && q.label && <p className="text-[10px] text-muted-foreground mt-0.5">— {q.label}</p>}
              </div>
            ))
          ) : null}
        </section>
      )}

      {/* No data hint — only shown when all slices done and nothing loaded */}
      {!loading && !data.definitions?.length && !data.synonyms?.length && !data.mnemonic && (
        <div className="text-center py-4 text-sm text-muted-foreground">
          {t("modal.noData")}
        </div>
      )}
    </div>
  );
}

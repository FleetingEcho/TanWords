import React, { useEffect, useMemo, useState } from "react";
import { useDB, PatternListItem, PatternDetail, PatternTag } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { useReadingStore } from "@/store/readingStore";
import { PATTERN_TAGS } from "@/providers/patternAnalysis";
import { PatternDetailPanel, PatternSlots, TagChip } from "./PatternDetailPanel";

export function PatternsPage() {
  const db = useDB();
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);
  const { pendingPatternId, clearPendingPatternId } = useReadingStore();

  const [patterns, setPatterns] = useState<PatternListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState<PatternTag | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PatternDetail | null>(null);

  const load = async () => {
    const list = await db.getPatterns();
    setPatterns(list);
    setLoading(false);
    return list;
  };

  useEffect(() => {
    load().then((list) => {
      if (list.length > 0) setSelectedId((prev) => prev ?? list[0].id);
    });
    const handler = () => load();
    window.addEventListener("patterns-updated", handler);
    return () => window.removeEventListener("patterns-updated", handler);
  }, []);

  // Consume cross-page pending pattern id (from re-encounter "查看句式")
  useEffect(() => {
    if (pendingPatternId !== null) {
      setSelectedId(pendingPatternId);
      clearPendingPatternId();
    }
  }, [pendingPatternId, clearPendingPatternId]);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    db.getPatternDetail(selectedId).then(setDetail);
  }, [selectedId]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return patterns.filter(
      (p) =>
        (tagFilter === "all" || p.function_tag === tagFilter) &&
        (!q || p.pattern.toLowerCase().includes(q) || p.zh.toLowerCase().includes(q))
    );
  }, [patterns, tagFilter, search]);

  // Tags that actually have entries — no point rendering chips for empty groups
  const usedTags = useMemo(
    () => PATTERN_TAGS.filter((tag) => patterns.some((p) => p.function_tag === tag)),
    [patterns]
  );

  const refreshDetail = () => {
    load();
    if (selectedId !== null) db.getPatternDetail(selectedId).then(setDetail);
  };

  const handleDeleted = () => {
    setSelectedId(null);
    load().then((list) => {
      if (list.length > 0) setSelectedId(list[0].id);
    });
  };

  // ── Empty state: invite to collect from reading ─────────────────────────
  if (!loading && patterns.length === 0) {
    return (
      <div className="p-6 animate-fade-in max-w-5xl">
        <h1 className="text-2xl font-bold">{t("patterns.title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("patterns.subtitle")}</p>
        <div className="mt-6 bg-card border border-border rounded-2xl py-16 flex flex-col items-center gap-4 text-center">
          <p className="text-2xl leading-none">
            <PatternSlots text="not so much X as Y" className="text-lg font-bold" />
          </p>
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed px-6">
            {t("patterns.empty.body")}
          </p>
          <button
            onClick={() => navigate("reading")}
            className="h-9 px-5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("patterns.empty.cta")} →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 animate-fade-in max-w-6xl h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold">{t("patterns.title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("patterns.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px,1fr] gap-4 items-start flex-1 min-h-0">
        {/* Master: search + tag chips + list */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden lg:sticky lg:top-6 flex flex-col lg:max-h-[calc(100vh-10rem)]">
          <div className="p-3 space-y-2.5 border-b border-border">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("patterns.search")}
              className="w-full h-9 px-3 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
            />
            {usedTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {(["all", ...usedTags] as const).map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(tag as PatternTag | "all")}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                      tagFilter === tag
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/50"
                        : "border-border text-muted-foreground hover:border-amber-500/30"
                    }`}
                  >
                    {tag === "all" ? t("patterns.all") : t(`patterns.tag.${tag}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="divide-y divide-border overflow-y-auto">
            {visible.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  selectedId === p.id ? "bg-amber-500/[0.07]" : "hover:bg-muted/40"
                }`}
              >
                <p className="text-sm font-semibold leading-relaxed line-clamp-2">
                  <PatternSlots text={p.pattern} />
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <TagChip tag={p.function_tag} />
                  <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">{p.zh}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                    {t("patterns.examplesCount", { n: p.example_count })}
                  </span>
                  {p.has_analysis && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" title={t("patterns.analyzed")} />}
                </div>
              </button>
            ))}
            {visible.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t("patterns.noMatch")}</p>
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="min-w-0">
          {detail ? (
            <PatternDetailPanel detail={detail} onChanged={refreshDetail} onDeleted={handleDeleted} />
          ) : (
            <div className="bg-card border border-border rounded-2xl py-20 text-center text-xs text-muted-foreground">
              {t("patterns.notFound")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

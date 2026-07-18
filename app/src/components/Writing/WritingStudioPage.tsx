import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/AiChat/Markdown";
import { WritingAnalyzer } from "./WritingAnalyzer";
import { SummaryExportModal } from "./SummaryExportModal";
import { generateWritingSummary } from "@/features/writing/ai";
import type { WritingSubmission, WritingSummary } from "@/features/writing/types";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Trash2 } from "lucide-react";

type Tab = "compose" | "records" | "summaries";
type PendingDelete =
  | { kind: "records" | "sources"; recordIds: number[]; sentenceIds: number[] }
  | { kind: "summaries"; summaryIds: number[] };

const TABS: Array<{ id: Tab; labelKey: string }> = [
  { id: "compose", labelKey: "writing.compose" },
  { id: "records", labelKey: "writing.records" },
  { id: "summaries", labelKey: "writing.summaries" },
];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function WritingStudioPage() {
  const t = useT();
  const uiLanguage = useSettingsStore((state) => state.uiLanguage);
  const [tab, setTab] = useState<Tab>("compose");
  const [records, setRecords] = useState<WritingSubmission[]>([]);
  const [summaries, setSummaries] = useState<WritingSummary[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<Set<number>>(new Set());
  const [selectedSentences, setSelectedSentences] = useState<Set<number>>(new Set());
  const [selectedSummaries, setSelectedSummaries] = useState<Set<number>>(new Set());
  const [activeRecordId, setActiveRecordId] = useState<number | null>(null);
  const [activeSummaryId, setActiveSummaryId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportSummary, setExportSummary] = useState<WritingSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextRecords, nextSummaries] = await Promise.all([
        invoke<WritingSubmission[]>("db_list_writing_submissions", { search: search || null }),
        invoke<WritingSummary[]>("db_list_writing_summaries"),
      ]);
      setRecords(nextRecords);
      setSummaries(nextSummaries);
      setActiveRecordId((current) => nextRecords.some((item) => item.id === current) ? current : nextRecords[0]?.id ?? null);
      setActiveSummaryId((current) => nextSummaries.some((item) => item.id === current) ? current : nextSummaries[0]?.id ?? null);
    } catch (e) { toast.error(String(e)); }
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => load();
    window.addEventListener("writing-updated", refresh);
    return () => window.removeEventListener("writing-updated", refresh);
  }, [load]);

  const activeRecord = records.find((item) => item.id === activeRecordId) ?? null;
  const activeSummary = summaries.find((item) => item.id === activeSummaryId) ?? null;
  const snapshotRecords = useMemo(() => records.filter((item) => selectedRecords.has(item.id)), [records, selectedRecords]);
  const snapshotSummaries = useMemo(() => summaries.filter((item) => selectedSummaries.has(item.id)), [summaries, selectedSummaries]);

  const summarize = async (kind: "submissions" | "summaries") => {
    const selectedSentenceItems = records.flatMap((record) => record.sentences
      .filter((sentence) => sentence.id && selectedSentences.has(sentence.id))
      .map((sentence) => ({ submissionId: record.id, ...sentence })));
    const effectiveKind = kind === "submissions" && selectedSentenceItems.length ? "sentences" : kind;
    const sourceItems = kind === "summaries" ? snapshotSummaries : selectedSentenceItems.length ? selectedSentenceItems : snapshotRecords;
    if (!sourceItems.length) return;
    const snapshot = JSON.stringify(sourceItems);
    abortRef.current?.abort(); abortRef.current = new AbortController(); setBusy(true);
    try {
      const content = await generateWritingSummary(snapshot, uiLanguage === "en" ? "en" : "zh", abortRef.current.signal);
      const title = t("writing.summaryTitle", { date: new Date().toLocaleDateString() });
      await invoke("db_save_writing_summary", { title, content, sourceType: effectiveKind, sourceSnapshot: snapshot });
      toast.success(t("writing.summarySaved"));
      if (kind === "submissions") {
        setPendingDelete({
          kind: "sources",
          recordIds: selectedSentenceItems.length ? [] : [...selectedRecords],
          sentenceIds: selectedSentenceItems.length ? [...selectedSentences] : [],
        });
      }
      setSelectedRecords(new Set()); setSelectedSentences(new Set()); setSelectedSummaries(new Set());
      await load(); setTab("summaries");
    } catch (e) { if (!abortRef.current.signal.aborted) toast.error(String(e)); }
    finally { setBusy(false); }
  };

  const removeRecords = () => {
    const ids = [...selectedRecords]; const sentenceIds = [...selectedSentences];
    if (!ids.length && !sentenceIds.length) return;
    setPendingDelete({ kind: "records", recordIds: ids, sentenceIds });
  };

  const removeSummaries = () => {
    const ids = [...selectedSummaries];
    if (!ids.length) return;
    setPendingDelete({ kind: "summaries", summaryIds: ids });
  };

  const confirmDelete = async () => {
    const pending = pendingDelete;
    if (!pending) return;
    setPendingDelete(null);
    try {
      if (pending.kind === "summaries") {
        await invoke("db_delete_writing_summaries", { ids: pending.summaryIds });
        setSelectedSummaries(new Set());
      } else {
        if (pending.recordIds.length) await invoke("db_delete_writing_submissions", { ids: pending.recordIds });
        if (pending.sentenceIds.length) await invoke("db_delete_writing_sentences", { ids: pending.sentenceIds });
        setSelectedRecords(new Set()); setSelectedSentences(new Set());
      }
      await load();
    } catch (error) { toast.error(String(error)); }
  };

  const deleteTitle = pendingDelete?.kind === "summaries" ? t("writing.deleteSummariesTitle")
    : pendingDelete?.kind === "sources" ? t("writing.deleteSourceTitle") : t("writing.deleteRecordsTitle");
  const deleteMessage = pendingDelete?.kind === "summaries"
    ? t("writing.deleteSummariesConfirm", { count: pendingDelete.summaryIds.length })
    : pendingDelete ? t(pendingDelete.kind === "sources" ? "writing.deleteSourceConfirm" : "writing.deleteRecordsConfirm", { records: pendingDelete.recordIds.length, sentences: pendingDelete.sentenceIds.length }) : "";

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="shrink-0 border-b border-border/70 px-5 py-4 md:px-8">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="mr-auto">
          <div className="flex items-center gap-3"><h1 className="text-xl font-bold tracking-tight">{t("writing.title")}</h1><span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><i className="h-1.5 w-1.5 rounded-full bg-emerald-500"/>{t("writing.aiReady")}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{t("writing.subtitle")}</p>
        </div>
        <nav className="flex rounded-xl bg-muted/70 p-1">
          {TABS.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${tab === item.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t(item.labelKey)}</button>)}
        </nav>
      </div>
    </header>

    <main className="min-h-0 flex-1">
      {tab === "compose" && <WritingAnalyzer onSaved={load} />}
      {tab === "records" && <RecordsView
        records={records} active={activeRecord} search={search} busy={busy}
        selectedRecords={selectedRecords} selectedSentences={selectedSentences}
        onSearch={setSearch} onActive={setActiveRecordId} onSelectedRecords={setSelectedRecords} onSelectedSentences={setSelectedSentences}
        onSummarize={() => summarize("submissions")} onDelete={removeRecords}
      />}
      {tab === "summaries" && <SummariesView
        summaries={summaries} active={activeSummary} busy={busy} selected={selectedSummaries}
        onActive={setActiveSummaryId} onSelected={setSelectedSummaries}
        onSummarize={() => summarize("summaries")} onDelete={removeSummaries} onExport={setExportSummary}
      />}
    </main>
    {exportSummary && <SummaryExportModal summary={exportSummary} onClose={() => setExportSummary(null)} />}
    <ConfirmModal open={pendingDelete !== null} title={deleteTitle} message={deleteMessage} confirmLabel={t("writing.delete")} onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()} />
  </div>;
}

function RecordsView(props: {
  records: WritingSubmission[]; active: WritingSubmission | null; search: string; busy: boolean;
  selectedRecords: Set<number>; selectedSentences: Set<number>;
  onSearch: (value: string) => void; onActive: (id: number) => void;
  onSelectedRecords: React.Dispatch<React.SetStateAction<Set<number>>>;
  onSelectedSentences: React.Dispatch<React.SetStateAction<Set<number>>>;
  onSummarize: () => void; onDelete: () => void;
}) {
  const t = useT();
  const count = props.selectedRecords.size + props.selectedSentences.size;
  return <div className="grid h-full min-h-0 grid-rows-[240px_minmax(0,1fr)] md:grid-cols-[300px_minmax(0,1fr)] md:grid-rows-1">
    <aside className="flex min-h-0 flex-col border-b border-border/70 bg-muted/15 md:border-b-0 md:border-r">
      <div className="space-y-3 border-b border-border/60 p-4">
        <input value={props.search} onChange={(e) => props.onSearch(e.target.value)} placeholder={t("writing.search")} className="h-9 w-full rounded-lg bg-background px-3 text-xs outline-none ring-1 ring-border/70 focus:ring-primary/50" />
        <div className="flex items-center gap-1.5"><Button disabled={!count || props.busy} onClick={props.onSummarize} className="h-8 flex-1 text-[11px]">{props.busy ? t("writing.summarizing") : t("writing.summarizeSelected", { count: count || "" })}</Button><Button variant="ghost" size="icon" disabled={!count} onClick={props.onDelete} title={t("writing.delete")} aria-label={t("writing.delete")} className="h-8 w-8 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button></div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {!props.records.length && <EmptyList text={t("writing.noRecords")} />}
        {props.records.map((record) => <button key={record.id} onClick={() => props.onActive(record.id)} className={`mb-1 w-full rounded-xl p-3 text-left transition ${props.active?.id === record.id ? "bg-background shadow-sm ring-1 ring-border/60" : "hover:bg-muted/70"}`}>
          <div className="flex items-center gap-2"><input type="checkbox" checked={props.selectedRecords.has(record.id)} onClick={(e) => e.stopPropagation()} onChange={() => props.onSelectedRecords((old) => toggleSet(old, record.id))}/><time className="ml-auto text-[9px] text-muted-foreground">{formatDate(record.created_at)}</time></div>
          <p className="mt-2 line-clamp-2 text-xs font-medium leading-5">{record.original_text}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("writing.items", { count: record.sentences.length })} · {record.detected_genre || t("writing.general")}</p>
        </button>)}
      </div>
    </aside>
    <section className="min-h-0 overflow-y-auto">
      {!props.active ? <EmptyDetail title={t("writing.selectRecord")} text={t("writing.selectRecordHint")} /> : <div className="mx-auto max-w-4xl px-6 py-8 lg:px-10">
        <div className="flex items-start gap-4"><div className="flex-1"><div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><span>{props.active.detected_genre || t("writing.general")}</span><span>·</span><time>{formatDate(props.active.created_at)}</time></div><h2 className="mt-3 text-xl font-semibold leading-8">{props.active.original_text}</h2></div></div>
        {props.active.overall_feedback && <div className="mt-7 rounded-2xl bg-muted/50 p-5"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("writing.overview")}</p><p className="mt-2 text-sm leading-7">{props.active.overall_feedback}</p></div>}
        {props.active.refined_full_text && <div className="mt-7"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("writing.refined")}</p><p className="mt-3 whitespace-pre-wrap rounded-2xl bg-primary/[0.04] p-5 text-sm leading-7 ring-1 ring-primary/15">{props.active.refined_full_text}</p></div>}
        <div className="mt-8 space-y-5">{props.active.sentences.map((sentence, index) => <div key={sentence.id} className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border/60">
          <div className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={!!sentence.id && props.selectedSentences.has(sentence.id)} onChange={() => sentence.id && props.onSelectedSentences((old) => toggleSet(old, sentence.id!))}/><div><span className="text-[10px] font-bold text-muted-foreground">{t("writing.candidates")} {index + 1}</span><p className="mt-1 text-sm font-medium leading-6">{sentence.original}</p></div></div>
          <div className="ml-6 mt-4 grid gap-3 lg:grid-cols-2"><CompareBlock label={t("writing.original")} text={sentence.original}/><CompareBlock label={t("writing.refinedSnippet")} text={sentence.natural}/></div>
          <div className="ml-6 mt-4 border-l-2 border-border pl-4"><p className="text-[10px] font-bold uppercase text-muted-foreground">{t("writing.explanation")}</p><p className="mt-1 text-xs leading-5 text-foreground/75 whitespace-pre-wrap">{sentence.explanation}</p></div>
          {sentence.vocabulary.length > 0 && <div className="ml-6 mt-5 grid gap-2 sm:grid-cols-2">{sentence.vocabulary.map((word) => <div key={word.id} className="rounded-xl bg-muted/45 p-3"><div className="flex items-baseline gap-2"><b className="text-sm">{word.suggested_word ?? word.word}</b><span className="text-[11px] text-muted-foreground">{word.meaning}</span>{word.selected && <span className="ml-auto text-[9px] font-bold text-primary">{t("writing.vocabAdded")}</span>}</div><p className="mt-2 text-xs italic leading-5">{word.example_sentence ?? word.exampleSentence}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{word.reason}</p></div>)}</div>}
        </div>)}</div>
      </div>}
    </section>
  </div>;
}

function SummariesView(props: {
  summaries: WritingSummary[]; active: WritingSummary | null; busy: boolean; selected: Set<number>;
  onActive: (id: number) => void; onSelected: React.Dispatch<React.SetStateAction<Set<number>>>;
  onSummarize: () => void; onDelete: () => void; onExport: (summary: WritingSummary) => void;
}) {
  const t = useT();
  return <div className="grid h-full min-h-0 grid-rows-[240px_minmax(0,1fr)] md:grid-cols-[300px_minmax(0,1fr)] md:grid-rows-1">
    <aside className="flex min-h-0 flex-col border-b border-border/70 bg-muted/15 md:border-b-0 md:border-r">
      <div className="border-b border-border/60 p-4"><div className="flex gap-1.5"><Button disabled={!props.selected.size || props.busy} onClick={props.onSummarize} className="h-8 flex-1 text-[11px]">{props.busy ? t("writing.merging") : t("writing.mergeSelected", { count: props.selected.size || "" })}</Button><Button variant="ghost" size="icon" disabled={!props.selected.size} onClick={props.onDelete} title={t("writing.delete")} aria-label={t("writing.delete")} className="h-8 w-8 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button></div></div>
      <div className="flex-1 overflow-y-auto p-2">
        {!props.summaries.length && <EmptyList text={t("writing.noSummaries")} />}
        {props.summaries.map((summary) => <button key={summary.id} onClick={() => props.onActive(summary.id)} className={`mb-1 w-full rounded-xl p-3 text-left transition ${props.active?.id === summary.id ? "bg-background shadow-sm ring-1 ring-border/60" : "hover:bg-muted/70"}`}><div className="flex items-center gap-2"><input type="checkbox" checked={props.selected.has(summary.id)} onClick={(e) => e.stopPropagation()} onChange={() => props.onSelected((old) => toggleSet(old, summary.id))}/><time className="text-[9px] uppercase text-muted-foreground">{formatDate(summary.created_at)}</time></div><p className="mt-2 text-xs font-semibold leading-5">{summary.title}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{summary.content.replace(/[#*_>-]/g, "")}</p></button>)}
      </div>
    </aside>
    <section className="min-h-0 overflow-y-auto">
      {!props.active ? <EmptyDetail title={t("writing.selectSummary")} text={t("writing.selectSummaryHint")} /> : <article className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
        <header className="border-b border-border/70 pb-6"><div className="flex flex-wrap items-start gap-4"><div className="flex-1"><time className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{formatDate(props.active.created_at)}</time><h2 className="mt-2 text-2xl font-bold tracking-tight">{props.active.title}</h2></div><Button onClick={() => props.onExport(props.active!)} className="h-9 px-4 text-xs font-semibold">{t("writing.exportDocument")}</Button></div></header>
        <div className="py-7 text-[15px] leading-7"><Markdown text={props.active.content}/></div>
      </article>}
    </section>
  </div>;
}

function CompareBlock({ label, text }: { label: string; text: string }) {
  return <div className="rounded-xl bg-muted/45 p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1.5 text-xs leading-5">{text}</p></div>;
}

function EmptyList({ text }: { text: string }) {
  return <p className="px-3 py-12 text-center text-xs text-muted-foreground">{text}</p>;
}

function EmptyDetail({ title, text }: { title: string; text: string }) {
  return <div className="flex h-full min-h-80 flex-col items-center justify-center text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-lg text-muted-foreground">Aa</div><p className="text-sm font-semibold">{title}</p><p className="mt-2 text-xs text-muted-foreground">{text}</p></div>;
}

function toggleSet<T>(source: Set<T>, value: T) {
  const next = new Set(source);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

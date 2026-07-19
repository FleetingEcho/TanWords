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
import { ArrowLeft, Trash2, X } from "lucide-react";

type Tab = "compose" | "library";
type PendingDelete =
  | { kind: "records" | "sources"; recordIds: number[]; sentenceIds: number[] }
  | { kind: "summaries"; summaryIds: number[] };

const TABS: Array<{ id: Tab; labelKey: string }> = [
  { id: "compose", labelKey: "writing.compose" },
  { id: "library", labelKey: "writing.library" },
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
      setActiveRecordId((current) => nextRecords.some((item) => item.id === current) ? current : null);
      setActiveSummaryId((current) => nextSummaries.some((item) => item.id === current) ? current : null);
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
      await load();
      setActiveRecordId(null); setActiveSummaryId(null); setTab("library");
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
    <header className="shrink-0 border-b border-border/70 px-6 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-1 pt-5">
        <div className="pb-4">
          <div className="flex items-baseline gap-3">
            <h1 className="font-manuscript text-[22px] font-semibold tracking-tight">{t("writing.title")}</h1>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><i className="h-1.5 w-1.5 rounded-full bg-emerald-500"/>{t("writing.aiReady")}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("writing.subtitle")}</p>
        </div>
        <nav className="flex gap-7">
          {TABS.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`border-b-2 pb-3.5 pt-1 text-xs font-semibold tracking-wide transition ${tab === item.id ? "border-ink text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t(item.labelKey)}</button>)}
        </nav>
      </div>
    </header>

    <main className="min-h-0 flex-1">
      {tab === "compose" && <WritingAnalyzer onSaved={load} />}
      {tab === "library" && <LibraryView
        records={records} summaries={summaries} activeRecord={activeRecord} activeSummary={activeSummary}
        search={search} busy={busy}
        selectedRecords={selectedRecords} selectedSentences={selectedSentences} selectedSummaries={selectedSummaries}
        onSearch={setSearch} onActiveRecord={setActiveRecordId} onActiveSummary={setActiveSummaryId}
        onSelectedRecords={setSelectedRecords} onSelectedSentences={setSelectedSentences} onSelectedSummaries={setSelectedSummaries}
        onSummarize={() => summarize("submissions")} onMerge={() => summarize("summaries")}
        onDeleteRecords={removeRecords} onDeleteSummaries={removeSummaries} onExport={setExportSummary}
      />}
    </main>
    {exportSummary && <SummaryExportModal summary={exportSummary} onClose={() => setExportSummary(null)} />}
    <ConfirmModal open={pendingDelete !== null} title={deleteTitle} message={deleteMessage} confirmLabel={t("writing.delete")} onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()} />
  </div>;
}

function LibraryView(props: {
  records: WritingSubmission[]; summaries: WritingSummary[];
  activeRecord: WritingSubmission | null; activeSummary: WritingSummary | null;
  search: string; busy: boolean;
  selectedRecords: Set<number>; selectedSentences: Set<number>; selectedSummaries: Set<number>;
  onSearch: (value: string) => void;
  onActiveRecord: (id: number | null) => void; onActiveSummary: (id: number | null) => void;
  onSelectedRecords: React.Dispatch<React.SetStateAction<Set<number>>>;
  onSelectedSentences: React.Dispatch<React.SetStateAction<Set<number>>>;
  onSelectedSummaries: React.Dispatch<React.SetStateAction<Set<number>>>;
  onSummarize: () => void; onMerge: () => void;
  onDeleteRecords: () => void; onDeleteSummaries: () => void;
  onExport: (summary: WritingSummary) => void;
}) {
  const t = useT();
  const recordCount = props.selectedRecords.size + props.selectedSentences.size;
  const summaryCount = props.selectedSummaries.size;
  const clearRecordSelection = () => { props.onSelectedRecords(new Set()); props.onSelectedSentences(new Set()); };
  const clearSummarySelection = () => props.onSelectedSummaries(new Set());
  // Record and summary selections drive different actions, so they are mutually exclusive.
  const toggleRecord = (id: number) => { props.onSelectedRecords((old) => toggleSet(old, id)); clearSummarySelection(); };
  const toggleSentence = (id: number) => { props.onSelectedSentences((old) => toggleSet(old, id)); clearSummarySelection(); };
  const toggleSummary = (id: number) => { props.onSelectedSummaries((old) => toggleSet(old, id)); clearRecordSelection(); };

  return <div className="relative h-full min-h-0">
    <div className="h-full overflow-y-auto">
      {props.activeRecord ? <RecordDetail
        record={props.activeRecord} onBack={() => props.onActiveRecord(null)}
        selectedSentences={props.selectedSentences} onToggleSentence={toggleSentence}
      /> : props.activeSummary ? <SummaryDetail
        summary={props.activeSummary} onBack={() => props.onActiveSummary(null)} onExport={props.onExport}
      /> : <div className="mx-auto max-w-6xl px-6 py-7 pb-24 md:px-10">
        {props.summaries.length > 0 && <section className="mb-10">
          <SectionLabel text={t("writing.summaries")} />
          <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {props.summaries.map((summary) => <SummaryVolumeCard
              key={summary.id} summary={summary}
              selected={props.selectedSummaries.has(summary.id)}
              onOpen={() => props.onActiveSummary(summary.id)}
              onToggle={() => toggleSummary(summary.id)}
            />)}
          </div>
        </section>}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <SectionLabel text={t("writing.records")} />
            <input value={props.search} onChange={(e) => props.onSearch(e.target.value)} placeholder={t("writing.search")} className="h-9 w-full max-w-56 rounded-full bg-muted/60 px-4 text-xs outline-none ring-1 ring-transparent transition focus:bg-background focus:ring-ink/40" />
          </div>
          {!props.records.length && <EmptyWall text={t("writing.noRecords")} />}
          <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(236px,1fr))]">
            {props.records.map((record) => <PaperCard
              key={record.id}
              eyebrow={record.detected_genre || t("writing.general")}
              excerpt={record.original_text ?? ""}
              meta={t("writing.items", { count: record.sentences.length })}
              date={formatDate(record.created_at)}
              selected={props.selectedRecords.has(record.id)}
              onOpen={() => props.onActiveRecord(record.id)}
              onToggle={() => toggleRecord(record.id)}
            />)}
          </div>
        </section>
      </div>}
    </div>
    {summaryCount > 0 ? <SelectionBar
      label={props.busy ? t("writing.merging") : t("writing.mergeSelected", { count: summaryCount })}
      busy={props.busy} onAction={props.onMerge} onDelete={props.onDeleteSummaries} onClear={clearSummarySelection}
    /> : recordCount > 0 ? <SelectionBar
      label={props.busy ? t("writing.summarizing") : t("writing.summarizeSelected", { count: recordCount })}
      busy={props.busy} onAction={props.onSummarize} onDelete={props.onDeleteRecords} onClear={clearRecordSelection}
    /> : null}
  </div>;
}

function RecordDetail(props: {
  record: WritingSubmission; onBack: () => void;
  selectedSentences: Set<number>; onToggleSentence: (id: number) => void;
}) {
  const t = useT();
  const record = props.record;
  return <div className="mx-auto max-w-3xl animate-fade-in px-6 py-7 pb-28 md:px-10">
    <BackButton label={t("writing.library")} onClick={props.onBack} />
    <div className="mt-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
      <span className="font-bold text-ink">{record.detected_genre || t("writing.general")}</span>
      <span className="text-muted-foreground">·</span>
      <time className="font-mono text-muted-foreground">{formatDate(record.created_at)}</time>
    </div>
    <h2 className="mt-3 font-manuscript text-[21px] leading-9">{record.original_text}</h2>
    {record.overall_feedback && <section className="mt-9">
      <SectionLabel text={t("writing.overview")} />
      <p className="mt-3 text-sm leading-7 text-foreground/85">{record.overall_feedback}</p>
    </section>}
    {record.refined_full_text && <section className="mt-9">
      <SectionLabel text={t("writing.refined")} />
      <p className="mt-3 whitespace-pre-wrap rounded-xl bg-card p-5 font-manuscript text-[15px] leading-8 shadow-sm ring-1 ring-border/60">{record.refined_full_text}</p>
    </section>}
    {record.sentences.length > 0 && <section className="mt-10">
      <SectionLabel text={t("writing.candidates")} />
      <div className="mt-5 space-y-8">
        {record.sentences.map((sentence) => <div key={sentence.id} className="border-l-2 border-ink/40 pl-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1.5 accent-[hsl(var(--ink))]" checked={!!sentence.id && props.selectedSentences.has(sentence.id)} onChange={() => sentence.id && props.onToggleSentence(sentence.id)} />
            <p className="font-manuscript text-[15px] leading-7 text-muted-foreground line-through decoration-ink/60">{sentence.original}</p>
          </label>
          <p className="ml-7 mt-1.5 font-manuscript text-[15px] leading-7">{sentence.natural}</p>
          {sentence.explanation && <p className="ml-7 mt-2.5 whitespace-pre-wrap text-xs leading-6 text-muted-foreground"><span className="mr-1.5 font-bold text-ink">※</span>{sentence.explanation}</p>}
          {sentence.vocabulary.length > 0 && <div className="ml-7 mt-4 grid gap-2.5 sm:grid-cols-2">
            {sentence.vocabulary.map((word) => <div key={word.id} className="rounded-lg bg-muted/40 p-3">
              <div className="flex items-baseline gap-2">
                <b className="font-manuscript text-sm">{word.suggested_word ?? word.word}</b>
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">{word.meaning}</span>
                {word.selected && <span className="ml-auto shrink-0 text-[9px] font-bold text-ink">{t("writing.vocabAdded")}</span>}
              </div>
              <p className="mt-1.5 font-manuscript text-xs italic leading-5">{word.example_sentence ?? word.exampleSentence}</p>
              {word.reason && <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{word.reason}</p>}
            </div>)}
          </div>}
        </div>)}
      </div>
    </section>}
  </div>;
}

function SummaryDetail(props: { summary: WritingSummary; onBack: () => void; onExport: (summary: WritingSummary) => void }) {
  const t = useT();
  return <article className="mx-auto max-w-3xl animate-fade-in px-6 py-7 pb-28 md:px-10">
    <div className="flex items-center justify-between gap-4">
      <BackButton label={t("writing.library")} onClick={props.onBack} />
      <Button onClick={() => props.onExport(props.summary)} className="h-8 rounded-full px-4 text-[11px] font-semibold">{t("writing.exportDocument")}</Button>
    </div>
    <time className="mt-7 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink">{formatDate(props.summary.created_at)}</time>
    <h2 className="mt-2 font-manuscript text-2xl font-semibold tracking-tight">{props.summary.title}</h2>
    <div className="mt-6 border-t border-border/70 pt-6 text-[15px] leading-7"><Markdown text={props.summary.content} /></div>
  </article>;
}

function SummaryVolumeCard(props: { summary: WritingSummary; selected: boolean; onOpen: () => void; onToggle: () => void }) {
  const summary = props.summary;
  return <div role="button" tabIndex={0} onClick={props.onOpen}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(); } }}
    className={`group relative flex min-h-28 cursor-pointer flex-col rounded-lg border-l-[3px] border-ink bg-card p-4 pl-5 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none ${props.selected ? "ring-2 ring-ink/60" : "ring-border/60"}`}>
    <p className="mr-7 line-clamp-2 font-manuscript text-[13px] font-semibold leading-5">{summary.title}</p>
    <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{summary.content.replace(/[#*_>`-]/g, "")}</p>
    <div className="mt-auto flex justify-end pt-3">
      <time className="shrink-0 rounded-[3px] border border-ink/45 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink">{formatDate(summary.created_at)}</time>
    </div>
    <input type="checkbox" checked={props.selected} onClick={(e) => e.stopPropagation()} onChange={props.onToggle}
      aria-label={summary.title}
      className={`absolute right-3 top-3 accent-[hsl(var(--ink))] transition ${props.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} />
  </div>;
}

function PaperCard(props: {
  eyebrow: string; excerpt: string; meta?: string; date: string; selected: boolean;
  onOpen: () => void; onToggle: () => void;
}) {
  return <div role="button" tabIndex={0} onClick={props.onOpen}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(); } }}
    className={`group relative flex min-h-44 cursor-pointer flex-col rounded-xl bg-card p-4 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none ${props.selected ? "ring-2 ring-ink/60" : "ring-border/60"}`}>
    <p className="mr-7 truncate text-[9px] font-bold uppercase tracking-[0.14em] text-ink">{props.eyebrow}</p>
    <p className="mt-2.5 line-clamp-4 font-manuscript text-[13px] leading-6 text-foreground/90">{props.excerpt}</p>
    <div className="mt-auto flex items-end justify-between gap-2 pt-4">
      <span className="text-[10px] text-muted-foreground">{props.meta}</span>
      <time className="shrink-0 rounded-[3px] border border-ink/45 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink">{props.date}</time>
    </div>
    <input type="checkbox" checked={props.selected} onClick={(e) => e.stopPropagation()} onChange={props.onToggle}
      aria-label={props.eyebrow}
      className={`absolute right-3 top-3 accent-[hsl(var(--ink))] transition ${props.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} />
  </div>;
}

function SelectionBar(props: { label: string; busy: boolean; onAction: () => void; onDelete: () => void; onClear: () => void }) {
  const t = useT();
  return <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
    <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-card py-1.5 pl-1.5 pr-2 shadow-lg ring-1 ring-border/70 animate-fade-in">
      <Button disabled={props.busy} onClick={props.onAction} className="h-8 rounded-full px-4 text-[11px] font-semibold">{props.label}</Button>
      <Button variant="ghost" size="icon" onClick={props.onDelete} title={t("writing.delete")} aria-label={t("writing.delete")} className="h-8 w-8 rounded-full text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
      <button onClick={props.onClear} title={t("writing.cancel")} aria-label={t("writing.cancel")} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
    </div>
  </div>;
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground">
    <ArrowLeft className="h-3.5 w-3.5" />{label}
  </button>;
}

function SectionLabel({ text }: { text: string }) {
  return <p className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink"><span className="h-px w-5 bg-ink/60" />{text}</p>;
}

function EmptyWall({ text }: { text: string }) {
  return <div className="flex min-h-72 flex-col items-center justify-center text-center">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[4px] border border-ink/50 font-manuscript text-lg italic text-ink">Aa</div>
    <p className="text-xs text-muted-foreground">{text}</p>
  </div>;
}

function toggleSet<T>(source: Set<T>, value: T) {
  const next = new Set(source);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

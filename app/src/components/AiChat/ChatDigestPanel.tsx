import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { jsonrepair } from "jsonrepair";
import { toast } from "sonner";
import { BookOpen, Check, CheckCheck, ChevronDown, Download, FileText, LoaderCircle, Plus, RefreshCw, RotateCcw, Search, Settings2, Sparkles, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDB, type WordListItem } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { blocksToStorage, markdownToBlocks } from "@/lib/docFormat";
import { exportMarkdownFiles } from "@/lib/localDocs";
import type { AIProvider } from "@/providers/base";
import type { AiMessage } from "./MessageBubble";

const DigestMarkdownEditor = React.lazy(() => import("./DigestMarkdownEditor").then((module) => ({ default: module.DigestMarkdownEditor })));

export interface DigestVocabulary {
  word: string;
  zh: string;
  level?: string;
  context?: string;
  reason?: string;
}

export interface ChatDigest {
  title: string;
  summary: string;
  refinedSentences: Array<{ original: string; refined: string; explanation: string }>;
  vocabulary: DigestVocabulary[];
  markdown: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  messages: AiMessage[];
  provider?: AIProvider;
  sessionTitle: string;
}

function cleanDigest(raw: string): ChatDigest {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0) throw new Error("AI did not return a structured learning note");
  const data = JSON.parse(jsonrepair(raw.slice(start, end >= start ? end + 1 : undefined)));
  return {
    title: String(data.title || "Conversation learning note"),
    summary: String(data.summary || ""),
    refinedSentences: Array.isArray(data.refinedSentences) ? data.refinedSentences : [],
    vocabulary: Array.isArray(data.vocabulary) ? data.vocabulary : [],
    markdown: String(data.markdown || data.summary || ""),
  };
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "Conversation learning note";
}

const DEFAULT_DIGEST_PROMPT = `Create a practical learning note from this conversation.
- Summarize the important ideas and conclusions, not every message.
- Refine the user's English sentences and explain the most valuable changes.
- Select only reusable, high-quality vocabulary, phrases, and collocations.
- Include concise next steps for continued practice.
- Keep the final document polished and useful for later review.`;

export function ChatDigestPanel({ open, onClose, messages, provider, sessionTitle }: Props) {
  const t = useT();
  const db = useDB();
  const uiLanguage = useSettingsStore((s) => s.uiLanguage);
  const [digest, setDigest] = useState<ChatDigest | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState<"document" | "file" | "vocab" | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [digestPrompt, setDigestPrompt] = useState(() => localStorage.getItem("aichat-digest-prompt") || DEFAULT_DIGEST_PROMPT);
  const [vocabSearch, setVocabSearch] = useState("");
  const [vocabResults, setVocabResults] = useState<WordListItem[]>([]);
  const [vocabSearching, setVocabSearching] = useState(false);
  const [addingSearchWord, setAddingSearchWord] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem("aichat-digest-modal-width"));
    return Number.isFinite(saved) && saved >= 640 ? saved : 920;
  });

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (next: PointerEvent) => {
      const max = Math.max(640, Math.min(1200, window.innerWidth * 0.94));
      setPanelWidth(Math.max(640, Math.min(max, startWidth + (startX - next.clientX) * 2)));
    };
    const stop = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setPanelWidth((width) => {
        localStorage.setItem("aichat-digest-modal-width", String(Math.round(width)));
        return width;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const transcript = useMemo(() => messages
    .filter((message) => message.content.trim())
    .map((message) => `${message.role === "user" ? "User" : "AI"}: ${message.content}`)
    .join("\n\n"), [messages]);

  useEffect(() => {
    const query = vocabSearch.trim();
    if (!query) { setVocabResults([]); setVocabSearching(false); return; }
    setVocabSearching(true);
    const timer = window.setTimeout(async () => {
      setVocabResults((await db.getWords({ search: query })).slice(0, 5));
      setVocabSearching(false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [vocabSearch, db]);

  const generate = async () => {
    if (!provider || !transcript) return;
    setGenerating(true);
    try {
      const language = uiLanguage === "en" ? "English" : "Simplified Chinese";
      const system = `You turn an English-learning conversation into a structured learning note. Return ONLY valid JSON with this exact shape: {"title":"","summary":"","refinedSentences":[{"original":"","refined":"","explanation":""}],"vocabulary":[{"word":"","zh":"","level":"B2","context":"","reason":""}],"markdown":""}. The explanation, summary and zh fields must use ${language}. Refined sentences must come from the user's English, not the assistant's. markdown must be a polished standalone document.\n\nUser's note instructions:\n${digestPrompt.trim()}`;
      const prompt = `Conversation title: ${sessionTitle || "Untitled"}\n\n${transcript}`;
      let raw = "";
      for await (const chunk of provider.generate(system, prompt)) raw += chunk;
      const next = cleanDigest(raw);
      setDigest(next);
      setSelected(new Set(next.vocabulary.map((_, index) => index)));
    } catch (error) {
      toast.error(t("aichat.digestFailed", { error: String(error) }));
    } finally {
      setGenerating(false);
    }
  };

  const addVocabulary = async () => {
    if (!digest || selected.size === 0) return;
    setSaving("vocab");
    try {
      const words = digest.vocabulary.filter((_, index) => selected.has(index));
      const result = await db.addWordsBatch(words, "ai-chat-digest", "ai-chat");
      window.dispatchEvent(new CustomEvent("vocab-updated"));
      toast.success(t("aichat.digestVocabSaved", { added: result.added, skipped: result.skipped }));
      setSelected(new Set());
    } finally { setSaving(null); }
  };

  const addSearchedWord = async () => {
    const word = vocabSearch.trim();
    if (!word || addingSearchWord) return;
    setAddingSearchWord(true);
    try {
      const result = await db.addWord(word, "");
      if (result.isNew) {
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(t("aichat.digestSearchAdded", { word }));
        setVocabSearch("");
      } else toast.info(t("aichat.digestSearchExists", { word }));
    } finally { setAddingSearchWord(false); }
  };

  const updatePrompt = (value: string) => {
    setDigestPrompt(value);
    localStorage.setItem("aichat-digest-prompt", value);
  };

  const markdown = digest ? `# ${digest.title}\n\n${digest.markdown.trim()}\n` : "";

  const saveDocument = async () => {
    if (!digest) return;
    setSaving("document");
    try {
      const storage = blocksToStorage(await markdownToBlocks(markdown));
      await invoke("db_create_document_with_content", { title: digest.title, content: storage.content, contentText: storage.contentText, tags: JSON.stringify(["ai-chat-summary"]), wordCount: storage.wordCount });
      toast.success(t("aichat.digestDocumentSaved"));
    } catch (error) { toast.error(String(error)); }
    finally { setSaving(null); }
  };

  const exportFile = async () => {
    if (!digest) return;
    const folder = await openDialog({ directory: true, multiple: false, title: t("aichat.digestChooseFolder") });
    if (typeof folder !== "string") return;
    setSaving("file");
    try {
      await exportMarkdownFiles(folder, [{ name: `${safeFileName(digest.title)}.md`, content: markdown }]);
      toast.success(t("aichat.digestExported"));
    } catch (error) { toast.error(String(error)); }
    finally { setSaving(null); }
  };

  if (!open) return null;
  return createPortal(<div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/50 p-5 backdrop-blur-[2px] animate-in fade-in duration-200" onMouseDown={(event) => { if (event.target === event.currentTarget && !generating && !saving) onClose(); }}>
  <aside role="dialog" aria-modal="true" aria-labelledby="conversation-note-title" style={{ width: Math.min(panelWidth, window.innerWidth - 40) }} className="relative flex h-[min(880px,calc(100vh-40px))] min-w-0 flex-col overflow-hidden rounded-[26px] border border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-200">
    <div role="separator" aria-orientation="vertical" aria-label={t("aichat.digestResize")} title={t("aichat.digestResize")} onPointerDown={startResize} className="group absolute inset-y-0 left-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none"><span className="absolute inset-y-0 left-1/2 w-px bg-transparent transition-colors group-hover:bg-primary/50 group-active:bg-primary" /></div>
    <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/[0.08] to-transparent pointer-events-none" />
    <header className="relative flex h-16 shrink-0 items-center gap-3 border-b border-border/60 px-5">
      <div className="grid h-9 w-9 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15"><WandSparkles className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1"><h2 id="conversation-note-title" className="text-sm font-semibold tracking-tight">{t("aichat.digestTitle")}</h2><p className="text-[11px] text-muted-foreground">{t("aichat.digestSubtitle")}</p></div>
      <Button variant="ghost" onClick={onClose} className="h-8 w-8 rounded-full p-0"><X className="h-4 w-4" /></Button>
    </header>

    {!digest ? <div className="relative flex-1 overflow-y-auto px-6 py-7">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
      <div className="relative mb-5 grid h-16 w-16 place-items-center rounded-[24px] bg-gradient-to-br from-primary/20 via-primary/10 to-transparent ring-1 ring-primary/15"><Sparkles className="h-7 w-7 text-primary" /><span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-amber-400 ring-4 ring-background" /></div>
      <h3 className="font-manuscript text-xl font-semibold">{t("aichat.digestEmptyTitle")}</h3>
      <p className="mt-2 max-w-xs text-xs leading-6 text-muted-foreground">{t("aichat.digestEmptyHint", { count: messages.length })}</p>
      <div className="mt-6 w-full overflow-hidden rounded-2xl border border-border/70 bg-background/55 text-left">
        <button onClick={() => setPromptOpen((value) => !value)} className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold"><Settings2 className="h-3.5 w-3.5 text-primary" /><span className="flex-1">{t("aichat.digestPrompt")}</span><ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${promptOpen ? "rotate-180" : ""}`} /></button>
        {promptOpen && <div className="border-t border-border/60 p-3"><textarea value={digestPrompt} onChange={(event) => updatePrompt(event.target.value)} rows={8} className="w-full resize-y rounded-xl border border-border/60 bg-card/70 px-3 py-2.5 font-mono text-[11px] leading-5 outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/[0.06]" /><div className="mt-2 flex items-center justify-between"><p className="text-[9px] text-muted-foreground">{t("aichat.digestPromptSaved")}</p><Button variant="ghost" onClick={() => updatePrompt(DEFAULT_DIGEST_PROMPT)} className="h-7 gap-1 px-2 text-[10px] text-muted-foreground"><RotateCcw className="h-3 w-3" />{t("aichat.digestPromptReset")}</Button></div></div>}
      </div>
      <Button onClick={generate} disabled={generating || !provider || messages.length < 2 || !digestPrompt.trim()} className="mt-5 h-10 rounded-full px-6 shadow-lg shadow-primary/20">
        {generating ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />{t("aichat.digestGenerating")}</> : <><WandSparkles className="mr-2 h-4 w-4" />{t("aichat.digestGenerate")}</>}
      </Button>
      </div>
    </div> : <>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Learning note</span><h3 className="mt-1 font-manuscript text-xl font-semibold leading-7">{digest.title}</h3></div><Button variant="ghost" onClick={generate} disabled={generating} className="h-8 w-8 shrink-0 rounded-full p-0" title={t("aichat.digestRegenerate")}><RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} /></Button></div>
        <section className="mt-6 rounded-2xl border border-border/60 bg-background/60 p-4"><p className="text-xs leading-6 text-foreground/80">{digest.summary}</p></section>
        {digest.refinedSentences.length > 0 && <section className="mt-7"><SectionTitle icon={<Sparkles className="h-3.5 w-3.5" />} text={t("aichat.digestRefinements")} count={digest.refinedSentences.length} /><div className="mt-3 space-y-3">{digest.refinedSentences.map((item, index) => <div key={index} className="rounded-2xl border border-border/60 bg-background/50 p-4"><p className="text-xs text-muted-foreground line-through decoration-primary/40">{item.original}</p><p className="mt-2 font-manuscript text-sm leading-6">{item.refined}</p>{item.explanation && <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{item.explanation}</p>}</div>)}</div></section>}
        <section className="mt-7"><div className="flex items-center gap-2"><SectionTitle icon={<BookOpen className="h-3.5 w-3.5" />} text={t("aichat.digestVocabulary")} count={digest.vocabulary.length} />{digest.vocabulary.length > 0 && <div className="ml-auto flex items-center gap-1"><Button variant="ghost" onClick={() => setSelected(new Set(digest.vocabulary.map((_, index) => index)))} disabled={selected.size === digest.vocabulary.length} className="h-7 gap-1 rounded-lg px-2 text-[10px] text-muted-foreground"><CheckCheck className="h-3 w-3" />{t("aichat.digestSelectAll")}</Button><Button variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0} className="h-7 gap-1 rounded-lg px-2 text-[10px] text-muted-foreground"><X className="h-3 w-3" />{t("aichat.digestUnselectAll")}</Button></div>}</div><VocabularySearch query={vocabSearch} onQuery={setVocabSearch} results={vocabResults} searching={vocabSearching} adding={addingSearchWord} onAdd={addSearchedWord} t={t} />{digest.vocabulary.length > 0 && <div className="mt-3 space-y-2">{digest.vocabulary.map((item, index) => { const checked = selected.has(index); return <button key={index} onClick={() => setSelected((old) => { const next = new Set(old); next.has(index) ? next.delete(index) : next.add(index); return next; })} className={`w-full rounded-2xl border p-3.5 text-left transition ${checked ? "border-primary/30 bg-primary/[0.06]" : "border-border/60 bg-background/40 hover:border-primary/20"}`}><div className="flex items-center gap-2"><span className={`grid h-4 w-4 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{checked && <Check className="h-3 w-3" />}</span><b className="text-sm">{item.word}</b>{item.level && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{item.level}</span>}<span className="ml-auto text-[11px] text-muted-foreground">{item.zh}</span></div>{item.context && <p className="ml-6 mt-2 text-[11px] italic leading-5 text-muted-foreground">“{item.context}”</p>}{item.reason && <p className="ml-6 mt-1 text-[10px] leading-4 text-muted-foreground/75">{item.reason}</p>}</button>; })}</div>}</section>
        <section className="mt-7 pb-3"><SectionTitle icon={<FileText className="h-3.5 w-3.5" />} text={t("aichat.digestPreview")} /><div className="mt-3"><React.Suspense fallback={<div className="grid h-48 place-items-center rounded-2xl border border-border/60"><LoaderCircle className="h-5 w-5 animate-spin text-primary" /></div>}><DigestMarkdownEditor value={digest.markdown} onChange={(markdown) => setDigest((current) => current ? { ...current, markdown } : current)} /></React.Suspense></div></section>
      </div>
      <footer className="shrink-0 border-t border-border/60 bg-background/80 p-4 backdrop-blur-xl">
        {selected.size > 0 && <Button onClick={addVocabulary} disabled={saving !== null} variant="outline" className="mb-2 h-9 w-full rounded-xl border-primary/25 bg-primary/[0.04] text-xs text-primary hover:bg-primary/[0.09]"><BookOpen className="mr-2 h-3.5 w-3.5" />{t("aichat.digestAddVocab", { count: selected.size })}</Button>}
        <div className="grid grid-cols-2 gap-2"><Button onClick={saveDocument} disabled={saving !== null} className="h-9 rounded-xl text-xs"><FileText className="mr-2 h-3.5 w-3.5" />{t("aichat.digestSaveDocument")}</Button><Button onClick={exportFile} disabled={saving !== null} variant="outline" className="h-9 rounded-xl text-xs"><Download className="mr-2 h-3.5 w-3.5" />{t("aichat.digestExport")}</Button></div>
      </footer>
    </>}
  </aside></div>, document.body);
}

function SectionTitle({ icon, text, count }: { icon: React.ReactNode; text: string; count?: number }) {
  return <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground"><span className="text-primary">{icon}</span><span>{text}</span>{count !== undefined && <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] tracking-normal">{count}</span>}</div>;
}

function VocabularySearch({ query, onQuery, results, searching, adding, onAdd, t }: {
  query: string;
  onQuery: (value: string) => void;
  results: WordListItem[];
  searching: boolean;
  adding: boolean;
  onAdd: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const normalized = query.trim().toLowerCase();
  const exactMatch = results.some((item) => item.word.toLowerCase() === normalized);
  return <div className="relative mt-3">
    <Search className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
    <input value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && normalized && !exactMatch && !searching) void onAdd(); }} placeholder={t("aichat.digestSearchVocabulary")} className="h-9 w-full rounded-xl border border-border/70 bg-background/60 pl-9 pr-3 text-xs outline-none transition placeholder:text-muted-foreground/50 focus:border-primary/30 focus:ring-2 focus:ring-primary/[0.06]" />
    {normalized && <div className="absolute left-0 right-0 top-11 z-20 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      {searching ? <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground"><LoaderCircle className="h-3 w-3 animate-spin" />{t("aichat.digestSearching")}</div> : <>
        {results.map((item) => <div key={item.id} className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5 last:border-0"><b className="text-xs">{item.word}</b><span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{item.zh}</span><Check className="h-3.5 w-3.5 text-emerald-500" /><span className="text-[9px] text-muted-foreground">{t("aichat.digestInVocabulary")}</span></div>)}
        {!exactMatch && <button onClick={onAdd} disabled={adding} className="flex w-full items-center gap-2 border-t border-border/50 px-3 py-2.5 text-left text-xs font-medium text-primary hover:bg-primary/[0.06] disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{t("aichat.digestAddSearchWord", { word: query.trim() })}</button>}
      </>}
    </div>}
  </div>;
}

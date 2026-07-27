import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, ClipboardPaste, FileUp, MessageSquareText, Rss } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import type { ReadingArticleItem } from "@/hooks/useDB.reading";
import { Button } from "@/components/ui/button";
import { cleanPastedText, isReadableText, isSupportedTextFile, textFromFile } from "@/lib/pastedText";

/** Reading pace used for the estimate, in words per minute. */
const WPM = 220;

const RECENT_COUNT = 5;

const SOURCE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  paste: ClipboardPaste,
  mcp: Bot,
  reader: Rss,
};

/**
 * The empty state of the paste-in reader.
 *
 * It deliberately isn't a form. The box you type into is set at the reader's
 * own measure, size and leading, with the same hairline rule the reader uses
 * for quoted text — so the text lands looking like the article it's about to
 * become, and there's no visual seam between pasting and reading. No border,
 * no filled input: chrome here would announce "field to fill in" when the
 * thing on screen is a page.
 */
export function ScratchPasteScreen({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The title is the learner's to write; the suggestion is only a start. */
  onSubmit: (title: string) => void;
}) {
  const t = useT();
  const db = useDB();
  const [recent, setRecent] = useState<ReadingArticleItem[]>([]);
  const [total, setTotal] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  // Once you type a title of your own, pasting more text must not overwrite it.
  const [titleEdited, setTitleEdited] = useState(false);

  // The recent strip is an entry point, not a browser: five rows and a way
  // through to the library, which is where searching and filtering live.
  useEffect(() => {
    const load = () => {
      void db.listReadingArticles({ limit: RECENT_COUNT }).then((result) => {
        setRecent(result.items);
        setTotal(result.total);
      });
    };
    load();
    window.addEventListener("articles-updated", load);
    return () => window.removeEventListener("articles-updated", load);
  }, [db]);

  /** First line if it reads like a headline, else the opening words. Only a
   *  suggestion — it fills the field, which you can then rewrite. */
  const suggestTitle = (text: string) => {
    const first = text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
    if (!first) return "";
    if (first.length <= 120) return first;
    return first.slice(0, 60).replace(/\s+\S*$/, "") + "…";
  };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const minutes = Math.max(1, Math.round(words / WPM));

  /** Cleans on the way in rather than on submit, so what you see in the box is
   *  exactly what the reader will show — PDF line wraps, hyphenation and page
   *  numbers included (or rather, excluded). */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const plain = e.clipboardData.getData("text/plain");
    // A copied image or file puts no text on the clipboard at all.
    if (!plain.trim()) {
      e.preventDefault();
      setError(t("scratch.errorNoText"));
      return;
    }
    e.preventDefault();
    setError(null);
    const cleaned = cleanPastedText(plain);
    // insertText keeps the native undo stack intact, unlike setting value.
    const el = textareaRef.current;
    if (el && document.execCommand("insertText", false, cleaned)) {
      // execCommand fires onChange, which is what refreshes the suggestion.
      return;
    }
    setBody(value.slice(0, el?.selectionStart ?? value.length) + cleaned + value.slice(el?.selectionEnd ?? value.length));
  };

  const setBody = (text: string) => {
    onChange(text);
    if (!titleEdited) setTitle(suggestTitle(text));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedTextFile(file.name)) {
      setError(t("scratch.errorFileType"));
      return;
    }
    const text = await textFromFile(file);
    if (!isReadableText(text)) {
      setError(t("scratch.errorNotReadable"));
      return;
    }
    setError(null);
    setBody(text);
    if (!titleEdited) setTitle(suggestTitle(text) || file.name.replace(/\.[^.]+$/, ""));
  };

  const submit = () => {
    if (!isReadableText(value)) {
      setError(t("scratch.errorNotReadable"));
      return;
    }
    setError(null);
    onSubmit(title.trim() || suggestTitle(value));
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[68ch] flex-col px-6 py-12">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
            {t("scratch.open")}
          </span>
          <span className="h-px flex-1 bg-border/70" />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileUp className="h-3.5 w-3.5" />
            {t("scratch.openFile")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.text,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("scratch.prompt")}</p>

        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); textareaRef.current?.focus(); } }}
          placeholder={t("scratch.titlePlaceholder")}
          className="mt-8 w-full bg-transparent text-xl font-semibold tracking-tight text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/35"
        />

        <div className="group relative mt-4 flex-1 border-l-2 border-border/70 pl-6 transition-colors focus-within:border-primary/50">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => { setBody(e.target.value); if (error) setError(null); }}
            onPaste={handlePaste}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder={t("scratch.placeholder")}
            autoFocus
            spellCheck={false}
            style={{ fontSize: 17.5, lineHeight: 1.85 }}
            className="h-full min-h-[46vh] w-full resize-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground/35"
          />
        </div>

        <div className="mt-6 flex items-center gap-4 border-t border-border/60 pt-4">
          <p className={`text-xs tabular-nums ${error ? "text-destructive" : "text-muted-foreground"}`}>
            {error ?? (words > 0 ? t("scratch.count", { words: words.toLocaleString(), minutes }) : t("scratch.hint"))}
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:block">
              ⌘↵
            </kbd>
            <Button
              onClick={submit}
              disabled={!value.trim()}
              className="h-9 rounded-lg px-4 text-sm font-semibold disabled:opacity-30"
            >
              {t("scratch.submit")}
            </Button>
          </div>
        </div>

        {!value.trim() && recent.length > 0 && (
          <div className="mt-10">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                {t("library.recent")}
              </span>
              <span className="h-px flex-1 bg-border/70" />
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("tanwords:show-library"))}
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
              >
                {t("library.viewAll", { n: total })}
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="mt-2">
              {recent.map((item) => {
                const SourceIcon = SOURCE_ICONS[item.source] ?? ClipboardPaste;
                return (
                  <button
                    key={item.id}
                    onClick={() => window.dispatchEvent(new CustomEvent("tanwords:open-article", { detail: { id: item.id } }))}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <SourceIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{item.title || t("library.untitled")}</span>
                    {item.comment_count > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-primary">
                        <MessageSquareText className="h-2.5 w-2.5" />
                        {item.comment_count}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">{item.last_read_at.slice(5, 10)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

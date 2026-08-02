import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookmarkPlus, BookPlus, Check, Search, X } from "lucide-react";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { INLINE_ASK_SYSTEM_PROMPT, buildInlineAskUserPrompt } from "@/providers/base";
import { fetchSentencePattern } from "@/lib/patternFromSentence";
import { fetchBasicInfo, BasicInfo } from "@/lib/basicInfo";
import { parseEnrichmentStream } from "@/lib/enrichMeta";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { hostCapabilities } from "@/platform";
import { Markdown } from "@/components/AiChat/Markdown";
import { Button } from "@/components/ui/button";
import { AskMode, AskTarget, cleanWord, isWordish } from "./selectionAskHelpers";

/** Streams an answer about the selection.
 *
 *  Two layouts, same logic. `floating` pins a card under the selection, for
 *  text selected inside the app. `inline` fills whatever container it's given
 *  and is used by the Browser page's side pane: a selection there lives in a
 *  native child webview, which is composited above all of our HTML, so a
 *  floating card over the page would simply be invisible — the answer has to
 *  sit *beside* the page instead. That also means no click-away-to-close,
 *  since clicking the page is how you keep reading. */
export function InlineAskPanel({ anchor, mode: initialMode, onClose, layout = "floating" }: {
  anchor: AskTarget;
  mode: AskMode;
  onClose: () => void;
  layout?: "floating" | "inline";
}) {
  const inline = layout === "inline";
  const t = useT();
  const db = useDB();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  const [mode, setMode] = useState<AskMode>(initialMode);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [basicInfo, setBasicInfo] = useState<BasicInfo>({});
  const [collected, setCollected] = useState(false);
  const [adding, setAdding] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);

  // Clicking away closes it. Scrolling no longer does — the card follows the
  // text now — so this is what's left to dismiss it besides Esc and the ×.
  useEffect(() => {
    if (inline) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose, inline]);

  const word = cleanWord(anchor.text);
  const wordish = isWordish(anchor.text);

  // A word gets its dictionary fields fetched alongside the explanation, so
  // "add to vocabulary" is one click with a real gloss/level behind it rather
  // than a bare headword — and so an already-collected word can say so
  // instead of offering to add it twice.
  useEffect(() => {
    if (!wordish || !word) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const rows = await db.getWords({ search: word });
      if (cancelled) return;
      if (rows.some((w) => w.word.toLowerCase() === word.toLowerCase())) { setCollected(true); return; }
      const provider = findBestProvider();
      if (!provider) return;
      const info = await fetchBasicInfo(provider, word, targetLevel, controller.signal);
      if (!cancelled) setBasicInfo(info);
    })();
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToVocab = async () => {
    if (adding || collected) return;
    setAdding(true);
    try {
      // A full breakdown is already on screen — save it with the word rather
      // than making the vocabulary page generate the same thing again.
      const result = mode === "deep" && text
        ? await db.addWordEnriched(word, basicInfo.zh || word, basicInfo.wordType || null, { text, zhShort: basicInfo.zh, level: basicInfo.level })
        : await db.addWord(word, basicInfo.zh ?? "", basicInfo.wordType, basicInfo.level);
      if (result.id > 0) {
        setCollected(true);
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(t("sel.added", { word }));
      }
    } finally {
      setAdding(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setText("");
    setDone(false);
    setError(null);
    (async () => {
      // A word already in the vocabulary carries its breakdown with it —
      // render that instead of paying for the same explanation again.
      if (mode === "deep") {
        const detail = await db.getWordDetailByWord(word);
        if (controller.signal.aborted) return;
        if (detail?.enrichment_text) {
          setText(detail.enrichment_text);
          setDone(true);
          return;
        }
      }
      const provider = findBestProvider();
      if (!provider) { setError(t("modal.noProvider")); setDone(true); return; }
      let raw = "";
      try {
        if (mode === "deep") {
          // provider.enrich carries the user's own enrichment prompt from
          // Settings, so this reads exactly like the vocabulary page's.
          for await (const chunk of provider.enrich(word, controller.signal)) {
            if (controller.signal.aborted) return;
            raw += chunk;
            setText(parseEnrichmentStream(raw).text);
          }
          return;
        }
        // Translation goes through the provider's own translate() — the same
        // path the article translation pane uses — so a plain "what does this
        // say" answer doesn't inherit the tutor prompt's commentary.
        const stream = mode === "translate"
          ? provider.translate({ text: anchor.text, targetLang: "Chinese", mode: "translate" })
          : provider.generate(
              INLINE_ASK_SYSTEM_PROMPT,
              buildInlineAskUserPrompt(anchor.text, anchor.context, targetLevel),
              controller.signal
            );
        for await (const chunk of stream) {
          if (controller.signal.aborted) return;
          raw += chunk;
          setText(raw);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(t("sel.explainFailed"));
      } finally {
        if (!controller.signal.aborted) setDone(true);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Opens downward from the selection, flipping above it when the answer
  // would run off the bottom of the window. Both edges are clamped: the card
  // tracks the text while you scroll, and without this it would ride off the
  // top or bottom of the window with it.
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  const openUp = (anchor.bottom ?? 0) > window.innerHeight - 320;
  const left = clamp(anchor.left ?? 0, 220, Math.max(220, window.innerWidth - 220));
  const style: React.CSSProperties | undefined = inline
    ? undefined
    : openUp
      ? { bottom: clamp(window.innerHeight - (anchor.top ?? 0) + 8, 8, window.innerHeight - 120), left }
      : { top: clamp((anchor.bottom ?? 0) + 8, 8, window.innerHeight - 120), left };

  return (
    <div
      ref={panelRef}
      data-no-selection
      className={inline ? "flex h-full min-h-0 flex-col" : "fixed z-50 w-[min(420px,90vw)] -translate-x-1/2"}
      style={style}
    >
      <div className={inline
        ? "flex h-full min-h-0 flex-col overflow-hidden bg-background"
        : "overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl ring-1 ring-black/5"}>
        <div className="flex items-start gap-2 border-b border-border bg-muted/60 px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">{anchor.text}</p>
          {hostCapabilities.nativeTts && <SpeakButton text={anchor.text} className="w-3 h-3 mt-0.5" />}
          <Button variant="ghost" onClick={onClose} className="h-4 w-4 shrink-0 p-0 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </Button>
        </div>

        <div className={`${inline ? "min-h-0 flex-1" : mode === "deep" ? "max-h-[58vh]" : "max-h-[42vh]"} overflow-y-auto px-3 py-2.5 text-xs leading-relaxed [&_blockquote]:my-1 [&_blockquote]:text-[11px]`}>
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : text ? (
            <Markdown text={text} />
          ) : (
            <p className="animate-pulse text-muted-foreground">{t(mode === "translate" ? "sel.translating" : "sel.explaining")}</p>
          )}
        </div>

        {done && !error && (
          <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
            {wordish ? (
              <>
                {collected ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    {t("sel.inVocab")}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => void addToVocab()}
                    disabled={adding}
                    className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-primary"
                  >
                    <BookPlus className="h-3 w-3" />
                    {adding ? t("sel.adding") : t("sel.addWord")}
                  </Button>
                )}
                {mode !== "deep" && (
                  <Button
                    variant="ghost"
                    onClick={() => setMode("deep")}
                    className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium text-muted-foreground"
                  >
                    <Search className="h-3 w-3" />
                    {t("sel.lookup")}
                  </Button>
                )}
              </>
            ) : (
              <SavePatternButton sentence={anchor.text} source={anchor.source} db={db} onSaved={onClose} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SavePatternButton({
  sentence, source, db, onSaved,
}: {
  sentence: string;
  source: string;
  db: ReturnType<typeof useDB>;
  onSaved: () => void;
}) {
  const t = useT();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  const [saving, setSaving] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        try {
          const provider = findBestProvider();
          const info = provider ? await fetchSentencePattern(provider, sentence, targetLevel) : null;
          const saved = await db.saveSentencePattern(
            sentence, info?.zh ?? "", info?.skeleton ?? "", info?.note ?? "", info?.level ?? "", source
          );
          if (saved) {
            toast.success(saved.created ? t("sel.saved") : t("sel.alreadySaved"));
            onSaved();
          }
        } finally {
          setSaving(false);
        }
      }}
      className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium text-primary"
    >
      <BookmarkPlus className="h-3 w-3" />
      {saving ? t("sel.saving") : t("sel.savePattern")}
    </Button>
  );
}

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { BookmarkPlus, BookPlus, Check, Languages, MessageSquareQuote, Search, X } from "lucide-react";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { INLINE_ASK_SYSTEM_PROMPT, buildInlineAskUserPrompt } from "@/providers/base";
import { fetchSentencePattern } from "@/lib/patternFromSentence";
import { fetchBasicInfo, BasicInfo } from "@/lib/basicInfo";
import { parseEnrichmentStream } from "@/lib/enrichMeta";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { Markdown } from "@/components/AiChat/Markdown";
import { Button } from "@/components/ui/button";
import {
  findSelectionOverlayHost,
  positionSelectionToolbar,
} from "./selectionToolbarPosition";

/** Marks the AI replies in the chat transcript as selectable targets — your
 *  own messages, and the Chinese glosses in cards, have nothing to offer. */
export const AI_MESSAGE_ATTR = "data-ai-message";

/** Longer than this and it isn't a word or a sentence any more — probably a
 *  drag-select of half the page, where none of these actions make sense. */
const MAX_SELECTION = 320;
/** How much surrounding text goes to the model as context. */
const CONTEXT_CHARS = 700;

interface Anchor {
  text: string;
  /** Viewport rect of the selection, for placing the toolbar and the panel.
   *  Recomputed from `range` while scrolling so both track the text. */
  top: number;
  bottom: number;
  left: number;
  /** Text around the selection, for disambiguating what it means *here*. */
  context: string;
  /** Attribution recorded on anything saved from this selection. */
  source: string;
  /** True when the selection sits in an AI chat reply, where "ask" should go
   *  to the composer instead of a card. */
  inChat: boolean;
  /** Live range over the selected text. Its rect follows the document as it
   *  scrolls, which is what lets the card stay pinned to the sentence it's
   *  explaining instead of being dismissed the moment the page moves. */
  range: Range;
}

function renderSelectionOverlay(anchor: Anchor, content: React.ReactNode) {
  const host = findSelectionOverlayHost(anchor.range);
  return host ? createPortal(content, host) : content;
}

/** Recomputes an anchor's viewport position from its range. Returns null once
 *  the text has scrolled out of view. */
function reposition(anchor: Anchor): Anchor | null {
  const r = anchor.range.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // range detached or collapsed
  return { ...anchor, top: r.top, bottom: r.bottom, left: r.left + r.width / 2 };
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** A selection carries whatever punctuation the drag caught — strip it before
 *  the text is used as a vocabulary entry or a lookup key. */
function cleanWord(text: string) {
  return text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
}

function isWordish(text: string) {
  return wordCount(text) <= 3 && !/[.!?]$/.test(text);
}

/** Selecting inside these is never a lookup — it's editing, or picking text
 *  out of the answer panel itself. */
const IGNORED = 'input, textarea, [contenteditable=""], [contenteditable="true"], [data-no-selection]';

/** Where the selection came from, recorded on anything saved from it. */
function sourceFor(el: Element | null | undefined): string {
  if (el?.closest(`[${AI_MESSAGE_ATTR}]`)) return "chat";
  if (el?.closest("[data-reader-selectable]")) return "reader";
  return "app";
}

/**
 * Floating toolbar over any selected English text, anywhere in the app —
 * mounted once, globally. English shows up all over TanWords (AI notes, the
 * translation pane, vocabulary cards, documents, chat), and a lookup
 * affordance that only existed on two of those surfaces meant the answer to
 * "what does this mean" depended on which screen you happened to be on.
 *
 * Rather than opting each surface in, it works everywhere except where a
 * selection means something else (form fields, its own panel) and only for
 * text that actually contains English words.
 *
 * "Ask" has two shapes. Normally the answer streams into a panel right under
 * the selection, so you keep your place. Inside an AI chat reply it instead
 * goes to the composer (via the `tanwords:ask-selection` event the chat page
 * listens for) — there's a conversation there, and the follow-up belongs in
 * the transcript rather than in a card that closes.
 */
export function SelectionAsk() {
  const t = useT();
  const db = useDB();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  const enabled = useSettingsStore((s) => s.selectionActions);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [asking, setAsking] = useState<{ anchor: Anchor; mode: AskMode } | null>(null);
  const [saving, setSaving] = useState(false);
  // Whether the selected word is already collected, so the toolbar can say so
  // instead of offering to add it again. One local SQLite query per selection.
  const [collected, setCollected] = useState(false);
  const [adding, setAdding] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!enabled) return;
    const readSelection = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      // Two letters in a row is the cheapest test for "this is English" —
      // it keeps the toolbar off Chinese UI copy, numbers and punctuation.
      if (!selection || selection.rangeCount === 0 || !text || text.length > MAX_SELECTION || !/[A-Za-z]{2}/.test(text)) {
        setAnchor(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (!el || el.closest(IGNORED)) {
        setAnchor(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const block = el.closest("p, li, blockquote, h1, h2, h3, td") ?? el;
      setAnchor({
        text,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left + rect.width / 2,
        context: (block.textContent ?? "").slice(0, CONTEXT_CHARS),
        range: range.cloneRange(),
        source: sourceFor(el),
        inChat: !!el.closest(`[${AI_MESSAGE_ATTR}]`),
      });
    };

    // Scrolling repositions both instead of closing them. The toolbar hides
    // once its text leaves the viewport (it belongs to that text); the answer
    // card stays — it's something you're reading, and it used to close itself
    // the moment you scrolled its own overflow, since that scroll event
    // reaches this listener too.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setAnchor((prev) => {
          if (!prev) return prev;
          const next = reposition(prev);
          if (!next || next.bottom < 40 || next.top > window.innerHeight - 20) return null;
          return next;
        });
        setAsking((prev) => (prev ? { ...prev, anchor: reposition(prev.anchor) ?? prev.anchor } : prev));
      });
    };

    const onSelectionChange = () => {
      if (!window.getSelection()?.toString().trim()) setAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setAnchor(null); setAsking(null); }
    };

    // Radix dialogs may stop mouse events before they bubble to document.
    // Capture the completed selection before modal event isolation runs.
    document.addEventListener("mouseup", readSelection, true);
    // Capture phase, on window: scroll doesn't bubble, and the element that
    // actually scrolls differs per surface.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKey);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("mouseup", readSelection, true);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [enabled]);

  const selectedWord = anchor && isWordish(anchor.text) ? cleanWord(anchor.text) : "";
  useEffect(() => {
    setCollected(false);
    if (!selectedWord) return;
    let cancelled = false;
    void db.getWords({ search: selectedWord }).then((rows) => {
      if (!cancelled) setCollected(rows.some((w) => w.word.toLowerCase() === selectedWord.toLowerCase()));
    });
    return () => { cancelled = true; };
  }, [selectedWord, db]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!anchor || !toolbar) return;
    const next = { width: toolbar.offsetWidth, height: toolbar.offsetHeight };
    setToolbarSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    );
  }, [anchor, adding, collected, saving]);

  /** Adds the selected word with a real gloss/type/level behind it. The
   *  dictionary call happens on click rather than on every selection — one
   *  API request per word you actually keep, not per word you glance at. */
  const addWord = async () => {
    if (!selectedWord || adding || collected) return;
    setAdding(true);
    try {
      const provider = findBestProvider();
      const info = provider ? await fetchBasicInfo(provider, selectedWord, targetLevel) : {};
      const result = await db.addWord(selectedWord, info.zh ?? "", info.wordType, info.level);
      if (result.id > 0) {
        setCollected(true);
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(t("sel.added", { word: selectedWord }));
      }
    } finally {
      setAdding(false);
    }
  };

  const savePattern = async (sentence: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const provider = findBestProvider();
      // The analysis is a nicety, not a gate: with no provider (or a failed
      // call) the sentence still gets saved, just without a skeleton/note.
      const info = provider ? await fetchSentencePattern(provider, sentence, targetLevel) : null;
      const saved = await db.saveSentencePattern(
        sentence, info?.zh ?? "", info?.skeleton ?? "", info?.note ?? "", info?.level ?? "", anchor?.source ?? "app"
      );
      if (saved) {
        toast.success(saved.created ? t("sel.saved") : t("sel.alreadySaved"));
        setAnchor(null);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) return null;

  const toolbarPosition = anchor && toolbarSize.width > 0
    ? positionSelectionToolbar(anchor, toolbarSize, window.innerWidth)
    : null;

  return (
    <>
      {anchor && renderSelectionOverlay(anchor, (
        <div
          ref={toolbarRef}
          data-no-selection
          className="fixed z-50"
          style={{
            top: toolbarPosition?.top ?? 0,
            left: toolbarPosition?.left ?? 0,
            visibility: toolbarPosition ? "visible" : "hidden",
          }}
          onMouseDown={(e) => e.preventDefault()} // keep the selection alive through the click
        >
          {/* Fully opaque: the reader sits on the user's wallpaper, and a
            * translucent panel over a photo washes the text out. */}
          {/* Same grammar for a word and a sentence, so the buttons don't move
            * around under the cursor between selections:
            *   [ keep it ] [ translate ] [ go deeper ] | [ hear it ]
            * Only what each slot means changes with the selection. */}
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-2xl ring-1 ring-black/5">
            {/* 1 — keep it */}
            {isWordish(anchor.text) ? (
              collected ? (
                <span className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" />
                  {t("sel.inVocab")}
                </span>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => void addWord()}
                  disabled={adding}
                  className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-primary"
                >
                  <BookPlus className="h-3 w-3" />
                  {adding ? t("sel.adding") : t("sel.addWord")}
                </Button>
              )
            ) : (
              <Button
                variant="ghost"
                onClick={() => void savePattern(anchor.text)}
                disabled={saving}
                className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-primary"
              >
                <BookmarkPlus className="h-3 w-3" />
                {saving ? t("sel.saving") : t("sel.savePattern")}
              </Button>
            )}

            {/* 2 — translate. A sentence gets a plain rendering; a word gets
              * its meaning *here*, since a bare gloss out of context is a
              * coin flip ("address" = 地址 or 着手处理?). */}
            <Button
              variant="ghost"
              onClick={() => {
                setAsking({ anchor, mode: isWordish(anchor.text) ? "explain" : "translate" });
                setAnchor(null);
              }}
              className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium"
            >
              <Languages className="h-3 w-3" />
              {t("sel.translate")}
            </Button>

            {/* 3 — go deeper: the full word card, or a follow-up question. */}
            {isWordish(anchor.text) ? (
              <Button
                variant="ghost"
                onClick={() => { setAsking({ anchor, mode: "deep" }); setAnchor(null); }}
                className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium"
              >
                <Search className="h-3 w-3" />
                {t("sel.lookup")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  if (anchor.inChat) {
                    window.dispatchEvent(new CustomEvent("tanwords:ask-selection", { detail: { text: anchor.text } }));
                  } else {
                    setAsking({ anchor, mode: "explain" });
                  }
                  setAnchor(null);
                }}
                className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium"
              >
                <MessageSquareQuote className="h-3 w-3" />
                {t("sel.ask")}
              </Button>
            )}

            {/* 4 — hear it */}
            <span className="mx-0.5 h-4 w-px bg-border/70" />
            <span className="grid h-7 w-7 place-items-center">
              <SpeakButton text={anchor.text} className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      ))}

      {asking && renderSelectionOverlay(asking.anchor, (
        <InlineAskPanel
          anchor={asking.anchor}
          mode={asking.mode}
          onClose={() => setAsking(null)}
        />
      ))}
    </>
  );
}

/** "translate" is a straight rendering into Chinese; "explain" is the tutor
 *  answer (meaning in context, structure, what's worth stealing); "deep" is
 *  the full vocabulary breakdown — the same content the word modal shows,
 *  rendered in this card instead so a lookup while reading doesn't take over
 *  the screen and lose your place. */
type AskMode = "explain" | "translate" | "deep";

/** Streams an answer about the selection into a card pinned under it. */
function InlineAskPanel({ anchor, mode: initialMode, onClose }: { anchor: Anchor; mode: AskMode; onClose: () => void }) {
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
  const abortRef = useRef<AbortController>();
  const panelRef = useRef<HTMLDivElement>(null);

  // Clicking away closes it. Scrolling no longer does — the card follows the
  // text now — so this is what's left to dismiss it besides Esc and the ×.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

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
  const openUp = anchor.bottom > window.innerHeight - 320;
  const left = clamp(anchor.left, 220, Math.max(220, window.innerWidth - 220));
  const style: React.CSSProperties = openUp
    ? { bottom: clamp(window.innerHeight - anchor.top + 8, 8, window.innerHeight - 120), left }
    : { top: clamp(anchor.bottom + 8, 8, window.innerHeight - 120), left };

  return (
    <div ref={panelRef} data-no-selection className="fixed z-50 w-[min(420px,90vw)] -translate-x-1/2" style={style}>
      <div className="overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl ring-1 ring-black/5">
        <div className="flex items-start gap-2 border-b border-border bg-muted/60 px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">{anchor.text}</p>
          <SpeakButton text={anchor.text} className="w-3 h-3 mt-0.5" />
          <Button variant="ghost" onClick={onClose} className="h-4 w-4 shrink-0 p-0 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </Button>
        </div>

        <div className={`${mode === "deep" ? "max-h-[58vh]" : "max-h-[42vh]"} overflow-y-auto px-3 py-2.5 text-xs leading-relaxed [&_blockquote]:my-1 [&_blockquote]:text-[11px]`}>
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

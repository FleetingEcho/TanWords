import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { fetchSentencePattern } from "@/lib/patternFromSentence";
import { fetchBasicInfo } from "@/lib/basicInfo";
import { positionSelectionToolbar } from "./selectionToolbarPosition";
import {
  AI_MESSAGE_ATTR, MAX_SELECTION, CONTEXT_CHARS, IGNORED,
  Anchor, AskMode, cleanWord, isWordish, renderSelectionOverlay, reposition, sourceFor,
} from "./selectionAskHelpers";
import { InlineAskPanel } from "./InlineAskPanel";
import { SelectionToolbarButtons } from "./SelectionToolbarButtons";

export { AI_MESSAGE_ATTR };

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
          <SelectionToolbarButtons
            anchor={anchor}
            collected={collected}
            adding={adding}
            saving={saving}
            addWord={() => void addWord()}
            savePattern={(sentence) => void savePattern(sentence)}
            setAnchor={setAnchor}
            setAsking={setAsking}
          />
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

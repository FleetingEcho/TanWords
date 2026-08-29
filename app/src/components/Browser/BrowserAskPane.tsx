import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, BookPlus, Check, Languages, MessageSquareQuote, PenLine, Search, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { InlineAskPanel } from "@/components/shared/InlineAskPanel";
import { AskMode, AskTarget, canAddAsWord, isWordish, wordCount } from "@/components/shared/selectionAskHelpers";
import { useSelectionActions } from "@/components/shared/useSelectionActions";

const WIDTH_KEY = "tanwords_browser_ask_width";
const MIN_WIDTH = 280;
/** Leave the page itself usable no matter how far the handle is dragged. */
const MIN_PAGE_WIDTH = 320;

function loadWidth(): number {
  const stored = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : 380;
}

/** The Browser page's ask surface, docked beside the embedded page.
 *
 *  It has to be beside it rather than over it: the page is a native child
 *  webview composited above every pixel of this document, so a floating card
 *  would be invisible, and hiding the panel to show one would take away the
 *  very text being asked about.
 *
 *  Text is pasted in rather than read out of the page. The app's own
 *  `SelectionAsk` can't see a selection inside the child webview (separate
 *  document, separate process), and rather than build a bridge for it, this
 *  just takes the text directly — copy from the page, paste here.
 *
 *  Once text is submitted this is the same `InlineAskPanel` the in-app
 *  selection toolbar opens, so translate/explain/look-up, add-to-vocabulary
 *  and save-sentence all behave identically. */
export function BrowserAskPane({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<{ target: AskTarget; mode: AskMode } | null>(null);
  const [width, setWidth] = useState(loadWidth);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const text = draft.trim();
  const wordish = isWordish(text);
  const canWord = canAddAsWord(text);
  const canSentence = wordCount(text) > 1;
  // "browser" attribution, so a sentence kept from a web page is traceable to
  // one later, the way reader/chat saves already are.
  const { collected, adding, saving, addWord, savePattern } = useSelectionActions(text, "browser");

  const ask = (mode: AskMode) => {
    if (!text) return;
    setTarget({
      // No surrounding page text to draw on, and nothing in-app to attribute
      // to — the pasted text has to speak for itself.
      target: { text, context: "", source: t("browser.askPaneTitle") },
      mode,
    });
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MIN_PAGE_WIDTH);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let latest = startWidth;

    // Dragging shrinks the panel's placeholder, and the ResizeObserver in
    // useBrowserPanel repositions the native webview to match — no separate
    // bookkeeping needed here.
    const onMove = (move: PointerEvent) => {
      latest = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth - (move.clientX - startX)));
      setWidth(latest);
    };
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      localStorage.setItem(WIDTH_KEY, String(latest));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    // A cancelled pointer (touch taken over by an OS gesture) never fires
    // pointerup — without this branch the move listener stays attached and
    // merely hovering the separator resizes the pane, and the width is never
    // persisted. The sibling resize handles (FloatingBrowser, ToolsModal)
    // all do this.
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <aside className="relative flex shrink-0 flex-col border-l border-border bg-background" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("browser.askResize")}
        onPointerDown={startDrag}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-primary/30"
      />

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-muted-foreground">
          {t("browser.askPaneTitle")}
        </p>
        {target && (
          <Button
            variant="ghost" onClick={() => setTarget(null)}
            className="h-6 shrink-0 gap-1.5 rounded-lg px-2 text-[11px] font-medium text-muted-foreground"
          >
            <PenLine className="h-3 w-3" />
            {t("browser.askNew")}
          </Button>
        )}
        <Button
          variant="ghost" size="icon" onClick={onClose}
          className="h-5 w-5 shrink-0 text-muted-foreground"
          title={t("common.close")} aria-label={t("common.close")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Input and actions stay pinned while an answer streams underneath —
        * the previous shape swapped them out, which meant re-reading the text
        * you asked about cost you the answer, and asking a second thing about
        * the same passage meant pasting it again. */}
      <div className="shrink-0 space-y-2 p-3">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(wordish ? "explain" : "translate");
          }}
          rows={3}
          placeholder={t("browser.askPlaceholder")}
          // Grows with the text up to a ceiling instead of claiming the whole
          // column: a pane that is 90% empty box reads as "write an essay"
          // when the job is almost always one sentence.
          className="max-h-[30vh] min-h-18 w-full resize-none rounded-lg border border-input bg-background p-2.5 text-xs leading-relaxed outline-hidden transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />

        {/* Same four slots, in the same order, as the floating toolbar
          * (SelectionToolbarButtons): keep it · translate · go deeper · hear
          * it. Only what each slot means changes with word vs sentence, so the
          * two surfaces stay one piece of muscle memory. */}
        <div className="flex flex-wrap items-center gap-1">
          {canWord && (
            collected ? (
              <span className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="h-3 w-3" />
                {t("sel.inVocab")}
              </span>
            ) : (
              <Button
                variant="ghost" onClick={() => void addWord()} disabled={!text || adding}
                className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-primary"
              >
                <BookPlus className="h-3 w-3" />
                {adding ? t("sel.adding") : t("sel.addWord")}
              </Button>
            )
          )}
          {canSentence && (
            <Button
              variant="ghost" onClick={() => void savePattern(text)} disabled={!text || saving}
              className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-primary"
            >
              <BookmarkPlus className="h-3 w-3" />
              {saving ? t("sel.saving") : t("sel.savePattern")}
            </Button>
          )}

          <Button
            variant="ghost" onClick={() => ask(wordish ? "explain" : "translate")} disabled={!text}
            className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium"
          >
            <Languages className="h-3 w-3" />
            {t("sel.translate")}
          </Button>

          <Button
            variant="ghost" onClick={() => ask(wordish ? "deep" : "explain")} disabled={!text}
            className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium"
          >
            {wordish ? <Search className="h-3 w-3" /> : <MessageSquareQuote className="h-3 w-3" />}
            {wordish ? t("sel.lookup") : t("sel.ask")}
          </Button>

          {text && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border/70" />
              <span className="grid h-7 w-7 place-items-center">
                <SpeakButton text={text} className="w-3.5 h-3.5" />
              </span>
            </>
          )}
        </div>
      </div>

      {target && (
        <div className="min-h-0 flex-1 border-t border-border">
          {/* Keyed so asking about different text starts a fresh stream
            * instead of appending to the previous answer. */}
          <InlineAskPanel
            key={`${target.target.text}:${target.mode}`}
            anchor={target.target}
            mode={target.mode}
            onClose={() => setTarget(null)}
            layout="inline"
          />
        </div>
      )}
    </aside>
  );
}

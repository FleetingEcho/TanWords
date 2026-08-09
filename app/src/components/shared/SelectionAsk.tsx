import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { isWebHost } from "@/platform";
import { positionSelectionToolbar } from "./selectionToolbarPosition";
import {
  AI_MESSAGE_ATTR,
  Anchor, AskMode, anchorFromRange, renderSelectionOverlay, reposition,
} from "./selectionAskHelpers";
import { InlineAskPanel } from "./InlineAskPanel";
import { SelectionToolbarButtons } from "./SelectionToolbarButtons";
import { useSelectionActions } from "./useSelectionActions";
import { useTouchSelection } from "./useTouchSelection";
import { isTouchHost } from "./touchSelection";

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
 * Mobile Web keeps the browser's native long-press selection, handles and OS
 * actions. Its `selectionchange` events also feed this toolbar, which is placed
 * below the selected text so both sets of actions can coexist. The custom touch
 * range remains available to embedded non-Web hosts that need it.
 *
 * "Ask" has two shapes. Normally the answer streams into a panel right under
 * the selection, so you keep your place. Inside an AI chat reply it instead
 * goes to the composer (via the `tanwords:ask-selection` event the chat page
 * listens for) — there's a conversation there, and the follow-up belongs in
 * the transcript rather than in a card that closes.
 */
export function SelectionAsk() {
  const t = useT();
  const enabled = useSettingsStore((s) => s.selectionActions);
  const nativeTouchSelection = isWebHost && isTouchHost();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [asking, setAsking] = useState<{ anchor: Anchor; mode: AskMode } | null>(null);
  const { collected, adding, saving, addWord, savePattern } = useSelectionActions(
    anchor?.text ?? "",
    anchor?.source ?? "app",
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 0, height: 0 });
  // A website should augment the browser selection, never replace it. In
  // particular, do not install the hook's user-select/contextmenu takeover on
  // mobile Safari or Chrome.
  const touch = useTouchSelection(enabled && !isWebHost);

  // Dismissing has to reach the touch layer too, or the gesture state and the
  // toolbar disagree about whether anything is selected.
  const clearTouch = touch.clear;
  const dismiss = useCallback(() => { setAnchor(null); clearTouch(); }, [clearTouch]);

  useEffect(() => {
    if (!touch.active) return;
    setAnchor(touch.range ? anchorFromRange(touch.range, true) : null);
  }, [touch.active, touch.range]);

  useEffect(() => {
    if (!enabled) return;
    const readSelection = () => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      setAnchor(range ? anchorFromRange(range) : null);
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
        let scrolledOutOfView = false;
        setAnchor((prev) => {
          if (!prev) return prev;
          const next = reposition(prev);
          if (!next || next.bottom < 40 || next.top > window.innerHeight - 20) {
            scrolledOutOfView = prev.touch === true;
            return null;
          }
          return next;
        });
        // Outside the updater: the gesture layer is a separate piece of state.
        if (scrolledOutOfView) clearTouch();
        setAsking((prev) => (prev ? { ...prev, anchor: reposition(prev.anchor) ?? prev.anchor } : prev));
      });
    };

    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection?.toString().trim()) {
        setAnchor(null);
      } else if (nativeTouchSelection) {
        // Touch browsers do not reliably synthesize mouseup after the user
        // finishes moving native selection handles. selectionchange is the
        // authoritative signal, and reading it does not alter the OS selection.
        readSelection();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { dismiss(); setAsking(null); }
    };

    // Where touch owns the selection there is nothing in `window.getSelection()`
    // to read, and the synthetic mouse events a tap emits would only clear what
    // the gesture just produced.
    if (!touch.active) {
      // Radix dialogs may stop mouse events before they bubble to document.
      // Capture the completed selection before modal event isolation runs.
      document.addEventListener("mouseup", readSelection, true);
      document.addEventListener("selectionchange", onSelectionChange);
    }
    // Capture phase, on window: scroll doesn't bubble, and the element that
    // actually scrolls differs per surface.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("mouseup", readSelection, true);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [enabled, touch.active, clearTouch, dismiss, nativeTouchSelection]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!anchor || !toolbar) return;
    const next = { width: toolbar.offsetWidth, height: toolbar.offsetHeight };
    setToolbarSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    );
  }, [anchor, adding, collected, saving]);

  if (!enabled) return null;

  // Mid-drag the toolbar would chase the finger across the paragraph; the
  // painted highlight is feedback enough until the finger lifts.
  const toolbarPosition = anchor && toolbarSize.width > 0 && !touch.dragging
    ? positionSelectionToolbar(
        anchor,
        toolbarSize,
        window.innerWidth,
        nativeTouchSelection
          ? { preferBelow: true, viewportHeight: window.innerHeight }
          : undefined,
      )
    : null;

  return (
    <>
      {anchor?.touch && renderSelectionOverlay(anchor, <SelectionHighlight range={anchor.range} />)}

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
            // Dismiss on success only: a failed save leaves the toolbar up so
            // the sentence can be retried rather than silently lost.
            savePattern={(sentence) => void savePattern(sentence).then((ok) => ok && dismiss())}
            dismiss={dismiss}
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

/** The selection highlight, for touch — with native selection switched off
 *  there is no ::selection to paint it, so it's drawn from the range's own
 *  client rects (one per line the selection spans). It re-derives on every
 *  render, which the scroll handler already triggers, so it tracks the text. */
function SelectionHighlight({ range }: { range: Range }) {
  const rects = Array.from(range.getClientRects());
  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      {rects.map((rect, i) => (
        <div
          key={i}
          className="absolute rounded-[3px] bg-primary/30"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ))}
    </div>
  );
}

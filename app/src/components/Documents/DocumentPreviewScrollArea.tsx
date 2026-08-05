import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const TRACK_INSET = 8;
const MIN_THUMB_HEIGHT = 32;

export function calculateDocumentScrollbar(
  clientHeight: number,
  scrollHeight: number,
  scrollTop: number,
) {
  const trackHeight = Math.max(0, clientHeight - TRACK_INSET * 2);
  if (trackHeight === 0 || scrollHeight <= clientHeight) {
    return { top: TRACK_INSET, height: trackHeight, scrollable: false };
  }
  const height = Math.min(
    trackHeight,
    Math.max(MIN_THUMB_HEIGHT, trackHeight * (clientHeight / scrollHeight)),
  );
  const maxScrollTop = scrollHeight - clientHeight;
  const top = TRACK_INSET + (trackHeight - height) * (scrollTop / maxScrollTop);
  return { top, height, scrollable: true };
}

export function DocumentPreviewScrollArea({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const frameRef = useRef(0);
  const [thumb, setThumb] = useState({
    top: TRACK_INSET,
    height: MIN_THUMB_HEIGHT,
    scrollable: false,
  });

  const update = useCallback(() => {
    const viewport = viewportRef.current;
    // Preserve the visible fallback thumb until flex layout has assigned a
    // real viewport height.
    if (!viewport || viewport.clientHeight <= 0) return;
    const next = calculateDocumentScrollbar(
      viewport.clientHeight,
      viewport.scrollHeight,
      viewport.scrollTop,
    );
    // Scroll and size events repeat with identical geometry (typing one
    // character changes neither) — keep the previous state object so those
    // frames do not re-render.
    setThumb((current) =>
      current.top === next.top && current.height === next.height && current.scrollable === next.scrollable
        ? current
        : next,
    );
  }, []);

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      update();
    });
  }, [update]);

  // Measure before paint so the thumb never has a zero-height first frame.
  useLayoutEffect(update, [update]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(viewport);

    // Content growth changes the scroll geometry without resizing the
    // viewport. The old tree-wide MutationObserver saw that, but also saw
    // every keystroke as a subtree mutation — a forced `scrollHeight` read
    // (layout) on every frame while typing.
    //
    // ResizeObservers on the *content* children report real geometry changes
    // (a new line wraps, a block is pasted, an image finishes loading) and
    // nothing else; this observer exists only to re-arm those when the
    // viewport's direct children swap (spinner → editor, editor → editor).
    const observed = new Set<Element>();
    const syncContentObservers = () => {
      if (!resizeObserver) return;
      for (const child of Array.from(viewport.children)) {
        if (!observed.has(child)) {
          observed.add(child);
          resizeObserver.observe(child);
        }
      }
      for (const element of Array.from(observed)) {
        if (!viewport.contains(element)) {
          resizeObserver.unobserve(element);
          observed.delete(element);
        }
      }
    };
    const mutationObserver = new MutationObserver(() => {
      syncContentObservers();
      scheduleUpdate();
    });
    mutationObserver.observe(viewport, { childList: true });
    syncContentObservers();

    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    scheduleUpdate();
    return () => {
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener("scroll", scheduleUpdate);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [scheduleUpdate]);


  return (
    <div className={`relative min-h-0 flex-1 overflow-hidden ${className}`}>
      <div
        {...props}
        ref={viewportRef}
        className="document-preview-scroll h-full"
      >
        {children}
      </div>
    </div>
  );
}

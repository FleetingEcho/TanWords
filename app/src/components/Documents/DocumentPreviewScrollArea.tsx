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
    setThumb(calculateDocumentScrollbar(
      viewport.clientHeight,
      viewport.scrollHeight,
      viewport.scrollTop,
    ));
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
    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(viewport, { childList: true, subtree: true, characterData: true });
    // WebKitGTK can report the pre-flex height during layout effects. Measure
    // again on the next frame after the flex column has its final size.
    scheduleUpdate();
    return () => {
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [scheduleUpdate]);

  const handleThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !thumb.scrollable) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerY: event.clientY, scrollTop: viewport.scrollTop };
  };

  const handleThumbPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (!viewport || !drag || !thumb.scrollable) return;
    const trackTravel = viewport.clientHeight - TRACK_INSET * 2 - thumb.height;
    const scrollTravel = viewport.scrollHeight - viewport.clientHeight;
    if (trackTravel > 0) {
      viewport.scrollTop = drag.scrollTop
        + (event.clientY - drag.pointerY) * (scrollTravel / trackTravel);
    }
  };

  return (
    <div className={`relative min-h-0 flex-1 overflow-hidden ${className}`}>
      <div
        {...props}
        ref={viewportRef}
        onScroll={(event) => {
          scheduleUpdate();
          props.onScroll?.(event);
        }}
        className="document-preview-scroll h-full"
      >
        {children}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2 right-1 top-2 z-20 w-2 rounded-full"
        style={{ background: "hsl(var(--muted-foreground) / 0.2)" }}
      >
        <div
          className={`pointer-events-auto absolute left-0 w-2 rounded-full transition-colors ${
            thumb.scrollable ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          style={{
            top: thumb.top - TRACK_INSET,
            height: thumb.height,
            background: "hsl(var(--muted-foreground) / 0.6)",
          }}
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        />
      </div>
    </div>
  );
}

import React from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { SplitAxis } from "@/workspaces/model";

/** A split divider with pointer capture, following the proven
 *  `FloatingBrowserResizeHandle.tsx` pattern. Pointer capture keeps the drag
 *  alive even if the pointer leaves the divider element; the ratio updates on
 *  animation frames and the final ratio persists on pointer-up (the store
 *  debounces durable writes for divider drags).
 *
 *  Resizing is clamped by the two page definitions' minimum sizes and the
 *  container dimensions: the pointer position is mapped to a ratio and the
 *  store's `clampRatio` (via `resize`) keeps it in [0.2, 0.8]. */
export interface DividerProps {
  splitId: string;
  axis: SplitAxis;
  /** The container element (the split's bounding box). Used to convert the
   *  pointer position into a normalized ratio. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The current first-child share as a CSS percentage string, e.g. "40%".
   *  Positions the divider over the gap between the two children. */
  ratioPct: string;
}

export function Divider({ splitId, axis, containerRef, ratioPct }: DividerProps) {
  const resize = useWorkspaceStore((s) => s.resize);
  const draggingRef = React.useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    let ratio: number;
    if (axis === "horizontal") {
      ratio = (e.clientX - rect.left) / rect.width;
    } else {
      ratio = (e.clientY - rect.top) / rect.height;
    }
    // The store clamps to [MIN_RATIO, MAX_RATIO].
    resize(splitId, ratio);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Already released or capture lost — safe to ignore.
    }
  };

  const horizontal = axis === "horizontal";
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`group pointer-events-auto absolute z-20 flex items-center justify-center touch-none ${
        horizontal
          ? "top-0 bottom-0 -translate-x-1/2 w-1.5 cursor-col-resize"
          : "left-0 right-0 -translate-y-1/2 h-1.5 cursor-row-resize"
      }`}
      style={horizontal ? { left: ratioPct } : { top: ratioPct }}
    >
      <div
        className={`rounded-full bg-[hsl(var(--sidebar-border))] transition-colors group-hover:bg-primary/60 ${
          horizontal ? "h-[calc(100%-16px)] w-[2px]" : "w-[calc(100%-16px)] h-[2px]"
        }`}
      />
    </div>
  );
}

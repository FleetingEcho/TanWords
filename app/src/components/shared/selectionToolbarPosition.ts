interface Point {
  top: number;
  bottom?: number;
  left: number;
}

interface Size {
  width: number;
  height: number;
}

/** Radix dialogs isolate outside DOM for focus and pointer handling. Selection
 * actions originating in a modal must therefore render inside that dialog. */
export function findSelectionOverlayHost(range: Range): Element | null {
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return element?.closest('[role="dialog"]') ?? null;
}

/** Positions the toolbar without CSS transforms so WebKit can rasterize its
 * text on whole device-independent pixels instead of a blurry half-pixel layer. */
export function positionSelectionToolbar(
  anchor: Point,
  size: Size,
  viewportWidth: number,
  options?: {
    preferBelow?: boolean;
    viewportHeight?: number;
    /** The *visible* viewport band (the visual viewport while a soft keyboard
     *  or browser chrome shifts it). The result is clamped into it so the
     *  toolbar never lands behind the keyboard. */
    visibleBand?: { top: number; height: number };
  },
): Point {
  const maxLeft = Math.max(8, viewportWidth - size.width - 8);
  const above = Math.max(8, anchor.top - 8 - size.height);
  const below = (anchor.bottom ?? anchor.top) + 8;
  // Native mobile selection menus normally occupy the space above the text.
  // Prefer the other side when it fits, so the browser menu and our actions
  // remain independently usable; near the viewport bottom, fall back above.
  const hasRoomBelow = options?.viewportHeight == null
    || below + size.height <= options.viewportHeight - 8;
  let top = Math.round(options?.preferBelow && hasRoomBelow ? below : above);
  // Keep the toolbar inside the visible band — on a phone with the keyboard
  // up, the visual viewport no longer spans the layout viewport, and a
  // toolbar clamped only to the layout viewport would land behind it.
  if (options?.visibleBand) {
    const { top: bandTop, height: bandHeight } = options.visibleBand;
    top = Math.min(Math.max(top, bandTop + 8), bandTop + bandHeight - size.height - 8);
    top = Math.max(top, bandTop + 8);
  }
  return {
    top,
    left: Math.round(Math.min(Math.max(anchor.left - size.width / 2, 8), maxLeft)),
  };
}

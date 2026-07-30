interface Point {
  top: number;
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
): Point {
  const maxLeft = Math.max(8, viewportWidth - size.width - 8);
  return {
    top: Math.round(Math.max(8, anchor.top - 8 - size.height)),
    left: Math.round(Math.min(Math.max(anchor.left - size.width / 2, 8), maxLeft)),
  };
}

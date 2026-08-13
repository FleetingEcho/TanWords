export interface ResizeEdges {
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

const EDGE_THICKNESS = 10;
const CORNER_SIZE = 18;

interface FloatingBrowserResizeHandlesProps {
  onResizePointerDown: (edges: ResizeEdges, e: React.PointerEvent) => void;
  onResizePointerMove: (e: React.PointerEvent) => void;
  onResizePointerUp: () => void;
}

/** All 8 resize hit-areas (4 edges + 4 corners), positioned as an unclipped
 *  overlay straddling the bezel's border — a sibling of the visual bezel
 *  (which has `overflow-hidden`), not a child of it, so the hit areas can
 *  extend a few px past the visible edge without being clipped. Corners are
 *  rendered after edges so they win the overlapping pixels at each corner. */
export function FloatingBrowserResizeHandles({
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}: FloatingBrowserResizeHandlesProps) {
  const bind = (edges: ResizeEdges) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      onResizePointerDown(edges, e);
    },
    onPointerMove: onResizePointerMove,
    onPointerUp: onResizePointerUp,
    onPointerCancel: onResizePointerUp,
  });

  return (
    <>
      <div className="absolute cursor-ns-resize" style={{ left: CORNER_SIZE, right: CORNER_SIZE, top: -EDGE_THICKNESS / 2, height: EDGE_THICKNESS }} {...bind({ top: true })} />
      <div className="absolute cursor-ns-resize" style={{ left: CORNER_SIZE, right: CORNER_SIZE, bottom: -EDGE_THICKNESS / 2, height: EDGE_THICKNESS }} {...bind({ bottom: true })} />
      <div className="absolute cursor-ew-resize" style={{ top: CORNER_SIZE, bottom: CORNER_SIZE, left: -EDGE_THICKNESS / 2, width: EDGE_THICKNESS }} {...bind({ left: true })} />
      <div className="absolute cursor-ew-resize" style={{ top: CORNER_SIZE, bottom: CORNER_SIZE, right: -EDGE_THICKNESS / 2, width: EDGE_THICKNESS }} {...bind({ right: true })} />
      <div className="absolute cursor-nwse-resize" style={{ left: -CORNER_SIZE / 2, top: -CORNER_SIZE / 2, width: CORNER_SIZE, height: CORNER_SIZE }} {...bind({ top: true, left: true })} />
      <div className="absolute cursor-nesw-resize" style={{ right: -CORNER_SIZE / 2, top: -CORNER_SIZE / 2, width: CORNER_SIZE, height: CORNER_SIZE }} {...bind({ top: true, right: true })} />
      <div className="absolute cursor-nesw-resize" style={{ left: -CORNER_SIZE / 2, bottom: -CORNER_SIZE / 2, width: CORNER_SIZE, height: CORNER_SIZE }} {...bind({ bottom: true, left: true })} />
      <div className="absolute cursor-nwse-resize" style={{ right: -CORNER_SIZE / 2, bottom: -CORNER_SIZE / 2, width: CORNER_SIZE, height: CORNER_SIZE }} {...bind({ bottom: true, right: true })} />
    </>
  );
}

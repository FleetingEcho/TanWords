import { CanvasRenderer, CellFlags, type GhosttyCell } from "ghostty-web";

interface RendererInternals {
  ctx: CanvasRenderingContext2D;
  metrics: { width: number; height: number };
  theme: { selectionForeground?: string };
  isInSelection(column: number, row: number): boolean;
  renderLine(line: GhosttyCell[], row: number, columns: number): void;
  renderCellText(cell: GhosttyCell, column: number, row: number): void;
}

interface BoxSegments {
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
  heavy?: boolean;
}

const BOX_SEGMENTS: Readonly<Record<string, BoxSegments>> = {
  "─": { left: true, right: true },
  "│": { up: true, down: true },
  "┌": { right: true, down: true },
  "┐": { left: true, down: true },
  "└": { right: true, up: true },
  "┘": { left: true, up: true },
  "├": { up: true, down: true, right: true },
  "┤": { up: true, down: true, left: true },
  "┬": { left: true, right: true, down: true },
  "┴": { left: true, right: true, up: true },
  "┼": { left: true, right: true, up: true, down: true },
  "╭": { right: true, down: true },
  "╮": { left: true, down: true },
  "╰": { right: true, up: true },
  "╯": { left: true, up: true },
  "━": { left: true, right: true, heavy: true },
  "┃": { up: true, down: true, heavy: true },
  "┏": { right: true, down: true, heavy: true },
  "┓": { left: true, down: true, heavy: true },
  "┗": { right: true, up: true, heavy: true },
  "┛": { left: true, up: true, heavy: true },
  "┣": { up: true, down: true, right: true, heavy: true },
  "┫": { up: true, down: true, left: true, heavy: true },
  "┳": { left: true, right: true, down: true, heavy: true },
  "┻": { left: true, right: true, up: true, heavy: true },
  "╋": { left: true, right: true, up: true, down: true, heavy: true },
};

const patched = Symbol("tanwordsGhosttyBoxDrawing");

function cellForeground(renderer: RendererInternals, cell: GhosttyCell, column: number, row: number): string {
  if (renderer.isInSelection(column, row) && renderer.theme.selectionForeground) {
    return renderer.theme.selectionForeground;
  }
  const inverse = Boolean(cell.flags & CellFlags.INVERSE);
  const red = inverse ? cell.bg_r : cell.fg_r;
  const green = inverse ? cell.bg_g : cell.fg_g;
  const blue = inverse ? cell.bg_b : cell.fg_b;
  return `rgb(${red}, ${green}, ${blue})`;
}

export function drawGhosttyBoxGlyph(
  renderer: RendererInternals,
  cell: GhosttyCell,
  column: number,
  row: number,
): boolean {
  const character = String.fromCodePoint(cell.codepoint || 32);
  const segments = BOX_SEGMENTS[character];
  if (!segments) return false;
  if (cell.flags & CellFlags.INVISIBLE) return true;

  const { ctx, metrics } = renderer;
  const left = column * metrics.width;
  const right = left + metrics.width * Math.max(1, cell.width);
  const top = row * metrics.height;
  const bottom = top + metrics.height;
  const centerX = left + metrics.width / 2;
  const centerY = top + metrics.height / 2;

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = cellForeground(renderer, cell, column, row);
  ctx.lineWidth = segments.heavy ? 2 : 1;
  ctx.lineCap = "butt";
  if (cell.flags & CellFlags.FAINT) ctx.globalAlpha = 0.5;
  if (segments.left) {
    ctx.moveTo(left, centerY);
    ctx.lineTo(centerX, centerY);
  }
  if (segments.right) {
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(right, centerY);
  }
  if (segments.up) {
    ctx.moveTo(centerX, top);
    ctx.lineTo(centerX, centerY);
  }
  if (segments.down) {
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX, bottom);
  }
  ctx.stroke();
  ctx.restore();
  return true;
}

export function clearGhosttyCanvasRow(
  renderer: Pick<RendererInternals, "ctx" | "metrics">,
  row: number,
  columns: number,
): void {
  renderer.ctx.clearRect(
    0,
    row * renderer.metrics.height,
    columns * renderer.metrics.width,
    renderer.metrics.height,
  );
}

/**
 * Replace font-dependent box glyphs with exact cell-edge geometry. Transparent
 * fillRect is a no-op with source-over compositing, so also clear each dirty
 * row before ghostty-web repaints it; otherwise old frames accumulate forever.
 */
export function installGhosttyCanvasFixes(): void {
  const prototype = CanvasRenderer.prototype as unknown as RendererInternals & Record<symbol, boolean>;
  if (prototype[patched]) return;
  prototype[patched] = true;
  const renderLine = prototype.renderLine;
  const renderCellText = prototype.renderCellText;
  prototype.renderLine = function patchedRenderLine(line, row, columns) {
    clearGhosttyCanvasRow(this, row, columns);
    renderLine.call(this, line, row, columns);
  };
  prototype.renderCellText = function patchedRenderCellText(cell, column, row) {
    if (drawGhosttyBoxGlyph(this, cell, column, row)) return;
    renderCellText.call(this, cell, column, row);
  };
}

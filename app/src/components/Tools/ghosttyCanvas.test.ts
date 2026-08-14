import { describe, expect, it, vi } from "vitest";
import { CellFlags, type GhosttyCell } from "ghostty-web";
import { clearGhosttyCanvasRow, drawGhosttyBoxGlyph } from "./ghosttyCanvas";

function cell(character: string, flags = 0): GhosttyCell {
  return {
    codepoint: character.codePointAt(0)!,
    fg_r: 12,
    fg_g: 34,
    fg_b: 56,
    bg_r: 65,
    bg_g: 43,
    bg_b: 21,
    flags,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0,
  };
}

function renderer() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt" as CanvasLineCap,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    metrics: { width: 10, height: 20 },
    theme: { selectionForeground: "#ffffff" },
    isInSelection: vi.fn(() => false),
    renderLine: vi.fn(),
    renderCellText: vi.fn(),
  };
}

describe("Ghostty Canvas box drawing", () => {
  it("clears a dirty row before transparent repainting", () => {
    const target = renderer();

    clearGhosttyCanvasRow(target, 3, 80);

    expect(target.ctx.clearRect).toHaveBeenCalledWith(0, 60, 800, 20);
  });

  it("joins light borders at exact cell centers and edges", () => {
    const target = renderer();

    expect(drawGhosttyBoxGlyph(target, cell("┼"), 2, 3)).toBe(true);
    expect(target.ctx.moveTo).toHaveBeenCalledWith(20, 70);
    expect(target.ctx.lineTo).toHaveBeenCalledWith(25, 70);
    expect(target.ctx.lineTo).toHaveBeenCalledWith(30, 70);
    expect(target.ctx.moveTo).toHaveBeenCalledWith(25, 60);
    expect(target.ctx.lineTo).toHaveBeenCalledWith(25, 80);
    expect(target.ctx.strokeStyle).toBe("rgb(12, 34, 56)");
    expect(target.ctx.lineWidth).toBe(1);
  });

  it("uses heavy strokes and inverse colors when requested", () => {
    const target = renderer();

    expect(drawGhosttyBoxGlyph(target, cell("┃", CellFlags.INVERSE), 0, 0)).toBe(true);
    expect(target.ctx.strokeStyle).toBe("rgb(65, 43, 21)");
    expect(target.ctx.lineWidth).toBe(2);
  });

  it("leaves ordinary text to the upstream renderer", () => {
    expect(drawGhosttyBoxGlyph(renderer(), cell("A"), 0, 0)).toBe(false);
  });
});

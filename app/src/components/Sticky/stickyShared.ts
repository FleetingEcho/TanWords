/** Shared sticky bits used by both sticky windows (the note itself and the
 *  floating manager) — palette, geometry constants, surface styling.
 *
 *  Deliberately dependency-light: both entry points import this, so anything
 *  heavy belongs elsewhere. */
import type { CSSProperties } from "react";

/** The sticky window is just its header row when collapsed (must match
 *  STICKY_HEADER_HEIGHT in electron/main/stickyWindows.ts). */
export const STICKY_HEADER_HEIGHT = 44;
export const STICKY_MIN_W = 180;
export const STICKY_MIN_H = 140;

/** tanNotes' pastel set. The hex IS the stored value ("yellow" is the id and
 *  the canonical default); a stored hex also round-trips fine — the id lookup
 *  falls through and the hex is used as-is (imported bundles may carry
 *  custom values). */
export const STICKY_COLORS: ReadonlyArray<{ id: string; hex: string }> = [
  { id: "yellow", hex: "#FFE58A" },
  { id: "blue", hex: "#A9D7FF" },
  { id: "green", hex: "#B7E8B2" },
  { id: "pink", hex: "#FFC4DA" },
  { id: "purple", hex: "#D9C2FF" },
  { id: "orange", hex: "#FFD3A3" },
  { id: "gray", hex: "#D9D9D9" },
];

export function stickyColorHex(color: string): string {
  return STICKY_COLORS.find((c) => c.id === color)?.hex ?? color;
}

/** Surface style: pastel at the note's opacity over a transparent window.
 *  Opacity is clamped 10–100 by the core; divide by 100 for CSS alpha.
 *  A solid fallback border keeps even a 10%-opacity note visible. */
export function stickySurfaceStyle(color: string, opacity: number): CSSProperties {
  const hex = stickyColorHex(color);
  const alpha = Math.min(100, Math.max(10, opacity)) / 100;
  const rgb = hex.replace("#", "");
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    // Hairline in the same hue, opaque, so low-opacity notes keep an edge.
    boxShadow: `inset 0 0 0 1px rgba(${r}, ${g}, ${b}, 1)`,
  };
}

/** Corner radius: notes are ALWAYS rounded (2026-09 product decision — the
 *  square option was removed). Legacy notes with corner="square" in the DB
 *  render rounded too; the `corner` argument is kept for signature stability
 *  with stored detail objects. */
export function stickyCornerClass(corner: string): string {
  void corner;
  return "rounded-2xl";
}

/** Same derive rule as the core's `derive_title`: first non-empty line,
 *  capped at 80 chars. Used live in headers — the DB title catches up on
 *  the next save (the core derives from the same plaintext). */
export function stickyDerivedTitle(plainText: string): string {
  for (const line of plainText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  }
  return "";
}

/** ── Wire shapes (VERIFIED against the live sidecar over HTTP — see
 *  init_db_tests-era curl capture): the core's sticky structs serialize
 *  snake_case with `StickyDetail`'s item serde-FLATTENED, so there is no
 *  `item`/`items` wrapper anywhere: `sticky_get`/`sticky_create` return one
 *  flat object with top-level `id`, and `sticky_list`/`sticky_search` return
 *  bare arrays. Assuming the Rust struct shape (`.item.id`) crashes at
 *  runtime with "Cannot read properties of undefined (reading 'id')". */
export interface StickyListItem {
  id: number;
  title: string;
  preview: string;
  word_count: number;
  color: string;
  corner: string;
  opacity: number;
  always_on_top: boolean;
  font_family?: string | null;
  font_size?: number | null;
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  collapsed: boolean;
  is_open: boolean;
  created_at: string;
  updated_at: string;
}
export type StickyDetail = StickyListItem & { content: string };

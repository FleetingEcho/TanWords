/** Shared sticky bits used by both sticky windows (the note itself and the
 *  floating manager) — palette, geometry constants, surface styling.
 *
 *  Deliberately dependency-light: both entry points import this, so anything
 *  heavy belongs elsewhere. */
import { useEffect, type CSSProperties, type RefObject } from "react";

/** The sticky window is just its header row when collapsed (must match
 *  STICKY_HEADER_HEIGHT in electron/main/stickyWindows.ts). */
export const STICKY_HEADER_HEIGHT = 44;
export const STICKY_MIN_W = 280;
export const STICKY_MIN_H = 140;

/** tanNotes' pastel set. The hex IS the stored value ("yellow" is the id and
 *  the canonical default); a stored hex also round-trips fine — the id lookup
 *  falls through and the hex is used as-is (imported bundles may carry
 *  custom values). */
export const STICKY_COLORS: ReadonlyArray<{ id: string; hex: string }> = [
  { id: "yellow", hex: "#FFE58A" },
  { id: "lime", hex: "#D8EEA3" },
  { id: "green", hex: "#B7E8B2" },
  { id: "teal", hex: "#A7E8D7" },
  { id: "cyan", hex: "#A8E6F0" },
  { id: "blue", hex: "#A9D7FF" },
  { id: "purple", hex: "#D9C2FF" },
  { id: "pink", hex: "#FFC4DA" },
  { id: "coral", hex: "#FFB4A2" },
  { id: "orange", hex: "#FFD3A3" },
  { id: "brown", hex: "#D6B89C" },
  { id: "gray", hex: "#D9D9D9" },
];

export function stickyColorHex(color: string): string {
  return STICKY_COLORS.find((c) => c.id === color)?.hex ?? color;
}

/** Surface style: the note's colour over a transparent window, theme-aware.
 *  `--sticky-tint` (theme-vars.css) is 100 on light themes — the classic
 *  full pastel — and ~20 on dark themes, where the note becomes a
 *  hue-tinted wash over the themed canvas (`hsl(var(--background))`), so the
 *  note follows EVERY app theme while keeping its colour identity. The
 *  note's opacity then fades that mix toward transparent (core clamps
 *  opacity to 10–100). The hairline ring keeps the full-hue edge in every
 *  theme, so even a 10%-opacity note stays visible. */
export function stickySurfaceStyle(color: string, opacity: number): CSSProperties {
  const hex = stickyColorHex(color);
  const alpha = Math.min(100, Math.max(10, opacity)) / 100;
  const base = `color-mix(in srgb, ${hex} calc(var(--sticky-tint, 100) * 1%), hsl(var(--background)))`;
  return {
    backgroundColor:
      alpha >= 1 ? base : `color-mix(in srgb, ${base} ${Math.round(alpha * 100)}%, transparent)`,
    boxShadow: `inset 0 0 0 1px ${hex}`,
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
  /** True once the user renamed the note; saves stop re-deriving. */
  custom_title?: boolean;
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

export type StickySortMode = "created" | "updated" | "title-asc" | "title-desc";

const STICKY_SORT_MODES: readonly StickySortMode[] = [
  "created", "updated", "title-asc", "title-desc",
];

export const STICKY_SORT_STORAGE_KEY = "sticky-sort-mode";
export const STICKY_PANEL_OPACITY_STORAGE_KEY = "sticky-panel-opacity";

export function isStickySortMode(value: string | null): value is StickySortMode {
  return STICKY_SORT_MODES.includes(value as StickySortMode);
}

export function loadStickySortMode(): StickySortMode {
  try {
    const saved = localStorage.getItem(STICKY_SORT_STORAGE_KEY);
    return isStickySortMode(saved) ? saved : "created";
  } catch {
    return "created";
  }
}

export function saveStickySortMode(mode: StickySortMode): void {
  try {
    localStorage.setItem(STICKY_SORT_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable in a restricted renderer.
  }
}

export function loadStickyPanelOpacity(): number {
  try {
    const value = Number(localStorage.getItem(STICKY_PANEL_OPACITY_STORAGE_KEY));
    return Number.isFinite(value) && value >= 20 && value <= 100 ? value : 95;
  } catch {
    return 95;
  }
}

export function saveStickyPanelOpacity(opacity: number): void {
  try {
    localStorage.setItem(
      STICKY_PANEL_OPACITY_STORAGE_KEY,
      String(Math.min(100, Math.max(20, Math.round(opacity)))),
    );
  } catch {
    // Storage may be unavailable in a restricted renderer.
  }
}

/** Return a sorted copy so backend results and React state are never mutated.
 *  Time modes are newest-first; the id tie-break keeps equal-second database
 *  timestamps deterministic. */
export function sortStickyItems(
  items: readonly StickyListItem[],
  mode: StickySortMode,
): StickyListItem[] {
  return [...items].sort((a, b) => {
    if (mode === "created" || mode === "updated") {
      const key = mode === "created" ? "created_at" : "updated_at";
      return b[key].localeCompare(a[key]) || b.id - a.id;
    }

    const aTitle = a.title.trim() || stickyDerivedTitle(a.preview);
    const bTitle = b.title.trim() || stickyDerivedTitle(b.preview);
    const byTitle = aTitle.localeCompare(bTitle, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return (mode === "title-asc" ? byTitle : -byTitle) || b.id - a.id;
  });
}

/** Dismiss a popover when a pointer lands outside it. Document-level
 *  `pointerdown` (capture) so the dismissal wins over the outside click's own
 *  handlers. `ignoreRef` optionally names a trigger element whose presses
 *  must NOT dismiss — lets the trigger keep its natural toggle behavior when
 *  the menu lives apart from it. */
export function useDismissOnOutsideClick(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
  ignoreRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (ignoreRef?.current?.contains(target)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [ref, active, onDismiss, ignoreRef]);
}

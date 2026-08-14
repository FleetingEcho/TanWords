import type { NavPage } from "@/store/navStore";

export type Theme =
  | "light"
  | "dark"
  | "catppuccin-latte"
  | "catppuccin-mocha"
  | "dracula"
  | "tokyo-night"
  | "tokyo-night-day"
  | "tokyo-night-storm"
  | "dim"
  | "system";
export type SidebarTabId = Exclude<NavPage, "settings">;
export type TopBarItemId = "search" | "context" | "scratch" | "db" | "mcp" | "ai" | "language" | "theme" | "updates" | "github";
export type LayoutMode = "flexible" | "fixed";
export type TerminalRenderer = "auto" | "webgl" | "dom";
export const TERMINAL_COLOR_SCHEME_IDS = [
  "tokyo-night", "dracula", "light", "high-contrast", "custom",
] as const;
export type TerminalColorScheme = typeof TERMINAL_COLOR_SCHEME_IDS[number];
export interface TerminalCustomAppearance {
  backgroundColor: string;
  textColor: string;
  transparent: boolean;
  blur: number;
  opacity: number;
}

/** Feeds page tab selector: a specific RSS feed, "all" of them, or the native Hacker News browser. */
export type RssTabSelection = number | "all" | "hackernews";

export const DEFAULT_SIDEBAR_TABS: SidebarTabId[] = [
  "dashboard", "feeds", "reading", "documents", "vocabulary", "chat", "music", "browser", "terminal", "tools",
];
export const DEFAULT_TOPBAR_ITEMS: TopBarItemId[] = [
  "search", "context", "scratch", "db", "mcp", "ai", "language", "theme", "updates", "github",
];
export const DEFAULT_LAYOUT_MODE: LayoutMode = "flexible";

/** Amber, matching the emphasis colour word notes used before highlights had
 *  their own `==` syntax. Kept in sync with the fallback in index.css. */
export const DEFAULT_HIGHLIGHT_COLOR = "#d97706";
export const DOCUMENT_TEXT_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Mid-tone hues that stay legible as a translucent wash in both themes. */
export const HIGHLIGHT_PRESETS = ["#d97706", "#eab308", "#22c55e", "#0ea5e9", "#8b5cf6", "#ec4899"] as const;

/** Idle minutes before the app locks itself, `0` meaning never. Offered as a
 *  short list rather than a free number: the useful answers are "when I go for
 *  coffee" and "when I leave for the day", and both are coarse. */
export const AUTO_LOCK_CHOICES = [0, 10, 20, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 0;
export const DEFAULT_TERMINAL_BACKGROUND_BLUR = 16;
// Only "custom" and "light" (Glass Light) ever render translucent — see
// `effectiveTransparent` in TerminalTool.tsx, which ignores opacity entirely
// for every other preset. This default backs those opaque presets (and a
// fresh, not-yet-transparent Custom), so the number shown next to the slider
// matches what's actually on screen instead of implying a glass effect that
// isn't there.
export const DEFAULT_TERMINAL_BACKGROUND_OPACITY = 100;
/** Keeps Glass Light visibly light over both wallpapers and the dark app canvas. */
export const GLASS_LIGHT_BACKGROUND_OPACITY = 70;
export const DEFAULT_TERMINAL_TRANSPARENT = false;
export const DEFAULT_TERMINAL_RENDERER: TerminalRenderer = "auto";
/** Tokyo Night is the default retained dark preset. */
export const DEFAULT_TERMINAL_BACKGROUND_COLOR = "#1a1b26";
export const DEFAULT_TERMINAL_TEXT_COLOR = "#c0caf5";
export const DEFAULT_TERMINAL_COLOR_SCHEME: TerminalColorScheme = "tokyo-night";
export const DEFAULT_TERMINAL_CUSTOM_APPEARANCE: TerminalCustomAppearance = {
  backgroundColor: DEFAULT_TERMINAL_BACKGROUND_COLOR,
  textColor: DEFAULT_TERMINAL_TEXT_COLOR,
  transparent: DEFAULT_TERMINAL_TRANSPARENT,
  blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
  opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
};
export const TERMINAL_COLOR_SCHEME_COLORS: Record<Exclude<TerminalColorScheme, "custom">, {
  background: string;
  foreground: string;
}> = {
  "tokyo-night": { background: "#1a1b26", foreground: "#c0caf5" },
  dracula: { background: "#282a36", foreground: "#f8f8f2" },
  light: { background: "#dedede", foreground: "#000000" },
  "high-contrast": { background: "#000000", foreground: "#ffffff" },
};

/** Built-in schemes own their complete glass treatment. Custom appearance
 * values are restored only when the explicit Custom scheme is selected. */
export const TERMINAL_COLOR_SCHEME_EFFECTS: Record<Exclude<TerminalColorScheme, "custom">, Pick<
  TerminalCustomAppearance,
  "transparent" | "blur" | "opacity"
>> = {
  "tokyo-night": {
    transparent: DEFAULT_TERMINAL_TRANSPARENT,
    blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
    opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  },
  dracula: {
    transparent: DEFAULT_TERMINAL_TRANSPARENT,
    blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
    opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  },
  light: {
    transparent: true,
    blur: 0,
    opacity: GLASS_LIGHT_BACKGROUND_OPACITY,
  },
  "high-contrast": {
    transparent: DEFAULT_TERMINAL_TRANSPARENT,
    blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
    opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  },
};

/** Normalizes a hex colour to canonical `#rrggbb` lowercase, accepting CSS
 *  shorthand `#rgb` (and a bare `rgb`/`rrggbb` without the leading `#`). Returns
 *  the fallback (Tokyo Night by default) when the input is not a valid colour,
 *  so a corrupt stored or typed value never blanks the terminal. */
export function normalizeHexColor(
  raw: string,
  fallback: string = DEFAULT_TERMINAL_BACKGROUND_COLOR,
): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((raw ?? "").trim());
  if (!m) return fallback;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}
/** `ui-monospace` resolves to the desktop OS/browser's native monospace face. */
export const DEFAULT_TERMINAL_FONT_FAMILY = "ui-monospace";
export const DEFAULT_TERMINAL_FONT_SIZE = 16;
export const DEFAULT_TERMINAL_FONT_WEIGHT = 400;

/** xterm accepts the full CSS weight range. Snap arbitrary persisted or typed
 * values to actual 100-step font weights so the UI and renderer stay aligned. */
export function normalizeTerminalFontWeight(value: unknown): number {
  const weight = Number(value);
  if (!Number.isFinite(weight)) return DEFAULT_TERMINAL_FONT_WEIGHT;
  return Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
}

/** Which part of the dashboard banner survives the crop into its letterbox frame,
 *  as CSS `object-position` percentages. The image itself is stored whole, so this
 *  is the user's answer to "the banner is wider than my photo — show me *this* band". */
export interface BannerPosition {
  x: number;
  y: number;
}

/** What a plain `object-fit: cover` does on its own: dead centre. */
export const DEFAULT_BANNER_POSITION: BannerPosition = { x: 50, y: 50 };

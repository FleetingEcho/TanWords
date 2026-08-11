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

/** Feeds page tab selector: a specific RSS feed, "all" of them, or the native Hacker News browser. */
export type RssTabSelection = number | "all" | "hackernews";

export const DEFAULT_SIDEBAR_TABS: SidebarTabId[] = [
  "dashboard", "feeds", "reading", "documents", "vocabulary", "chat", "music", "browser", "tools",
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
export const DEFAULT_TERMINAL_BACKGROUND_OPACITY = 16;
export const DEFAULT_TERMINAL_TRANSPARENT = false;
/** `ui-monospace` resolves to the desktop OS/browser's native monospace face. */
export const DEFAULT_TERMINAL_FONT_FAMILY = "ui-monospace";
export const DEFAULT_TERMINAL_FONT_SIZE = 16;

/** Which part of the dashboard banner survives the crop into its letterbox frame,
 *  as CSS `object-position` percentages. The image itself is stored whole, so this
 *  is the user's answer to "the banner is wider than my photo — show me *this* band". */
export interface BannerPosition {
  x: number;
  y: number;
}

/** What a plain `object-fit: cover` does on its own: dead centre. */
export const DEFAULT_BANNER_POSITION: BannerPosition = { x: 50, y: 50 };

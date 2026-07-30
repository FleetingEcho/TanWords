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

/** Feeds page tab selector: a specific RSS feed, "all" of them, or the native Hacker News browser. */
export type RssTabSelection = number | "all" | "hackernews";

export const DEFAULT_SIDEBAR_TABS: SidebarTabId[] = [
  "dashboard", "feeds", "reading", "documents", "vocabulary", "chat", "music", "browser",
];
export const DEFAULT_TOPBAR_ITEMS: TopBarItemId[] = [
  "search", "context", "scratch", "db", "mcp", "ai", "language", "theme", "updates", "github",
];

/** The draggable cards on the Dashboard's "Recents" grid. */
export type DashboardWidgetId = "quickActions" | "feedUpdates" | "latestWords" | "recentlyRead" | "recentDocuments";
export interface DashboardWidgetLayout {
  left: DashboardWidgetId[];
  right: DashboardWidgetId[];
}
export const DEFAULT_DASHBOARD_WIDGET_LAYOUT: DashboardWidgetLayout = {
  left: ["quickActions", "feedUpdates", "latestWords"],
  right: ["recentlyRead", "recentDocuments"],
};
const ALL_DASHBOARD_WIDGETS: DashboardWidgetId[] = [
  ...DEFAULT_DASHBOARD_WIDGET_LAYOUT.left,
  ...DEFAULT_DASHBOARD_WIDGET_LAYOUT.right,
];

/** Amber, matching the emphasis colour word notes used before highlights had
 *  their own `==` syntax. Kept in sync with the fallback in index.css. */
export const DEFAULT_HIGHLIGHT_COLOR = "#d97706";
export const DOCUMENT_TEXT_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Mid-tone hues that stay legible as a translucent wash in both themes. */
export const HIGHLIGHT_PRESETS = ["#d97706", "#eab308", "#22c55e", "#0ea5e9", "#8b5cf6", "#ec4899"] as const;

/** Which part of the dashboard banner survives the crop into its letterbox frame,
 *  as CSS `object-position` percentages. The image itself is stored whole, so this
 *  is the user's answer to "the banner is wider than my photo — show me *this* band". */
export interface BannerPosition {
  x: number;
  y: number;
}

/** What a plain `object-fit: cover` does on its own: dead centre. */
export const DEFAULT_BANNER_POSITION: BannerPosition = { x: 50, y: 50 };

/** Guards against a stored layout that's drifted from `ALL_DASHBOARD_WIDGETS` —
 *  an older install missing a widget added since, or (in principle) corrupt
 *  JSON — by dropping unknown ids and appending any missing ones to "left"
 *  rather than ever silently losing or duplicating a card. */
export function sanitizeDashboardLayout(raw: unknown): DashboardWidgetLayout {
  const rawLeft = Array.isArray((raw as Partial<DashboardWidgetLayout>)?.left) ? (raw as DashboardWidgetLayout).left : [];
  const rawRight = Array.isArray((raw as Partial<DashboardWidgetLayout>)?.right) ? (raw as DashboardWidgetLayout).right : [];
  const seen = new Set<DashboardWidgetId>();
  const left = rawLeft.filter((id) => {
    if (!ALL_DASHBOARD_WIDGETS.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const right = rawRight.filter((id) => {
    if (!ALL_DASHBOARD_WIDGETS.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const missing = ALL_DASHBOARD_WIDGETS.filter((id) => !seen.has(id));
  return { left: [...left, ...missing], right };
}

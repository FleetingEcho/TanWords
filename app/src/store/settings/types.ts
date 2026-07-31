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

/** The cards on the Dashboard's "Recents" grid.
 *
 *  "quickActions" was here too until it moved out of the grid entirely — it
 *  carried no list, so nothing sized it, and it sat at a third the height of
 *  its neighbours. It is now a full-width strip under the greeting
 *  (QuickActionsBar). A stored layout still naming it is handled by
 *  `sanitizeDashboardLayout`, which drops ids it no longer knows. */
export type DashboardWidgetId =
  | "feedUpdates" | "latestWords" | "recentlyRead" | "recentDocuments" | "patterns" | "listenNext";
export interface DashboardWidgetLayout {
  left: DashboardWidgetId[];
  right: DashboardWidgetId[];
}
export const DEFAULT_DASHBOARD_WIDGET_LAYOUT: DashboardWidgetLayout = {
  left: ["patterns", "feedUpdates", "recentDocuments"],
  right: ["latestWords", "listenNext", "recentlyRead"],
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
 *  an older install missing a widget added since, or one naming a widget that
 *  has been retired — by dropping unknown ids and re-placing any missing ones
 *  rather than ever silently losing or duplicating a card.
 *
 *  Missing ids go to whichever column is shorter at the time, not always to
 *  "left": the grid is two equal columns, and an install upgrading across
 *  several new widgets at once would otherwise end up with everything stacked
 *  down one side. */
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
  const balanced = { left: [...left], right: [...right] };
  for (const id of missing) {
    (balanced.left.length <= balanced.right.length ? balanced.left : balanced.right).push(id);
  }
  return balanced;
}

import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS,
  type SidebarTabId, type TopBarItemId, type RssTabSelection,
} from "./types";

/** localStorage mirrors of a handful of settings that several pages read
 * synchronously on mount, before loadFromDB()'s async round-trip resolves —
 * so the first render uses the right value instead of flashing a default. */

/** Cached synchronously so the first render uses the right language instead
 * of flashing the wrong one before the async DB round-trip in loadFromDB()
 * resolves. Defaults to English for anyone without a saved preference yet. */
export function cachedUiLanguage(): string {
  try {
    return localStorage.getItem("tanwords_language_cache") || "en";
  } catch {
    return "en";
  }
}

export function cacheUiLanguage(lang: string) {
  try {
    localStorage.setItem("tanwords_language_cache", lang);
  } catch {
    // localStorage unavailable — the DB-driven value still applies, just without the fast-path cache
  }
}

const SIDEBAR_TABS_CACHE_KEY = "tanwords_visible_sidebar_tabs_cache";
const TOPBAR_ITEMS_CACHE_KEY = "tanwords_visible_topbar_items_cache";

export function cachedSidebarTabs(): SidebarTabId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIDEBAR_TABS_CACHE_KEY) || "null");
    if (!Array.isArray(parsed)) return [];
    return DEFAULT_SIDEBAR_TABS.filter((id) => parsed.includes(id));
  } catch {
    return [];
  }
}

export function cacheSidebarTabs(tabs: SidebarTabId[]) {
  try {
    localStorage.setItem(SIDEBAR_TABS_CACHE_KEY, JSON.stringify(tabs));
  } catch {
    // The DB remains authoritative when localStorage is unavailable.
  }
}

export function cachedTopBarItems(): TopBarItemId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOPBAR_ITEMS_CACHE_KEY) || "null");
    if (!Array.isArray(parsed)) return DEFAULT_TOPBAR_ITEMS;
    return DEFAULT_TOPBAR_ITEMS.filter((id) => parsed.includes(id));
  } catch {
    return DEFAULT_TOPBAR_ITEMS;
  }
}

export function cacheTopBarItems(items: TopBarItemId[]) {
  try { localStorage.setItem(TOPBAR_ITEMS_CACHE_KEY, JSON.stringify(items)); } catch {}
}

const DEFAULT_RSS_TAB_CACHE_KEY = "tanwords_default_rss_tab_cache";

/** FeedsPage reads this synchronously on mount, before loadFromDB()'s async
 * round-trip resolves, so it doesn't flash "All" then jump to the real default. */
export function cachedDefaultRssTab(): RssTabSelection {
  try {
    const raw = localStorage.getItem(DEFAULT_RSS_TAB_CACHE_KEY);
    if (raw === null) return "hackernews";
    const parsed = JSON.parse(raw);
    return parsed === "all" || parsed === "hackernews" || typeof parsed === "number" ? parsed : "hackernews";
  } catch {
    return "hackernews";
  }
}

export function cacheDefaultRssTab(tab: RssTabSelection) {
  try { localStorage.setItem(DEFAULT_RSS_TAB_CACHE_KEY, JSON.stringify(tab)); } catch {}
}

const FEEDS_VIEW_MODE_CACHE_KEY = "tanwords_feeds_view_mode_cache";

export function cachedFeedsViewMode(): "card" | "list" {
  try {
    return localStorage.getItem(FEEDS_VIEW_MODE_CACHE_KEY) === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

export function cacheFeedsViewMode(mode: "card" | "list") {
  try { localStorage.setItem(FEEDS_VIEW_MODE_CACHE_KEY, mode); } catch {}
}

export async function saveSetting(key: string, value: string) {
  try {
    const { invoke } = await import("@/ipc/backend");
    await invoke("db_set_setting", { key, value });
  } catch {
    // Web mode fallback
    localStorage.setItem(`tanwords_${key}`, value);
  }
}

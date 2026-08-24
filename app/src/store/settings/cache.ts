import {
  DEFAULT_SIDEBAR_TABS, DEFAULT_VISIBLE_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, DEFAULT_VISIBLE_TOPBAR_ITEMS,
  DEFAULT_LAYOUT_MODE, type SidebarTabId, type TopBarItemId, type RssTabSelection, type LayoutMode,
} from "./types";
import { normalizeOrder } from "./reorder";

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
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_SIDEBAR_TABS;
    return DEFAULT_SIDEBAR_TABS.filter((id) => parsed.includes(id));
  } catch {
    return DEFAULT_VISIBLE_SIDEBAR_TABS;
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
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_TOPBAR_ITEMS;
    // Filtered against the *full* id list (not just the default-visible
    // subset) so a cached list that includes something beyond the defaults —
    // because the user turned it on — doesn't get silently dropped; this is
    // just validating/ordering the cache, not re-applying the default.
    return DEFAULT_TOPBAR_ITEMS.filter((id) => parsed.includes(id));
  } catch {
    return DEFAULT_VISIBLE_TOPBAR_ITEMS;
  }
}

export function cacheTopBarItems(items: TopBarItemId[]) {
  try { localStorage.setItem(TOPBAR_ITEMS_CACHE_KEY, JSON.stringify(items)); } catch {}
}

const SIDEBAR_TAB_ORDER_CACHE_KEY = "tanwords_sidebar_tab_order_cache";
const TOPBAR_ITEM_ORDER_CACHE_KEY = "tanwords_topbar_item_order_cache";

export function cachedSidebarTabOrder(): SidebarTabId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIDEBAR_TAB_ORDER_CACHE_KEY) || "null");
    if (!Array.isArray(parsed)) return DEFAULT_SIDEBAR_TABS;
    return normalizeOrder(parsed, DEFAULT_SIDEBAR_TABS);
  } catch {
    return DEFAULT_SIDEBAR_TABS;
  }
}

export function cacheSidebarTabOrder(order: SidebarTabId[]) {
  try { localStorage.setItem(SIDEBAR_TAB_ORDER_CACHE_KEY, JSON.stringify(order)); } catch {}
}

export function cachedTopBarItemOrder(): TopBarItemId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOPBAR_ITEM_ORDER_CACHE_KEY) || "null");
    if (!Array.isArray(parsed)) return DEFAULT_TOPBAR_ITEMS;
    return normalizeOrder(parsed, DEFAULT_TOPBAR_ITEMS);
  } catch {
    return DEFAULT_TOPBAR_ITEMS;
  }
}

export function cacheTopBarItemOrder(order: TopBarItemId[]) {
  try { localStorage.setItem(TOPBAR_ITEM_ORDER_CACHE_KEY, JSON.stringify(order)); } catch {}
}

const LAYOUT_MODE_CACHE_KEY = "tanwords_layout_mode_cache";

export function cachedLayoutMode(): LayoutMode {
  try {
    return localStorage.getItem(LAYOUT_MODE_CACHE_KEY) === "fixed" ? "fixed" : DEFAULT_LAYOUT_MODE;
  } catch {
    return DEFAULT_LAYOUT_MODE;
  }
}

export function cacheLayoutMode(mode: LayoutMode) {
  try { localStorage.setItem(LAYOUT_MODE_CACHE_KEY, mode); } catch {}
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

/** Persists a group of settings after one backend import. Useful when fields
 * form one logical value and must all be dispatched in the same turn. */
export async function saveSettings(entries: Array<[key: string, value: string]>) {
  try {
    const { invoke } = await import("@/ipc/backend");
    await Promise.all(entries.map(([key, value]) => invoke("db_set_setting", { key, value })));
  } catch {
    for (const [key, value] of entries) {
      localStorage.setItem(`tanwords_${key}`, value);
    }
  }
}

// One trailing-edge timer per key. Range-slider setters (background blur,
// document font size/line height) attach to onChange, which fires per drag
// tick — without a debounce one drag is tens of HTTP+SQLite writes.
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function saveSettingDebounced(key: string, value: string, delayMs = 300) {
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    void saveSetting(key, value);
  }, delayMs));
}

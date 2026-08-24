import type { WorkspaceCollection } from "./model";
import { migrate, encodeCollection } from "./normalization";
import { saveSetting, saveSettingDebounced } from "@/store/settings/cache";

/** Workspace persistence: a small localStorage cache for immediate startup,
 *  reconciled with the durable user-settings value after it loads — the same
 *  pattern `cachedSidebarTabs` / `cacheSidebarTabs` and the layout-mode cache
 *  use, so desktop and web behave consistently and the first render uses the
 *  right value instead of flashing a blank list.
 *
 *  The durable key is `custom_workspaces_v1`, kept out of the large
 *  `settingsStore.ts` (per the plan): tree mutation lives in the workspace
 *  module, and settings storage is just a generic key-value row. */

const CACHE_KEY = "tanwords_custom_workspaces_v1_cache";
const DURABLE_KEY = "custom_workspaces_v1";

/** Read the synchronous localStorage cache. Returns an empty collection if the
 *  cache is missing or corrupt (the durable value is still loaded afterwards
 *  and reconciles). The `recovered` flag is true when the cache was missing or
 *  corrupt; the store uses it only for a transient startup signal (the durable
 *  value reconciles away the difference), not a persistent notice. */
export function cachedWorkspaces(): { collection: WorkspaceCollection; recovered: boolean } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { collection: { schemaVersion: 1, workspaces: [] }, recovered: true };
    return migrate(JSON.parse(raw));
  } catch {
    return { collection: { schemaVersion: 1, workspaces: [] }, recovered: true };
  }
}

/** Write the synchronous cache. Called on every structural change so the
 *  next render (even before the durable write resolves) sees the new value. */
export function cacheWorkspaces(c: WorkspaceCollection): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(encodeCollection(c)));
  } catch {
    // localStorage unavailable — the durable value still applies.
  }
}

/** Read the durable value from the user-settings store. Returns `null` when
 *  the row is absent or unreadable, so the caller can distinguish "nothing
 *  persisted yet" from "an empty collection persisted". The `recovered` flag
 *  is true when a row was present but unreadable or corrupt — the store
 *  surfaces this so the user is told their saved workspaces were reset rather
 *  than seeing a silent, data-loss-looking empty list. */
export async function loadDurableWorkspaces(): Promise<{ collection: WorkspaceCollection | null; recovered: boolean }> {
  try {
    const { invoke } = await import("@/ipc/backend");
    const raw = await invoke<string | null>("db_get_setting", { key: DURABLE_KEY });
    if (raw === null || raw === undefined || raw === "") return { collection: null, recovered: false };
    try {
      const { collection, recovered } = migrate(JSON.parse(raw));
      return { collection, recovered };
    } catch {
      // A present-but-unparseable durable value is corruption: recover to an
      // empty collection and flag it so the user is told, not silently shown
      // an empty list that looks like data loss.
      return { collection: { schemaVersion: 1, workspaces: [] }, recovered: true };
    }
  } catch {
    // Web mode fallback: settings live in localStorage under `tanwords_<key>`.
    try {
      const raw = localStorage.getItem(`tanwords_${DURABLE_KEY}`);
      if (!raw) return { collection: null, recovered: false };
      try {
        const { collection, recovered } = migrate(JSON.parse(raw));
        return { collection, recovered };
      } catch {
        return { collection: { schemaVersion: 1, workspaces: [] }, recovered: true };
      }
    } catch {
      return { collection: null, recovered: false };
    }
  }
}

/** Persist the collection durably. Structural actions (create/split/move/close)
 *  call this immediately; divider writes use the debounced variant. */
export function saveDurableWorkspaces(c: WorkspaceCollection): void {
  void saveSetting(DURABLE_KEY, JSON.stringify(encodeCollection(c)));
}

/** Debounced durable write, for high-frequency updates like divider dragging.
 *  Coalesces a burst of writes into one trailing-edge persist. */
export function saveDurableWorkspacesDebounced(c: WorkspaceCollection, delayMs = 300): void {
  saveSettingDebounced(DURABLE_KEY, JSON.stringify(encodeCollection(c)), delayMs);
}

/** The cache and durable keys, exposed for tests and for the store's
 *  reconciliation logic. */
export const WORKSPACES_CACHE_KEY = CACHE_KEY;
export const WORKSPACES_DURABLE_KEY = DURABLE_KEY;

import { create } from "zustand";
import { isDesktopHost } from "@/platform";

/** Feature flag for the custom-workspaces feature.

 *  Workspaces ship enabled by default. The flag still lives in localStorage
 *  so a user can turn it off from Settings → General, and so the feature can
 *  be rolled back without a code change if a regression appears. The catalog
 *  and PageHost are always active; they are the seam the feature is built on,
 *  not the feature itself.
 *
 *  The flag lives in a zustand store (not a plain function reading
 *  localStorage during render) so toggling it from the Settings page
 *  re-renders the sidebar live, instead of requiring a reload. The store is
 *  initialized from localStorage once at module load and kept in sync on
 *  every `setEnabled` call. */
const WORKSPACES_FLAG_KEY = "tanwords_workspaces_enabled_v1";

/** The localStorage key the flag lives under. Exported so tests can reset
 *  it between cases without hard-coding the string in two places. */
export const WORKSPACES_FLAG_STORAGE_KEY = WORKSPACES_FLAG_KEY;

function readInitial(): boolean {
  try {
    // Absent key → enabled by default. A user who turns it off sets "0"; that
    // choice is respected across restarts.
    const raw = localStorage.getItem(WORKSPACES_FLAG_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

interface WorkspaceFlagState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useWorkspaceFlag = create<WorkspaceFlagState>((set) => ({
  enabled: readInitial(),
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(WORKSPACES_FLAG_KEY, enabled ? "1" : "0");
    } catch {
      // localStorage unavailable — keep the in-memory state only.
    }
    set({ enabled });
  },
}));

/** Reactive hook: true when the workspaces feature is enabled. Components
 *  that gate workspace UI on this re-render when the flag toggles. */
export function useWorkspacesEnabled(): boolean {
  const enabled = useWorkspaceFlag((s) => s.enabled);
  return isDesktopHost && enabled;
}

/** Imperative read for non-React code paths (e.g. capability checks that run
 *  outside a component). Reads the live store value, which is kept in sync
 *  with localStorage. */
export function isWorkspacesEnabled(): boolean {
  return isDesktopHost && useWorkspaceFlag.getState().enabled;
}

/** Imperative write for code paths that set the flag outside a component
 *  (e.g. tests, a CLI seed). Mirrors the Settings toggle's effect. */
export function setWorkspacesEnabled(enabled: boolean): void {
  useWorkspaceFlag.getState().setEnabled(enabled);
}

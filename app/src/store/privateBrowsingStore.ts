import { create } from "zustand";
import { isDesktopHost } from "@/platform";
import { invoke } from "@/ipc/backend";
import { subscribeAll } from "@/ipc/events";

/** Whole-browser private-mode toggle, shared by the full-page Browser and
 *  the floating overlay (see PRIVATE_PARTITION's doc in
 *  app/electron/main/browserPanel.ts). Not persisted — like the rest of this
 *  feature's session-only pieces, it resets to off on every launch. New tabs
 *  opened while `enabled` use an in-memory-only session (never recorded to
 *  history, never written to disk); tabs already open when it's toggled are
 *  unaffected either way. */
interface PrivateBrowsingState {
  enabled: boolean;
  toggle: () => void;
}

export const usePrivateBrowsingStore = create<PrivateBrowsingState>((set, get) => ({
  enabled: false,
  toggle: () => {
    const next = !get().enabled;
    set({ enabled: next });
    void invoke("browser_set_private_mode", { enabled: next }).catch(() => {});
  },
}));

// The popout window (a separate renderer, own module instance of this store)
// and the main window both need to reflect a toggle triggered from either
// side — same module-level-subscription pattern as floatingBrowserStore's
// status sync.
if (isDesktopHost) {
  subscribeAll({
    "browser:privateModeChanged": (payload: { enabled: boolean }) => {
      usePrivateBrowsingStore.setState({ enabled: payload.enabled });
    },
  });
}

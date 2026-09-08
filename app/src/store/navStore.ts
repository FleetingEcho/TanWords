import { create } from "zustand";
import { hostCapabilities, isWebHost } from "@/platform";

export type NavPage =
  | "dashboard"
  | "calendar"
  | "feeds"
  | "reading"
  | "music"
  | "vocabulary"
  | "documents"
  | "chat"
  | "browser"
  | "terminal"
  | "tools"
  | "dsh"
  | "settings";

/** Section ids the Settings page can be jumped to directly, e.g. from the
 *  cloud-DB status icon (-> "data"). Kept as plain strings here rather than
 *  importing SettingsPage's SectionId, so navStore doesn't depend on it. */
export type SettingsSection = "general" | "providers" | "learning" | "tts" | "voice" | "mcp" | "documents" | "terminal" | "dsh" | "data";

/** The active destination is either a built-in full page or a user-created
 *  workspace. Discriminated so the shell (`MainLayout`) can mark either kind
 *  active, render the workspace section, and expose built-in pages as drag
 *  sources in Edit mode — without overloading `page` (which the many
 *  `navigate(page)` callers and the `currentPage()` selectors still read as
 *  "the full page that would render if no workspace were open").
 *
 *  - `page`: ordinary full-page navigation. `page` is also set to the same
 *    value so legacy `currentPage()` checks ("am I on the chat page?")
 *    keep working.
 *  - `workspace`: a custom workspace is the active screen. `page` retains
 *    its last full-page value, so leaving the workspace (via `navigate`)
 *    resumes that page without a separate "last page" field. */
export type NavDestination =
  | { kind: "page"; page: NavPage }
  | { kind: "workspace"; workspaceId: string };

/* ---- URL hash sync (web host only) -------------------------------------
 * The shell predates the web version and keeps navigation in memory, which is
 * invisible on the desktop (the window never reloads). In a browser it made a
 * refresh land back on Dashboard and turned the back button into "leave the
 * app". Syncing the top-level page to `#/<page>` fixes both: the store
 * initializer consumes the hash at load, `navigate` writes it (a history
 * entry per page, so back walks pages), and `hashchange` adopts back/forward
 * and manual edits. Overlay state (settings, word detail, chat session) and
 * workspaces stay out of the URL on purpose.
 * ---------------------------------------------------------------------- */

const HASHABLE_PAGES: readonly NavPage[] = [
  "dashboard", "calendar", "feeds", "reading", "music", "vocabulary",
  "documents", "chat", "browser", "terminal", "tools", "dsh",
];

/** Pages a host cannot render fall back to Dashboard instead of restoring
 *  into a blank screen — web builds have no terminal/dsh/browser/music. */
function hostCanRender(page: NavPage): boolean {
  switch (page) {
    case "browser": return hostCapabilities.browser;
    case "music": return hostCapabilities.music;
    case "terminal": return hostCapabilities.terminal;
    case "dsh": return hostCapabilities.dsh;
    default: return true;
  }
}

/** The page named by the current URL hash, or null when the hash is absent,
 *  unknown, or names a page this host cannot render. */
export function pageFromHash(): NavPage | null {
  if (!isWebHost || typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!(HASHABLE_PAGES as readonly string[]).includes(raw)) return null;
  const page = raw as NavPage;
  return hostCanRender(page) ? page : null;
}

function syncHash(page: NavPage): void {
  if (!isWebHost || typeof window === "undefined") return;
  const target = `#/${page}`;
  if (window.location.hash !== target) window.location.hash = target;
}

interface NavState {
  page: NavPage;
  wordId?: number;
  sentenceId?: number;
  settingsSection?: SettingsSection;
  /** Settings is an overlay, not a page destination, so opening it preserves
   *  the current page or workspace underneath. */
  settingsOpen: boolean;
  /** Session the chat page should open on mount — set by openChatSession
   *  (e.g. the AI chat modal's expand button), cleared by ordinary navigate. */
  chatSessionId?: string;
  /** The active workspace id, or `null` when a full page is active. Set by
   *  `openWorkspace`; cleared by `navigate` (which resumes full-page mode). */
  activeWorkspaceId: string | null;

  currentPage: () => NavPage;
  currentWordId: () => number | undefined;
  currentSentenceId: () => number | undefined;
  /** The active destination. `page` when no workspace is open, `workspace`
   *  when one is. The shell reads this to decide what to render. */
  currentDestination: () => NavDestination;

  navigate: (page: NavPage, wordId?: number, settingsSection?: SettingsSection) => void;
  closeSettings: () => void;
  openVocabularySentence: (sentenceId: number) => void;
  openVocabularyPatterns: () => void;
  openChatSession: (sessionId?: string) => void;
  /** Activate a custom workspace as the current screen. Clears any full-page
   *  selection; `page` keeps its last value so a later `navigate` resumes it. */
  openWorkspace: (workspaceId: string) => void;
  /** Leave the active workspace without changing the remembered full page.
   *  Used by the workspace screen's "back" control. */
  closeWorkspace: () => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  page: pageFromHash() ?? "dashboard",
  wordId: undefined,
  sentenceId: undefined,
  settingsSection: undefined,
  settingsOpen: false,
  chatSessionId: undefined,
  activeWorkspaceId: null,

  currentPage: () => get().page,
  currentWordId: () => get().wordId,
  currentSentenceId: () => get().sentenceId,
  currentDestination: () => {
    const s = get();
    return s.activeWorkspaceId
      ? { kind: "workspace", workspaceId: s.activeWorkspaceId }
      : { kind: "page", page: s.page };
  },

  navigate: (page, wordId, settingsSection) => {
    if (page === "settings") {
      set({ settingsOpen: true, settingsSection });
      return;
    }
    set({
      page, wordId, sentenceId: undefined, settingsSection: undefined, settingsOpen: false,
      chatSessionId: undefined, activeWorkspaceId: null,
    });
    syncHash(page);
  },
  closeSettings: () => set({ settingsOpen: false, settingsSection: undefined }),
  openVocabularySentence: (sentenceId) => set({ page: "vocabulary", wordId: undefined, sentenceId, settingsSection: undefined, settingsOpen: false, chatSessionId: undefined, activeWorkspaceId: null }),
  openVocabularyPatterns: () => set({ page: "vocabulary", wordId: undefined, sentenceId: 0, settingsSection: undefined, settingsOpen: false, chatSessionId: undefined, activeWorkspaceId: null }),
  openChatSession: (sessionId) => set({ page: "chat", wordId: undefined, sentenceId: undefined, settingsSection: undefined, settingsOpen: false, chatSessionId: sessionId, activeWorkspaceId: null }),
  openWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId, settingsOpen: false, settingsSection: undefined }),
  closeWorkspace: () => set({ activeWorkspaceId: null }),
}));

if (isWebHost && typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const page = pageFromHash();
    // Writing the hash inside navigate would push a duplicate history entry,
    // but by the time this runs the hash already names `page`, so the write
    // is a no-op. Unknown hashes (cleared URL, garbage) keep the current page.
    if (page && page !== useNavStore.getState().page) useNavStore.getState().navigate(page);
  });
}

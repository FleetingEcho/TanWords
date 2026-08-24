import { create } from "zustand";

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

interface NavState {
  page: NavPage;
  wordId?: number;
  sentenceId?: number;
  settingsSection?: SettingsSection;
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
  page: "dashboard",
  wordId: undefined,
  sentenceId: undefined,
  settingsSection: undefined,
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

  navigate: (page, wordId, settingsSection) => set({
    page, wordId, sentenceId: undefined, settingsSection, chatSessionId: undefined,
    activeWorkspaceId: null,
  }),
  openVocabularySentence: (sentenceId) => set({ page: "vocabulary", wordId: undefined, sentenceId, settingsSection: undefined, chatSessionId: undefined, activeWorkspaceId: null }),
  openVocabularyPatterns: () => set({ page: "vocabulary", wordId: undefined, sentenceId: 0, settingsSection: undefined, chatSessionId: undefined, activeWorkspaceId: null }),
  openChatSession: (sessionId) => set({ page: "chat", wordId: undefined, sentenceId: undefined, settingsSection: undefined, chatSessionId: sessionId, activeWorkspaceId: null }),
  openWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),
  closeWorkspace: () => set({ activeWorkspaceId: null }),
}));

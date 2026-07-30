import { create } from "zustand";

export type NavPage =
  | "dashboard"
  | "feeds"
  | "reading"
  | "music"
  | "vocabulary"
  | "documents"
  | "chat"
  | "browser"
  | "settings";

/** Section ids the Settings page can be jumped to directly, e.g. from the
 *  cloud-DB status icon (-> "data"). Kept as plain strings here rather than
 *  importing SettingsPage's SectionId, so navStore doesn't depend on it. */
export type SettingsSection = "general" | "providers" | "learning" | "tts" | "mcp" | "documents" | "data";

interface NavState {
  page: NavPage;
  wordId?: number;
  sentenceId?: number;
  settingsSection?: SettingsSection;
  /** Session the chat page should open on mount — set by openChatSession
   *  (e.g. the AI chat modal's expand button), cleared by ordinary navigate. */
  chatSessionId?: string;

  currentPage: () => NavPage;
  currentWordId: () => number | undefined;
  currentSentenceId: () => number | undefined;

  navigate: (page: NavPage, wordId?: number, settingsSection?: SettingsSection) => void;
  openVocabularySentence: (sentenceId: number) => void;
  openChatSession: (sessionId?: string) => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  page: "dashboard",
  wordId: undefined,
  sentenceId: undefined,
  settingsSection: undefined,
  chatSessionId: undefined,

  currentPage: () => get().page,
  currentWordId: () => get().wordId,
  currentSentenceId: () => get().sentenceId,

  navigate: (page, wordId, settingsSection) => set({ page, wordId, sentenceId: undefined, settingsSection, chatSessionId: undefined }),
  openVocabularySentence: (sentenceId) => set({ page: "vocabulary", wordId: undefined, sentenceId, settingsSection: undefined, chatSessionId: undefined }),
  openChatSession: (sessionId) => set({ page: "chat", wordId: undefined, sentenceId: undefined, settingsSection: undefined, chatSessionId: sessionId }),
}));

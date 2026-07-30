import type {
  Theme, SidebarTabId, TopBarItemId, RssTabSelection, DashboardWidgetLayout, BannerPosition,
} from "./types";

export interface SettingsState {
  theme: Theme;
  defaultAiProvider: string;
  uiLanguage: string;
  /** CEFR levels the AI calibrates to — multi-select, e.g. ["C1","C2"]. */
  targetLevels: string[];
  /** Show compact A2–C2 badges throughout the UI. */
  showLevelBadges: boolean;
  /** User override for the word-enrichment system prompt. Empty string = use the built-in default. */
  customEnrichPrompt: string;
  /** Root folder of the local music library. Empty string = not configured. */
  musicFolderPath: string;
  ttsModelPath: string;
  ttsVoiceId: string;
  ttsExtraDirs: string[];
  ttsSpeed: number;
  /** Show the project GitHub link in the sidebar footer. */
  showGithubLink: boolean;
  /** Pop the lookup/translate/save toolbar over selected English text. Off
   *  means selecting text does nothing special, anywhere in the app. */
  selectionActions: boolean;
  /** Main navigation tabs visible in the sidebar. Settings is always visible. */
  visibleSidebarTabs: SidebarTabId[];
  /** Order of the Dashboard's draggable widget cards across its two columns. */
  dashboardWidgetLayout: DashboardWidgetLayout;
  /** User-selected controls visible in the global command bar. */
  visibleTopBarItems: TopBarItemId[];
  /** RSS feed tab selected by default when opening Feeds — "all" or a specific feed's id.
   *  Lets a user who mainly reads one source (e.g. Hacker News) skip loading every channel. */
  defaultRssTab: RssTabSelection;
  /** Card = magazine layout with cover art; list = dense one-line-per-entry, for feeds with many items. */
  feedsViewMode: "card" | "list";
  /** User's custom avatar as a data URL, shown in place of the default icon in chat bubbles etc. Empty = default icon. */
  userAvatar: string;
  /** Custom banner image (data URL) shown at the top of the Dashboard page. Empty = no banner.
   *  Stored whole rather than pre-cropped, so its framing stays adjustable and stays
   *  correct however wide the window makes the banner. */
  dashboardBanner: string;
  /** Which band of `dashboardBanner` the user dragged into view. */
  dashboardBannerPosition: BannerPosition;
  /** Shown in the Dashboard greeting ("Good evening, {nickname}"). Empty = just "Good evening". */
  nickname: string;
  /** Custom full-app background image (data URL). Empty = none — just the theme's flat background. */
  appBackgroundImage: string;
  /** Blur radius in px applied to appBackgroundImage. */
  appBackgroundBlur: number;
  /** Whether appBackgroundImage is currently shown. False hides it without
   *  discarding the stored image, so it can be turned back on unchanged. */
  appBackgroundVisible: boolean;
  /** Body font size, in pixels, for full-size BlockNote document editors. */
  documentFontSize: number;
  /** Line-height multiplier for full-size BlockNote document editors. */
  documentLineHeight: number;
  /** Optional body text colour for full-size document editors. Empty uses the
   * active theme's foreground colour. */
  documentTextColor: string;
  /** Hex colour (`#rrggbb`) for `==highlighted==` spans in AI-written markdown.
   *  Applied as a CSS custom property, so nothing that renders a highlight has
   *  to know this setting exists. */
  highlightColor: string;
  isLoaded: boolean;

  setTheme: (theme: Theme) => void;
  setDefaultAiProvider: (provider: string) => void;
  setUiLanguage: (lang: string) => void;
  setTargetLevels: (levels: string[]) => void;
  setShowLevelBadges: (visible: boolean) => void;
  setCustomEnrichPrompt: (prompt: string) => void;
  setMusicFolderPath: (path: string) => void;
  setTtsModelPath: (path: string) => void;
  setTtsVoiceId: (id: string) => void;
  setTtsExtraDirs: (dirs: string[]) => void;
  setTtsSpeed: (speed: number) => void;
  setShowGithubLink: (v: boolean) => void;
  setSelectionActions: (v: boolean) => void;
  setSidebarTabVisible: (tab: SidebarTabId, visible: boolean) => void;
  setDashboardWidgetLayout: (layout: DashboardWidgetLayout) => void;
  setTopBarItemVisible: (item: TopBarItemId, visible: boolean) => void;
  setDefaultRssTab: (tab: RssTabSelection) => void;
  setFeedsViewMode: (mode: "card" | "list") => void;
  setUserAvatar: (dataUrl: string) => void;
  /** Omitting `position` re-centres — a new image arrives without a framing, and
   *  clearing the banner should not leave a stale one behind. */
  setDashboardBanner: (dataUrl: string, position?: BannerPosition) => void;
  setNickname: (name: string) => void;
  setAppBackgroundImage: (dataUrl: string) => void;
  setAppBackgroundBlur: (px: number) => void;
  setAppBackgroundVisible: (visible: boolean) => void;
  setDocumentFontSize: (px: number) => void;
  setDocumentLineHeight: (value: number) => void;
  setDocumentTextColor: (hex: string) => void;
  setHighlightColor: (hex: string) => void;
  loadFromDB: () => Promise<void>;
}

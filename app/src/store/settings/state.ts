import type {
  Theme, SidebarTabId, TopBarItemId, RssTabSelection, BannerPosition, LayoutMode,
  TerminalEngine, TerminalRenderer, TerminalColorScheme,
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
  /** User-selected controls visible in the global command bar. */
  visibleTopBarItems: TopBarItemId[];
  /** Responsive layout mode. Flexible adapts the shell and pages to narrow
   * viewports; fixed keeps the classic desktop chrome on wide screens. */
  layoutMode: LayoutMode;
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
  /** Up to five saved app wallpapers. `appBackgroundImage` is always the
   *  currently selected member, kept separately for simple rendering. */
  appBackgroundImages: string[];
  appBackgroundImageIndex: number;
  /** Framing for each saved wallpaper plus the currently active framing. */
  appBackgroundImagePositions: BannerPosition[];
  appBackgroundImagePosition: BannerPosition;
  /** Blur radius in px applied to appBackgroundImage. */
  appBackgroundBlur: number;
  /** Black readability layer over the wallpaper, as a percentage. Zero shows
   *  the stored image without contrast reduction. */
  appBackgroundDimming: number;
  /** The lock screen's own wallpaper — a separate picture from the app
   *  canvas, configured with the same controls. */
  lockScreenImage: string;
  lockScreenBlur: number;
  lockScreenVisible: boolean;
  /** Minutes of no input before the app locks itself; `0` disables it. Only
   *  has any effect while a lock password is set. */
  autoLockMinutes: number;
  /** Whether appBackgroundImage is currently shown. False hides it without
   *  discarding the stored image, so it can be turned back on unchanged. */
  appBackgroundVisible: boolean;
  /** Block ads and trackers in the embedded Browser page (desktop only —
   *  web-mode iframes can't be intercepted). Defaults on. The toggle button
   *  lives in the Browser page toolbar. */
  browserAdBlockEnabled: boolean;
  /** Glass appearance used when the Terminal transparency toggle is enabled. */
  terminalTransparent: boolean;
  terminalBackgroundBlur: number;
  terminalBackgroundOpacity: number;
  /** Hex (`#rrggbb`) fill colour for the terminal pane — the solid background
   *  when glass is off, and the tint colour (at `terminalBackgroundOpacity`)
   *  when glass is on. Defaults to Tokyo Night. */
  terminalBackgroundColor: string;
  /** Default foreground for terminal cells that do not specify an ANSI colour. */
  terminalTextColor: string;
  terminalColorScheme: TerminalColorScheme;
  /** User-authored appearance retained while a built-in preset is active. */
  terminalCustomAppearance: import("./types").TerminalCustomAppearance;
  /** Parser/renderer implementation captured by each new terminal tab. */
  terminalEngine: TerminalEngine;
  /** Rendering backend. Auto avoids WebGL's transparent dim-text artifacts. */
  terminalRenderer: TerminalRenderer;
  /** Local font family name, or ui-monospace for the operating-system default. */
  terminalFontFamily: string;
  terminalFontSize: number;
  /** Default xterm glyph weight, in CSS's 100–900 scale. */
  terminalFontWeight: number;
  /** Device-local executable override. Empty lets TanWords select the platform default. */
  terminalShellPath: string;
  /** Body font size, in pixels, for full-size document editors. */
  documentFontSize: number;
  /** Line-height multiplier for full-size document editors. */
  documentLineHeight: number;
  /** Vertical gap between top-level blocks (paragraphs, headings, …) in
   *  full-size document editors, in `em`. */
  documentParagraphSpacing: number;
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
  setTopBarItemVisible: (item: TopBarItemId, visible: boolean) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setDefaultRssTab: (tab: RssTabSelection) => void;
  setFeedsViewMode: (mode: "card" | "list") => void;
  setUserAvatar: (dataUrl: string) => void;
  /** Omitting `position` re-centres — a new image arrives without a framing, and
   *  clearing the banner should not leave a stale one behind. */
  setDashboardBanner: (dataUrl: string, position?: BannerPosition) => void;
  setNickname: (name: string) => void;
  setAppBackgroundImage: (dataUrl: string) => void;
  setAppBackgroundImages: (images: string[], activeIndex: number, positions?: BannerPosition[]) => void;
  setLockScreenImage: (dataUrl: string) => void;
  setLockScreenBlur: (value: number) => void;
  setLockScreenVisible: (value: boolean) => void;
  setAutoLockMinutes: (minutes: number) => void;
  setAppBackgroundBlur: (px: number) => void;
  setAppBackgroundDimming: (percent: number) => void;
  setAppBackgroundVisible: (visible: boolean) => void;
  setBrowserAdBlockEnabled: (enabled: boolean) => void;
  setTerminalTransparent: (enabled: boolean) => void;
  setTerminalBackgroundBlur: (px: number) => void;
  setTerminalBackgroundOpacity: (percent: number) => void;
  setTerminalBackgroundColor: (hex: string) => void;
  setTerminalTextColor: (hex: string) => void;
  setTerminalColorScheme: (scheme: TerminalColorScheme) => void;
  setTerminalEngine: (engine: TerminalEngine) => void;
  setTerminalRenderer: (renderer: TerminalRenderer) => void;
  setTerminalFontFamily: (family: string) => void;
  setTerminalFontSize: (px: number) => void;
  setTerminalFontWeight: (weight: number) => void;
  setTerminalShellPath: (path: string) => void;
  setDocumentFontSize: (px: number) => void;
  setDocumentLineHeight: (value: number) => void;
  setDocumentParagraphSpacing: (value: number) => void;
  setDocumentTextColor: (hex: string) => void;
  setHighlightColor: (hex: string) => void;
  loadFromDB: () => Promise<void>;
}

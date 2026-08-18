import type { NavPage } from "@/store/navStore";

export type Theme =
  | "light"
  | "dark"
  | "catppuccin-latte"
  | "catppuccin-mocha"
  | "dracula"
  | "tokyo-night"
  | "tokyo-night-day"
  | "tokyo-night-storm"
  | "dim"
  | "system";
export type SidebarTabId = Exclude<NavPage, "settings">;
export type TopBarItemId = "search" | "scratch" | "dsh" | "terminal" | "db" | "tools" | "browser" | "mcp" | "ai" | "language" | "theme" | "updates" | "github";
export type LayoutMode = "flexible" | "fixed";
export type TerminalRenderer = "auto" | "webgl" | "dom";
/** Which terminal library renders a tab's screen. `restty` (the default) is
 *  a WASM/WebGPU-WebGL2 engine — still labeled "Experimental" in the UI and
 *  missing in-terminal search, inline images, and background blur/opacity
 *  (see TerminalToolRestty.tsx). `xterm` is the older, fully-featured engine,
 *  kept selectable as a fallback for anyone who needs those. */
export type TerminalEngine = "xterm" | "restty";
export const TERMINAL_COLOR_SCHEME_IDS = [
  "tokyo-night", "dracula", "nord", "catppuccin-mocha", "high-contrast", "custom",
] as const;
export type TerminalColorScheme = typeof TERMINAL_COLOR_SCHEME_IDS[number];
export interface TerminalCustomAppearance {
  backgroundColor: string;
  textColor: string;
  transparent: boolean;
  blur: number;
  opacity: number;
}

/** Feeds page tab selector: a specific RSS feed, "all" of them, or the native Hacker News browser. */
export type RssTabSelection = number | "all" | "hackernews";

export const DEFAULT_SIDEBAR_TABS: SidebarTabId[] = [
  "dashboard", "calendar", "feeds", "reading", "documents", "vocabulary", "chat", "music", "browser", "terminal", "dsh", "tools",
];
export const DEFAULT_TOPBAR_ITEMS: TopBarItemId[] = [
  "search", "scratch", "tools", "browser", "dsh", "terminal", "db", "mcp", "ai", "language", "theme", "updates", "github",
];
export const DEFAULT_LAYOUT_MODE: LayoutMode = "flexible";

/** Amber, matching the emphasis colour word notes used before highlights had
 *  their own `==` syntax. Kept in sync with the fallback in index.css. */
export const DEFAULT_HIGHLIGHT_COLOR = "#d97706";
export const DOCUMENT_TEXT_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Mid-tone hues that stay legible as a translucent wash in both themes. */
export const HIGHLIGHT_PRESETS = ["#d97706", "#eab308", "#22c55e", "#0ea5e9", "#8b5cf6", "#ec4899"] as const;

/** Idle minutes before the app locks itself, `0` meaning never. Offered as a
 *  short list rather than a free number: the useful answers are "when I go for
 *  coffee" and "when I leave for the day", and both are coarse. */
export const AUTO_LOCK_CHOICES = [0, 10, 20, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 0;
/** DSH Web host port. `0` uses DSH's standard loopback port 3080 (the default)
 *  and reuses an existing host there; a non-zero value pins the supervised
 *  host to a custom port for external tools or firewall rules. */
export const DEFAULT_DSH_PORT = 0;
/** DSH background appearance. Opacity is a percentage; blur is a 0–100
 *  strength that the renderer maps to a safe backdrop-blur radius. */
export const DEFAULT_DSH_BACKGROUND_OPACITY = 100;
export const DEFAULT_DSH_BACKGROUND_BLUR = 0;
/** Whether the DSH page shows its own toolbar (DSH label, Restart, Reload,
 *  Open-external). Hidden by default so the embedded agent UI gets the full
 *  height; the Restart/Reload/Open-external actions are rarely needed day to
 *  day, and the toolbar reappears when the user enables it in Settings. */
export const DEFAULT_DSH_TOOLBAR_VISIBLE = false;
/** Minutes the DSH page must sit hidden (and idle — no session running) before
 *  the host auto-stops to free the Node/pnpm process it's running as. `0`
 *  disables this. 10 is the floor, not just the smallest offered choice: below
 *  that, a quick tab-away-and-back would keep respawning the host, which costs
 *  more (a fresh Node/pnpm boot) than the idle process it was meant to save. */
export const DSH_IDLE_STOP_CHOICES = [0, 10, 20, 30, 60, 120] as const;
export const DEFAULT_DSH_IDLE_STOP_MINUTES = 0;
/** Global (OS-wide) shortcut that jumps straight to the DSH page, in Electron
 *  accelerator syntax (e.g. `CommandOrControl+Shift+D`). Empty disables it —
 *  there is no default binding, since claiming a system-wide combo without
 *  the user asking for one risks colliding with something they already use
 *  elsewhere. */
export const DEFAULT_DSH_GLOBAL_SHORTCUT = "";
export const DEFAULT_TERMINAL_BACKGROUND_BLUR = 16;
// Only "custom" ever renders translucent — see `effectiveTransparent` in
// TerminalTool.tsx, which ignores opacity entirely for every other preset.
// This default backs those opaque presets (and a fresh, not-yet-transparent
// Custom), so the number shown next to the slider matches what's actually on
// screen instead of implying a glass effect that isn't there.
export const DEFAULT_TERMINAL_BACKGROUND_OPACITY = 100;
export const DEFAULT_TERMINAL_TRANSPARENT = false;
export const DEFAULT_TERMINAL_RENDERER: TerminalRenderer = "auto";
export const DEFAULT_TERMINAL_ENGINE: TerminalEngine = "restty";
/** Tokyo Night is the default retained dark preset. */
export const DEFAULT_TERMINAL_BACKGROUND_COLOR = "#1a1b26";
export const DEFAULT_TERMINAL_TEXT_COLOR = "#c0caf5";
export const DEFAULT_TERMINAL_COLOR_SCHEME: TerminalColorScheme = "tokyo-night";
export const DEFAULT_TERMINAL_CUSTOM_APPEARANCE: TerminalCustomAppearance = {
  backgroundColor: DEFAULT_TERMINAL_BACKGROUND_COLOR,
  textColor: DEFAULT_TERMINAL_TEXT_COLOR,
  transparent: DEFAULT_TERMINAL_TRANSPARENT,
  blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
  opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
};
export const TERMINAL_COLOR_SCHEME_COLORS: Record<Exclude<TerminalColorScheme, "custom">, {
  background: string;
  foreground: string;
}> = {
  "tokyo-night": { background: "#1a1b26", foreground: "#c0caf5" },
  dracula: { background: "#282a36", foreground: "#f8f8f2" },
  nord: { background: "#2e3440", foreground: "#d8dee9" },
  "catppuccin-mocha": { background: "#1e1e2e", foreground: "#cdd6f4" },
  "high-contrast": { background: "#000000", foreground: "#ffffff" },
};

/** Built-in schemes own their complete glass treatment. Custom appearance
 * values are restored only when the explicit Custom scheme is selected. */
export const TERMINAL_COLOR_SCHEME_EFFECTS: Record<Exclude<TerminalColorScheme, "custom">, Pick<
  TerminalCustomAppearance,
  "transparent" | "blur" | "opacity"
>> = {
  "tokyo-night": {
    transparent: DEFAULT_TERMINAL_TRANSPARENT,
    blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
    opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  },
  dracula: {
    transparent: DEFAULT_TERMINAL_TRANSPARENT,
    blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
    opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  },
  nord: {
    transparent: DEFAULT_TERMINAL_TRANSPARENT,
    blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
    opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  },
  "catppuccin-mocha": {
    transparent: DEFAULT_TERMINAL_TRANSPARENT,
    blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
    opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  },
  "high-contrast": {
    transparent: DEFAULT_TERMINAL_TRANSPARENT,
    blur: DEFAULT_TERMINAL_BACKGROUND_BLUR,
    opacity: DEFAULT_TERMINAL_BACKGROUND_OPACITY,
  },
};

/** Normalizes a hex colour to canonical `#rrggbb` lowercase, accepting CSS
 *  shorthand `#rgb` (and a bare `rgb`/`rrggbb` without the leading `#`). Returns
 *  the fallback (Tokyo Night by default) when the input is not a valid colour,
 *  so a corrupt stored or typed value never blanks the terminal. */
export function normalizeHexColor(
  raw: string,
  fallback: string = DEFAULT_TERMINAL_BACKGROUND_COLOR,
): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((raw ?? "").trim());
  if (!m) return fallback;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}
/** `ui-monospace` resolves to the desktop OS/browser's native monospace face. */
export const DEFAULT_TERMINAL_FONT_FAMILY = "ui-monospace";
export const DEFAULT_TERMINAL_FONT_SIZE = 16;
export const DEFAULT_TERMINAL_FONT_WEIGHT = 400;

/** xterm accepts the full CSS weight range. Snap arbitrary persisted or typed
 * values to actual 100-step font weights so the UI and renderer stay aligned. */
export function normalizeTerminalFontWeight(value: unknown): number {
  const weight = Number(value);
  if (!Number.isFinite(weight)) return DEFAULT_TERMINAL_FONT_WEIGHT;
  return Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
}

/** Which part of an image survives the crop into its frame, as CSS
 *  `object-position` percentages, plus how far zoomed in past the frame's own
 *  `object-fit: cover` minimum. The image itself is always stored whole —
 *  `scale` and position are applied live as CSS (`transform: scale(scale)`
 *  anchored at `x%,y%`, layered outside the existing object-position pan),
 *  never baked into pixels, so the crop is lossless and freely re-adjustable:
 *  there is no "quality loss from cropping" to guard against because no
 *  cropping ever actually happens to the stored bytes. `scale` is optional on
 *  the wire (older stored positions predate zoom) and always defaults to `1`
 *  — "just cover, no extra zoom" — when absent. */
export interface BannerPosition {
  x: number;
  y: number;
  scale?: number;
}

/** Minimum (`1`, i.e. plain `object-fit: cover`, the historical default) and
 *  maximum zoom offered by the position picker. The ceiling is deliberately
 *  modest — well past it, the frame is showing more magnified pixels than
 *  the source image has, which reads as soft/blurry rather than "zoomed in",
 *  the same tradeoff any raster image hits past 1:1. */
export const BANNER_ZOOM_MIN = 1;
export const BANNER_ZOOM_MAX = 3;

/** What a plain `object-fit: cover` does on its own: dead centre, no zoom. */
export const DEFAULT_BANNER_POSITION: BannerPosition = { x: 50, y: 50, scale: 1 };

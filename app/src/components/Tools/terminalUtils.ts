import type { ISearchOptions } from "@xterm/addon-search";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "@/store/settings/types";

// ── base64 helpers ─────────────────────────────────────────────────────────
export const encoder = new TextEncoder();

// The sandboxed renderer has no Node, so `Buffer` is undefined here and the
// hand-rolled loops below were the real path for every byte of PTY output. The
// ES base64 methods do the same work in one native call; Chromium ships them in
// the Electron this app targets. Feature-detect rather than assume: the same
// bundle runs in the web build, and `Uint8Array.fromBase64` is still recent.
const Base64Array = Uint8Array as unknown as {
  fromBase64?: (value: string) => Uint8Array;
};
const nativeToBase64 = (
  Uint8Array.prototype as unknown as { toBase64?: () => string }
).toBase64;

/** UTF-8 bytes → base64 (for the input direction). */
function b64FromBytes(bytes: Uint8Array): string {
  if (nativeToBase64) return nativeToBase64.call(bytes);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** base64 → raw UTF-8 bytes (for the output direction; xterm joins partials).
 *  This is the hot path: every chunk the daemon streams lands here, including
 *  the multi-MiB repaints a full-screen TUI can produce in a single frame. */
export function bytesFromB64(b64: string): Uint8Array {
  if (Base64Array.fromBase64) return Base64Array.fromBase64(b64);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Normalise terminal output crossing Electron's structured-clone boundary.
 * Current desktop builds send a Uint8Array directly, avoiding Base64's 33%
 * expansion and encode/decode allocations. Keep the string branch so a stale
 * preload/main process can finish an in-flight event during a hot reload. */
export function terminalOutputBytes(data: unknown): Uint8Array | null {
  if (typeof data === "string") return bytesFromB64(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

export function b64EncodeUtf8(s: string): string {
  return b64FromBytes(encoder.encode(s));
}

export type TerminalClipboard =
  | { kind: "text"; text: string }
  | { kind: "image"; path: string }
  | null;

export type ContextMenuPosition = { x: number; y: number; canCopy: boolean };

/** Escape a controlled local path as one POSIX-shell token. This also matches
 * the preferred Git Bash shell on Windows. */
export function quoteTerminalPath(filePath: string): string {
  return filePath.replace(/[^A-Za-z0-9_./-]/g, "\\$&");
}

/** Longest shell-reported title a tab will show. The tab strip truncates with
 *  CSS well before this; the cap only bounds what a shell can push into React
 *  state and into the rename dialog's initial draft. */
const MAX_SHELL_TITLE_LENGTH = 60;

/** Normalise an OSC 0/2 title into something worth putting on a tab.
 *
 *  Shells report wildly different things: bash's default is `user@host:~/dir`,
 *  zsh commonly reports the running command, and a TUI may push anything at
 *  all. Strip the `user@host:` prefix (constant across tabs, so it costs width
 *  without distinguishing anything) and drop control characters — the string
 *  reaches the DOM as a tab label. Over-long titles keep their *tail*, since
 *  the deepest directory or the command is the part that identifies the tab. */
export function shellTabTitle(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^[^\s@]+@[^\s:]+:\s*/, "")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length <= MAX_SHELL_TITLE_LENGTH) return cleaned;
  return `…${cleaned.slice(cleaned.length - (MAX_SHELL_TITLE_LENGTH - 1))}`;
}

const SYSTEM_MONOSPACE_STACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
export const TERMINAL_SCROLLBACK_LINES = 5_000;
export const HERDR_URL = "https://github.com/herdrdev/herdr";
// xterm parses writes asynchronously. Pause the PTY before its pending writes
// grow large enough to hurt input latency, then resume only after a meaningful
// amount has drained. Backpressure preserves every byte without requiring the
// full burst to sit in JS memory.
export const TERMINAL_OUTPUT_HIGH_WATER_BYTES = 384 * 1024;
export const TERMINAL_OUTPUT_LOW_WATER_BYTES = 128 * 1024;
export const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = 3;

export type TerminalRenderDimensions = {
  css: {
    canvas: { width: number; height: number };
    cell: { width: number; height: number };
  };
  device: {
    canvas: { width: number; height: number };
    cell: { width: number; height: number };
  };
};
/** The terminal palette.
 *
 *  Left unset, xterm falls back to Tango — GNOME Terminal's scheme, designed
 *  against pure black. This pane paints Tokyo Night (`rgb(26,27,38)`) or a
 *  translucent tint behind the glyphs instead, where Tango's black `#2e3436`
 *  and bright-black `#555753` (what most CLI tools use for dimmed and comment
 *  text) nearly vanish. These are Tokyo Night's own terminal colours, so the
 *  foreground is contrast-matched to the background it actually sits on.
 *
 *  `background` stays fully transparent on purpose: the surrounding element
 *  owns the fill so the glass controls can reveal the app wallpaper. WebGL's
 *  color parser reads the CSS keyword `transparent` as opaque black, so the
 *  alpha channel has to be explicit. */
export const TERMINAL_THEME = {
  background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5", cursorAccent: "#1a1b26",
  selectionBackground: "rgba(122, 162, 247, 0.40)", black: "#15161e", red: "#f7768e",
  green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7",
  cyan: "#7dcfff", white: "#a9b1d6", brightBlack: "#414868", brightRed: "#f7768e",
  brightGreen: "#9ece6a", brightYellow: "#e0af68", brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7", brightCyan: "#7dcfff", brightWhite: "#c0caf5",
} as const;

export const TERMINAL_THEMES = {
  "tokyo-night": TERMINAL_THEME,
  dracula: {
    background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#282a36",
    selectionBackground: "rgba(68, 71, 90, 0.65)", black: "#21222c", red: "#ff5555",
    green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6",
    cyan: "#8be9fd", white: "#f8f8f2", brightBlack: "#6272a4", brightRed: "#ff6e6e",
    brightGreen: "#69ff94", brightYellow: "#ffffa5", brightBlue: "#d6acff",
    brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
  },
  light: {
    background: "#f4f1ea", foreground: "#202124", cursor: "#202124", cursorAccent: "#f4f1ea",
    selectionBackground: "rgba(50, 105, 212, 0.24)", black: "#202124", red: "#b3261e",
    green: "#137333", yellow: "#765c00", blue: "#3269d4", magenta: "#8e44d6",
    cyan: "#007b83", white: "#4f5660", brightBlack: "#626a73", brightRed: "#c5221f",
    brightGreen: "#188038", brightYellow: "#8d6d00", brightBlue: "#1a73e8",
    brightMagenta: "#a142f4", brightCyan: "#008b9a", brightWhite: "#111318",
  },
  "high-contrast": {
    background: "#000000", foreground: "#ffffff", cursor: "#ffffff", cursorAccent: "#000000",
    selectionBackground: "rgba(38, 79, 120, 0.88)", black: "#000000", red: "#f48771",
    green: "#89d185", yellow: "#cca700", blue: "#75beff", magenta: "#d670d6",
    cyan: "#00b7c3", white: "#ffffff", brightBlack: "#808080", brightRed: "#ff8b7b",
    brightGreen: "#b5e8b0", brightYellow: "#ffd700", brightBlue: "#9cdcfe",
    brightMagenta: "#e89be8", brightCyan: "#4ec9b0", brightWhite: "#ffffff",
  },
} as const;

export function terminalThemeFor(scheme: import("@/store/settings/types").TerminalColorScheme) {
  return scheme === "custom" ? TERMINAL_THEME : TERMINAL_THEMES[scheme];
}

/** Splits a `#rrggbb` (or `#rgb`) colour into its numeric channels. Falls
 *  back to Tokyo Night if the hex is malformed, so a corrupt stored value
 *  never blanks the terminal behind the glyphs. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return { r: 13, g: 17, b: 23 };
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** CSS colour for the terminal pane's glass tint: the user-chosen background
 *  colour at the given opacity percent (0–100). Used when transparent mode is
 *  on; solid mode applies the hex directly. */
export function terminalBackgroundRgba(hex: string, opacityPercent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.min(100, Math.max(0, opacityPercent)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const SEARCH_DECORATIONS: NonNullable<ISearchOptions["decorations"]> = {
  matchBackground: "#5f4a18",
  matchBorder: "#c99b26",
  matchOverviewRuler: "#c99b26",
  activeMatchBackground: "#b85f14",
  activeMatchBorder: "#ffd166",
  activeMatchColorOverviewRuler: "#ffd166",
};

export function terminalSearchOptions(caseSensitive: boolean, incremental = false): ISearchOptions {
  return {
    caseSensitive,
    incremental,
    decorations: SEARCH_DECORATIONS,
  };
}

/** A selected local face stays first, with the machine's native monospace as
 * fallback. Escaping quotes/backslashes keeps arbitrary local family names a
 * single valid CSS font-family token. */
export function terminalFontStack(family: string): string {
  if (!family || family === DEFAULT_TERMINAL_FONT_FAMILY) return SYSTEM_MONOSPACE_STACK;
  const escaped = family.replace(/(["\\])/g, "\\$1");
  return `"${escaped}", ${SYSTEM_MONOSPACE_STACK}`;
}

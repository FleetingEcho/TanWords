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
// Full-screen TUIs such as Herdr can legitimately repaint several MiB while
// xterm is still completing its first asynchronous write. Keep that finite
// startup intact while retaining a hard bound for genuinely runaway output.
export const MAX_PENDING_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = 3;
/** The terminal palette.
 *
 *  Left unset, xterm falls back to Tango — GNOME Terminal's scheme, designed
 *  against pure black. This pane paints GitHub-dark (`rgb(13,17,23)`) or a
 *  translucent tint behind the glyphs instead, where Tango's black `#2e3436`
 *  and bright-black `#555753` (what most CLI tools use for dimmed and comment
 *  text) nearly vanish. These are GitHub Dark's own terminal colours, so the
 *  foreground is contrast-matched to the background it actually sits on.
 *
 *  `background` stays fully transparent on purpose: the surrounding element
 *  owns the fill so the glass controls can reveal the app wallpaper. WebGL's
 *  color parser reads the CSS keyword `transparent` as opaque black, so the
 *  alpha channel has to be explicit. */
export const TERMINAL_THEME = {
  background: "rgba(0, 0, 0, 0)",
  foreground: "#c9d1d9",
  cursor: "#c9d1d9",
  cursorAccent: "#0d1117",
  // Selection must pass the glyphs through; xterm blends this over the text.
  selectionBackground: "rgba(56, 139, 253, 0.40)",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#ffffff",
} as const;

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

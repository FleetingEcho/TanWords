/** restty terminal engine support, extracted from `TerminalToolRestty.tsx`:
 *  the PTY-IPC transport, font resolution, and theme conversion. The
 *  component file now holds only layout + appearance; this module is the
 *  front half of the local shell (the daemon `tanwords-pty` is the back
 *  half — see electron/main/terminal.ts). Moved verbatim — see
 *  `TerminalToolRestty.tsx`'s header for the design rationale (why a
 *  `PtyTransport` instead of manual write/onData, why Local Font Access
 *  is dropped on the web build, why restty's theme colors are 0-255 RGBA). */
import type { GhosttyTheme, PtyCallbacks, PtyConnectOptions, PtyTransport, ResttyFontInput } from "restty";
import type { ThemeColor } from "restty/internal";
import { subscribe } from "@/ipc/events";
import { callMain } from "@/ipc/host";
import { isDesktopHost } from "@/platform";
import {
  TERMINAL_OUTPUT_HIGH_WATER_BYTES,
  b64EncodeUtf8,
  hexToRgb,
  terminalOutputBytes,
  terminalThemeFor,
} from "./terminalUtils";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "@/store/settings/types";

/** Component-facing lifecycle hooks — separate from restty's own `PtyCallbacks`
 *  (which the transport must also satisfy so restty's runtime knows a session
 *  is live). `onReady` fires once the shell has actually spawned; `onExit`
 *  fires on both a clean exit (`code === 0`) and a crash/spawn failure. */
export type PtySessionHooks = {
  onReady: (shell: string) => void;
  onExit: (code: number, error?: string) => void;
};

/** Bridges restty's `PtyTransport` contract to TanWords' existing PTY IPC
 *  channels (`pty_spawn`/`pty_write`/`pty_resize`/`pty_close`,
 *  `pty:data`/`pty:exit`) — the same channels `TerminalTool.tsx` (xterm) uses.
 *  `electron/main/terminal.ts` has no renderer-specific assumptions, so this
 *  is a thin adapter, not a second PTY implementation. */
export function createElectronPtyTransport(shellPath: string, hooks: PtySessionHooks): PtyTransport {
  let sessionId: string | null = null;
  let connected = false;
  // Set the moment teardown runs, so a `pty_spawn` still in flight (the
  // daemon handshake is allowed 5s) knows to close the session it is about
  // to create instead of leaking an orphan shell plus two renderer-side
  // event subscriptions that nothing will ever remove — the component that
  // owns this transport is gone by then. Mirrors the guard the xterm path
  // (`useTerminalSession.ts`) has for the same race.
  let disposed = false;
  let offs: Array<() => void> = [];
  const decoder = new TextDecoder("utf-8");

  // restty/xterm's `write()` is synchronous with no completion signal (see
  // the file header comment), so unlike the xterm engine there is nothing to
  // await between chunks. But a busy shell (`npm install`, a full-screen TUI
  // redraw, `cat` on a big file) can still deliver many `pty:data` IPC events
  // within a single frame; calling `callbacks.onData` — and therefore
  // restty's parser — once per event instead of once per frame adds
  // per-event overhead for no visual benefit, since only the *last* rendered
  // frame is ever seen. Coalesce into one decode + one `onData` call per
  // animation frame, and pause the daemon's stdout (mirroring the xterm
  // engine's high-water mark) if a frame's backlog balloons — e.g. because
  // the tab is backgrounded and not getting rAF ticks at all.
  const outputQueue: Uint8Array[] = [];
  let outputPendingBytes = 0;
  let flushFrame: number | null = null;
  let outputBackpressured = false;

  const setOutputBackpressure = (paused: boolean) => {
    if (!sessionId || outputBackpressured === paused) return;
    outputBackpressured = paused;
    void callMain("pty_set_output_backpressure", { id: sessionId, paused }).catch(() => {});
  };

  const flushOutput = (callbacks: PtyCallbacks) => {
    flushFrame = null;
    if (outputQueue.length === 0) return;
    let text = "";
    for (const bytes of outputQueue) text += decoder.decode(bytes, { stream: true });
    outputQueue.length = 0;
    outputPendingBytes = 0;
    setOutputBackpressure(false);
    callbacks.onData?.(text);
  };

  const teardownSubscriptions = () => {
    offs.forEach((off) => off());
    offs = [];
  };

  const cancelFlush = () => {
    if (flushFrame !== null) window.cancelAnimationFrame(flushFrame);
    flushFrame = null;
    outputQueue.length = 0;
    outputPendingBytes = 0;
  };

  return {
    connect(options: PtyConnectOptions) {
      const callbacks: PtyCallbacks = options.callbacks;
      void (async () => {
        try {
          const info = await callMain<{ id: string; shell: string; cwd: string; pid: number }>(
            "pty_spawn",
            { cols: options.cols ?? 80, rows: options.rows ?? 24, shellPath },
          );
          if (disposed) {
            // Teardown won the race with the spawn handshake: close the
            // freshly-created backend session rather than adopting it.
            void callMain("pty_close", { id: info.id }).catch(() => {});
            return;
          }
          sessionId = info.id;
          connected = true;
          offs.push(subscribe<{ id: string; data?: unknown }>("pty:data", ({ id, data }) => {
            if (sessionId !== id) return;
            try {
              const bytes = terminalOutputBytes(data);
              if (!bytes?.byteLength) return;
              outputQueue.push(bytes);
              outputPendingBytes += bytes.byteLength;
              if (outputPendingBytes >= TERMINAL_OUTPUT_HIGH_WATER_BYTES) setOutputBackpressure(true);
              if (flushFrame === null) {
                flushFrame = window.requestAnimationFrame(() => flushOutput(callbacks));
              }
            } catch {
              // A malformed/late transport event must not take down the React tree.
            }
          }));
          offs.push(subscribe<{ id: string; code?: number; error?: string }>("pty:exit", ({ id, code, error }) => {
            if (sessionId !== id) return;
            connected = false;
            // A shell almost always writes its final bytes (the "logout"
            // line, an error report, the tail of the last command) right
            // before exiting, while they are still queued for the next rAF
            // flush. Flush them synchronously so the screen doesn't end on
            // a bisected frame — flushOutput is a no-op on an empty queue.
            flushOutput(callbacks);
            cancelFlush();
            callbacks.onExit?.(code ?? 1);
            callbacks.onDisconnect?.();
            hooks.onExit(code ?? 1, error);
          }));
          callbacks.onStatus?.(info.shell);
          callbacks.onConnect?.();
          hooks.onReady(info.shell);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          callbacks.onError?.(message);
          callbacks.onDisconnect?.();
          hooks.onExit(1, message);
        }
      })();
    },
    disconnect() {
      disposed = true;
      if (sessionId) void callMain("pty_close", { id: sessionId }).catch(() => {});
      connected = false;
      sessionId = null;
      cancelFlush();
      teardownSubscriptions();
    },
    sendInput(data: string) {
      if (!sessionId) return false;
      void callMain("pty_write", { id: sessionId, data: b64EncodeUtf8(data) }).catch(() => {});
      return true;
    },
    resize(cols: number, rows: number, meta) {
      if (!sessionId) return false;
      void callMain("pty_resize", {
        id: sessionId,
        cols,
        rows,
        pixelWidth: meta?.widthPx ?? 0,
        pixelHeight: meta?.heightPx ?? 0,
      }).catch(() => {});
      return true;
    },
    isConnected() {
      return connected;
    },
    destroy() {
      disposed = true;
      if (sessionId) void callMain("pty_close", { id: sessionId }).catch(() => {});
      connected = false;
      sessionId = null;
      cancelFlush();
      teardownSubscriptions();
    },
  };
}

/** restty's own built-in fallback chain (what leaving `fonts` unset would
 *  use) covers CJK glyphs with exactly one entry — a `Noto Sans CJK SC` OTF
 *  fetched from `cdn.jsdelivr.net` at first render, with no Local Font
 *  Access attempt before it (confirmed in
 *  `node_modules/restty/dist/chunk-mnhegx4k.js`'s `DEFAULT_FONT_INPUTS`).
 *  jsdelivr is commonly slow or blocked outright in mainland China, so
 *  Chinese/Japanese/Korean text renders as tofu boxes until — or unless —
 *  that fetch succeeds. Every OS ships a CJK-capable font already, so ask
 *  Local Font Access for one first; it costs nothing if unavailable ("prefer"
 *  falls through to the next entry rather than erroring) — on desktop.
 *
 *  On the web, `local: "prefer"` is a hazard rather than a shortcut: it calls
 *  `window.queryLocalFonts()`, which — confirmed by hand — never settles
 *  (neither resolves nor rejects) when the `local-fonts` permission is still
 *  `"prompt"` and there was no user gesture to let Chromium show the prompt.
 *  restty awaits font loading before its runtime reaches "ready", so that
 *  hang blocks `connectPty()` forever: the terminal sits on a blank canvas
 *  with the tab stuck on "Starting…", no console error, nothing to catch.
 *  Electron never hits this (no Local Font Access API in its renderer, so
 *  restty's loader finds it absent and moves on immediately) — only the web
 *  build needs the `local` field dropped entirely. */
const LOCAL_CJK_FALLBACK_FONTS: ResttyFontInput[] = [
  { family: "PingFang SC", local: "prefer" }, // macOS
  { family: "Microsoft YaHei", local: "prefer" }, // Windows
  { family: "Noto Sans CJK SC", local: "prefer" }, // Linux, if installed
  { family: "Noto Sans SC", local: "prefer" },
];

/** Web substitute for the block above: plain URL fetches (no `family`/`local`
 *  at all, so no Local Font Access call of any kind), covering the same two
 *  jobs — a crisp monospace face for ASCII, and full Latin+CJK glyph coverage
 *  as the fallback. Same URLs restty's own unset-`fonts` default uses
 *  internally (`FONT_URL_JETBRAINS_MONO`/`FONT_URL_NOTO_CJK_SC` in
 *  `node_modules/restty/dist/chunk-mnhegx4k.js`) — supplying a custom `fonts`
 *  array replaces that default wholesale rather than extending it, so a
 *  custom family selection with nothing else would otherwise leave web with
 *  zero working font source. */
const NETWORK_FALLBACK_FONTS: ResttyFontInput[] = [
  {
    url: "https://cdn.jsdelivr.net/gh/ryanoasis/nerd-fonts@v3.4.0/patched-fonts/JetBrainsMono/NoLigatures/Regular/JetBrainsMonoNLNerdFontMono-Regular.ttf",
    name: "JetBrains Mono",
  },
  {
    url: "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
    name: "Noto Sans CJK SC",
  },
];

/** restty resolves fonts via Local Font Access (`family` + optional
 *  `weight`), not a CSS font-stack string. Always returns an explicit list
 *  — including for the "System monospace" default — so the local CJK
 *  fallback above is used instead of restty's own network-dependent one. */
export function resttyFontsFor(family: string, weight: number): ResttyFontInput[] {
  const hasCustomFamily = family && family !== DEFAULT_TERMINAL_FONT_FAMILY;
  if (!isDesktopHost) {
    // `local: "prefer"` is unsafe on the web build — see the comment above —
    // so a custom pick is tried as a fast, non-blocking family match (no
    // network fetch exists for an arbitrary local font name) ahead of the
    // guaranteed-to-load network fonts.
    const primary: ResttyFontInput[] = hasCustomFamily ? [{ family, weight }] : [];
    return [...primary, ...NETWORK_FALLBACK_FONTS];
  }
  const primary: ResttyFontInput[] = hasCustomFamily ? [{ family, weight, local: "prefer" }] : [];
  return [...primary, ...LOCAL_CJK_FALLBACK_FONTS];
}

/** Parses either `#rrggbb`/`#rgb` or a literal `rgba(r, g, b, a)` string (the
 *  shape `TERMINAL_THEMES`' `selectionBackground` entries use) into restty's
 *  0-255-channel `ThemeColor`. Falls back to opaque black on anything else,
 *  matching `hexToRgb`'s own malformed-input fallback. */
function toThemeColor(value: string): ThemeColor {
  const rgbaMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (rgbaMatch) {
    return {
      r: Math.round(Number(rgbaMatch[1])),
      g: Math.round(Number(rgbaMatch[2])),
      b: Math.round(Number(rgbaMatch[3])),
      a: rgbaMatch[4] === undefined ? 255 : Math.round(Number(rgbaMatch[4]) * 255),
    };
  }
  const { r, g, b } = hexToRgb(value);
  return { r, g, b, a: 255 };
}

/** Builds a `GhosttyTheme` restty can `applyTheme()` from the same hex/rgba
 *  palette `TerminalTool.tsx` feeds xterm's `ITheme`. restty's theme colors
 *  are 0-255 RGBA objects rather than CSS strings, hence the conversion. */
export function resttyThemeFor(
  scheme: import("@/store/settings/types").TerminalColorScheme,
  foregroundHex: string,
  backgroundColor: string,
): GhosttyTheme {
  const base = terminalThemeFor(scheme);
  const palette: Array<ThemeColor | undefined> = new Array(256).fill(undefined);
  const ansiOrder = [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue",
    "brightMagenta", "brightCyan", "brightWhite",
  ] as const;
  ansiOrder.forEach((key, index) => {
    palette[index] = toThemeColor(base[key]);
  });
  return {
    colors: {
      background: toThemeColor(backgroundColor),
      foreground: toThemeColor(foregroundHex),
      cursor: toThemeColor(base.cursor),
      selectionBackground: toThemeColor(base.selectionBackground),
      palette,
    },
    raw: {},
  };
}

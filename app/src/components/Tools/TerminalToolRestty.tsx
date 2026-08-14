/** Desktop Terminal page: a local shell over restty, an experimental
 *  WASM/WebGPU-WebGL2 terminal renderer, offered as an alternative to the
 *  default xterm.js engine (`TerminalTool.tsx`). Selected per-tab in
 *  Settings → Terminal → "Terminal engine"; see `TerminalWorkspace.tsx`
 *  for how a tab's engine choice is captured at creation.
 *
 *  PTY wiring goes through a custom `PtyTransport` (`createElectronPtyTransport`
 *  below), the pattern restty's own `examples/custom-transport` demonstrates,
 *  rather than manually piping `term.onData`/`term.write()`. This matters,
 *  not just style: restty's input runtime only forwards keystrokes to a
 *  `ptyTransport.sendInput()` (and stops locally echoing them) once a
 *  transport is `connectPty()`-ed. Feeding PTY output through `term.write()`
 *  by hand while *also* leaving that local echo path active — the shape of
 *  an earlier version of this file — is what produced doubled characters,
 *  since typed text got rendered once by restty's own no-transport echo and
 *  once more from writing the shell's real echo back manually. Likewise,
 *  restty resizes its own grid from its pane's ResizeObserver and calls
 *  `transport.resize(cols, rows, meta)` itself, so there is no hand-rolled
 *  cell-measurement fit here either (an earlier version's own fit math was
 *  fighting restty's internal one, which is why sizing looked wrong).
 *
 *  Known gaps versus the xterm engine, left for a future pass: no
 *  in-terminal search UI, no inline image protocols (sixel/IIP), no OSC 0/2
 *  shell-title event (so a restty tab keeps its default "Terminal N" name),
 *  no modified-Enter CSI-u key encoding (xterm 6 collapses that to plain CR;
 *  whether restty already handles it correctly is unverified), and
 *  "Select all" has no restty API to call, so it isn't offered. Copy/Paste
 *  use the underlying `Restty` pane's own clipboard methods
 *  (`copySelectionToClipboard`/`pasteFromClipboard`), which talk to the OS
 *  clipboard directly rather than through TanWords' `clipboard:*` IPC.
 *
 *  No background blur/transparency: restty's canvas is created with
 *  `alphaMode: "opaque"` on WebGPU and `{alpha: false}` on its WebGL2
 *  fallback (confirmed in `node_modules/restty/dist/chunk-mnhegx4k.js`), so
 *  the canvas can never reveal the app wallpaper behind it no matter what
 *  alpha the theme's background color carries. The Transparent/Blur/Opacity
 *  controls are hidden for this engine in both this component's appearance
 *  panel and Settings → Terminal — showing working-looking sliders with no
 *  visible effect would be worse than not offering them. Background color
 *  is always rendered fully opaque here. */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Terminal as ResttyTerminal } from "restty/xterm";
import type { GhosttyTheme, PtyCallbacks, PtyConnectOptions, PtyTransport, ResttyFontInput } from "restty";
import type { ThemeColor } from "restty/internal";
import {
  Droplets,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import "@/styles/terminal-tool.css";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { subscribe } from "@/ipc/events";
import { callMain } from "@/ipc/host";
import { useSettingsStore } from "@/store/settingsStore";
import { useFullscreenDragExit } from "@/hooks/useFullscreenDragExit";
import { isDesktopHost } from "@/platform";
import { TerminalEngineSwitch } from "./TerminalEngineSwitch";
import { createSandboxPtyTransport } from "./sandboxPtyTransport";
import type { ContextMenuPosition } from "./terminalUtils";
import {
  MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
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
function createElectronPtyTransport(shellPath: string, hooks: PtySessionHooks): PtyTransport {
  let sessionId: string | null = null;
  let connected = false;
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
 *  falls through to the next entry rather than erroring). */
const LOCAL_CJK_FALLBACK_FONTS: ResttyFontInput[] = [
  { family: "PingFang SC", local: "prefer" }, // macOS
  { family: "Microsoft YaHei", local: "prefer" }, // Windows
  { family: "Noto Sans CJK SC", local: "prefer" }, // Linux, if installed
  { family: "Noto Sans SC", local: "prefer" },
];

/** restty resolves fonts via Local Font Access (`family` + optional
 *  `weight`), not a CSS font-stack string. Always returns an explicit list
 *  — including for the "System monospace" default — so the local CJK
 *  fallback above is used instead of restty's own network-dependent one. */
function resttyFontsFor(family: string, weight: number): ResttyFontInput[] {
  const primary: ResttyFontInput[] = family && family !== DEFAULT_TERMINAL_FONT_FAMILY
    ? [{ family, weight, local: "prefer" }]
    : [];
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
function resttyThemeFor(
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

export function TerminalToolRestty({
  onBack,
  visible = true,
  shellPath = "",
  engine,
  onEngineChange,
  onSessionReady,
  onSessionExit,
  onShellTitleChange,
  tabBar,
  maximized = false,
  onMaximizedChange = () => {},
}: {
  onBack: () => void;
  visible?: boolean;
  shellPath?: string;
  /** This tab's current terminal engine ("restty", since this is
   *  `TerminalToolRestty`) and its setter, shown as a switch in the
   *  appearance panel — see `TerminalEngineSwitch`. */
  engine?: import("@/store/settings/types").TerminalEngine;
  onEngineChange?: (engine: import("@/store/settings/types").TerminalEngine) => void;
  onSessionReady?: (shell: string) => void;
  onShellTitleChange?: (title: string) => void;
  onSessionExit?: () => void;
  tabBar?: React.ReactNode;
  maximized?: boolean;
  onMaximizedChange?: (maximized: boolean) => void;
}) {
  const t = useT();
  const { fullScreen, onMouseDown: onToolbarMouseDown } = useFullscreenDragExit();
  const shellRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<ResttyTerminal | null>(null);
  const onSessionExitRef = useRef(onSessionExit);
  onSessionExitRef.current = onSessionExit;
  const onSessionReadyRef = useRef(onSessionReady);
  onSessionReadyRef.current = onSessionReady;
  const onShellTitleChangeRef = useRef(onShellTitleChange);
  onShellTitleChangeRef.current = onShellTitleChange;
  const recoveryAttemptsRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<"starting" | "connected" | "closed" | "error">("starting");
  const [message, setMessage] = useState("");
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const [appearanceControlsOpen, setAppearanceControlsOpen] = useState(false);
  const terminalBackgroundColor = useSettingsStore((state) => state.terminalBackgroundColor);
  const setTerminalBackgroundColor = useSettingsStore((state) => state.setTerminalBackgroundColor);
  const terminalTextColor = useSettingsStore((state) => state.terminalTextColor);
  const setTerminalTextColor = useSettingsStore((state) => state.setTerminalTextColor);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const setTerminalColorScheme = useSettingsStore((state) => state.setTerminalColorScheme);
  const [bgColorDraft, setBgColorDraft] = useState(terminalBackgroundColor);
  useEffect(() => { setBgColorDraft(terminalBackgroundColor); }, [terminalBackgroundColor]);
  const commitBgColor = useCallback(() => setTerminalBackgroundColor(bgColorDraft), [bgColorDraft, setTerminalBackgroundColor]);
  const [textColorDraft, setTextColorDraft] = useState(terminalTextColor);
  useEffect(() => { setTextColorDraft(terminalTextColor); }, [terminalTextColor]);
  const commitTextColor = useCallback(() => setTerminalTextColor(textColorDraft), [textColorDraft, setTerminalTextColor]);
  const terminalFontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const terminalFontWeight = useSettingsStore((state) => state.terminalFontWeight);
  const setTerminalFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const setTerminalFontWeight = useSettingsStore((state) => state.setTerminalFontWeight);

  const copySelectionWithFeedback = useCallback(async () => {
    try {
      const copied = await terminalRef.current?.restty?.copySelectionToClipboard();
      if (copied) toast.success(t("toolsPage.terminal.copied"));
      else toast.error(t("toolsPage.terminal.copyFailed"));
    } catch {
      toast.error(t("toolsPage.terminal.copyFailed"));
    }
  }, [t]);

  const pasteClipboard = useCallback(async () => {
    await terminalRef.current?.restty?.pasteFromClipboard().catch(() => {});
    terminalRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuRef.current?.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    const close = () => setContextMenu(null);
    document.addEventListener("mousedown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnKeyDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnKeyDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    let alive = true;

    setStatus("starting");
    setMessage("");

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;

    const recoverAfterFailure = (reason: string) => {
      const attempt = recoveryAttemptsRef.current + 1;
      recoveryAttemptsRef.current = attempt;
      if (attempt > MAX_AUTOMATIC_RECOVERY_ATTEMPTS) {
        setStatus("error");
        setMessage(reason);
        return;
      }
      setStatus("starting");
      setMessage(reason);
      retryTimer = setTimeout(() => {
        if (alive) setSessionGeneration((generation) => generation + 1);
      }, Math.min(250 * (2 ** (attempt - 1)), 1_000));
    };

    const sessionHooks: PtySessionHooks = {
      onReady: (shell) => {
        if (!alive) return;
        setStatus("connected");
        onSessionReadyRef.current?.(shell);
        stabilityTimer = setTimeout(() => {
          recoveryAttemptsRef.current = 0;
        }, 30_000);
      },
      onExit: (code, error) => {
        if (!alive) return;
        if (code === 0) {
          setStatus("closed");
          onSessionExitRef.current?.();
          return;
        }
        recoverAfterFailure(error || t("toolsPage.terminal.recovering"));
      },
    };

    // Desktop talks to a real local shell over IPC; the web build has none,
    // so it runs a sandboxed in-browser shell instead (see
    // `sandboxPtyTransport.ts` and `WEB_CAPABILITIES.terminal`).
    const transport = isDesktopHost
      ? createElectronPtyTransport(shellPath, sessionHooks)
      : createSandboxPtyTransport(sessionHooks);

    // `services.ptyTransport` must be supplied at construction — the xterm
    // compat layer captures it once in its constructor and forwards it
    // verbatim to the underlying `Restty` runtime on `open()` (see the file
    // header comment); assigning `term.options` later never reaches it. This
    // is what makes restty send keystrokes through `transport.sendInput()`
    // and stop its own local echo, and what makes it call `transport.resize()`
    // itself whenever its pane's own ResizeObserver recomputes the grid.
    const term = new ResttyTerminal({
      cols: 80,
      rows: 24,
      terminal: {
        fontSize: terminalFontSize,
        fonts: resttyFontsFor(terminalFontFamily, terminalFontWeight),
      },
      services: { ptyTransport: transport },
    });
    terminalRef.current = term;
    term.open(el);
    // restty's WebGPU/WebGL2 canvas is always created without an alpha
    // channel (`alphaMode: "opaque"` / `{alpha: false}` — confirmed in
    // `node_modules/restty/dist/chunk-mnhegx4k.js`), so unlike xterm there is
    // no way to make the background theme color translucent and reveal the
    // app wallpaper behind it. Always pass a fully opaque background.
    term.restty?.applyTheme(resttyThemeFor(terminalColorScheme, terminalTextColor, terminalBackgroundColor));
    term.restty?.connectPty();

    const onFocus = () => term.focus();
    el.addEventListener("focus", onFocus);

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (stabilityTimer) clearTimeout(stabilityTimer);
      onShellTitleChangeRef.current?.("");
      el.removeEventListener("focus", onFocus);
      term.dispose();
      if (terminalRef.current === term) terminalRef.current = null;
    };
    // Only `sessionGeneration` remounts the terminal/PTY; typography and
    // appearance changes are applied live below, matching TerminalTool.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionGeneration]);

  useEffect(() => {
    terminalRef.current?.restty?.applyTheme(resttyThemeFor(terminalColorScheme, terminalTextColor, terminalBackgroundColor));
  }, [sessionGeneration, terminalBackgroundColor, terminalColorScheme, terminalTextColor]);

  useEffect(() => {
    const restty = terminalRef.current?.restty;
    if (!restty) return;
    // The xterm-compat `Terminal.options` setter only stores values in a
    // local bag — it never forwards live changes to the running renderer
    // (confirmed against `restty/xterm`'s source). Live updates go through
    // the underlying pane API instead.
    restty.setFontSize(terminalFontSize);
    void restty.setFonts(resttyFontsFor(terminalFontFamily, terminalFontWeight)).catch(() => {});
    // A changed cell size still fits the same container to a different
    // grid — force the recompute rather than waiting for the pane's own
    // ResizeObserver, which only fires on a container *size* change.
    const frame = window.requestAnimationFrame(() => restty.updateSize(true));
    return () => window.cancelAnimationFrame(frame);
  }, [terminalFontFamily, terminalFontSize, terminalFontWeight]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => terminalRef.current?.restty?.updateSize(true));
    return () => window.cancelAnimationFrame(frame);
  }, [maximized]);

  const toggleFullscreen = () => {
    onMaximizedChange(!maximized);
  };

  const toggleAppearanceControls = () => {
    setAppearanceControlsOpen((open) => !open);
  };

  const restartTerminal = () => {
    recoveryAttemptsRef.current = 0;
    setSessionGeneration((generation) => generation + 1);
  };

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const width = 184;
    const height = 88;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      // restty exposes no `hasSelection()` equivalent, so Copy is always
      // offered and simply no-ops (via a failed/empty clipboard write) when
      // there is nothing selected.
      canCopy: true,
    });
  };

  const runMenuAction = (action: () => void | Promise<void>) => {
    setContextMenu(null);
    void Promise.resolve(action()).catch(() => {});
  };

  return (
    <div
      aria-hidden={!visible}
      className="terminal-tool-outer relative h-full w-full"
    >
      <div className="flex h-full flex-col">
        <div
          data-testid="terminal-tab-toolbar"
          onMouseDown={onToolbarMouseDown}
          title={fullScreen ? t("windowControls.dragToExitFullscreen") : undefined}
          className={`${
            fullScreen
              ? "cursor-grab"
              : maximized
                ? "app-drag-region"
                : "app-region-no-drag"
          } flex min-w-0 shrink-0 items-center border-y border-border bg-transparent text-foreground shadow-sm`}
        >
          {tabBar}
          <div className="app-region-no-drag ml-auto flex shrink-0 items-center gap-1 px-2">
            {status !== "connected" && (
              <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground/80">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    status === "error" ? "bg-red-500" : "bg-amber-500"
                  }`}
                />
                {status === "error"
                  ? t("toolsPage.terminal.error")
                  : status === "closed"
                    ? t("toolsPage.terminal.closed")
                    : t("toolsPage.terminal.starting")}
              </span>
            )}

            <div
              role="group"
              aria-label={t("toolsPage.terminal.fontSize")}
              className="flex h-8 items-center rounded-lg border border-border bg-transparent px-0.5"
            >
              <Button
                variant="ghost"
                size="icon"
                disabled={terminalFontSize <= 8}
                onClick={() => setTerminalFontSize(terminalFontSize - 1)}
                title={t("toolsPage.terminal.decreaseFontSize")}
                aria-label={t("toolsPage.terminal.decreaseFontSize")}
                className="h-7 w-7 rounded-md text-foreground/80"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-9 text-center text-[11px] tabular-nums text-foreground/80">
                {terminalFontSize}px
              </span>
              <Button
                variant="ghost"
                size="icon"
                disabled={terminalFontSize >= 32}
                onClick={() => setTerminalFontSize(terminalFontSize + 1)}
                title={t("toolsPage.terminal.increaseFontSize")}
                aria-label={t("toolsPage.terminal.increaseFontSize")}
                className="h-7 w-7 rounded-md text-foreground/80"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleAppearanceControls}
              title={t("toolsPage.terminal.appearance")}
              aria-label={t("toolsPage.terminal.appearance")}
              aria-pressed={appearanceControlsOpen}
              className={`h-9 w-9 shrink-0 rounded-lg ${
                appearanceControlsOpen ? "bg-primary/15 text-primary" : "text-foreground/80"
              }`}
            >
              <Droplets className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              title={maximized ? t("toolsPage.terminal.restore") : t("toolsPage.terminal.maximize")}
              aria-label={maximized ? t("toolsPage.terminal.restore") : t("toolsPage.terminal.maximize")}
              className="h-9 w-9 shrink-0 rounded-lg text-foreground/80"
            >
              {maximized ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {appearanceControlsOpen && (
          <div
            role="group"
            aria-label={t("toolsPage.terminal.appearance")}
            className="app-region-no-drag flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 bg-transparent px-4 py-2 sm:px-6"
          >
            {engine && onEngineChange && (
              <TerminalEngineSwitch engine={engine} onChange={onEngineChange} />
            )}
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {t("toolsPage.terminal.themeLabel")}
              </span>
              <Select
                value={terminalColorScheme}
                onValueChange={(value) => setTerminalColorScheme(value as typeof terminalColorScheme)}
              >
                <SelectTrigger
                  aria-label={t("toolsPage.terminal.themeLabel")}
                  className="h-7 w-32 border-border bg-transparent px-2 py-0 text-[11px] focus:ring-1 focus:ring-ring focus:ring-offset-0"
                >
                  <SelectValue>
                    {terminalColorScheme === "custom" ? t("toolsPage.terminal.themeCustom") : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tokyo-night">{t("toolsPage.terminal.themeTokyoNight")}</SelectItem>
                  <SelectItem value="dracula">{t("toolsPage.terminal.themeDracula")}</SelectItem>
                  <SelectItem value="nord">{t("toolsPage.terminal.themeNord")}</SelectItem>
                  <SelectItem value="catppuccin-mocha">{t("toolsPage.terminal.themeCatppuccinMocha")}</SelectItem>
                  <SelectItem value="high-contrast">{t("toolsPage.terminal.themeHighContrast")}</SelectItem>
                  <SelectItem value="custom">{t("toolsPage.terminal.themeCustom")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {t("toolsPage.terminal.textColorLabel")}
              </span>
              <input
                type="color"
                value={terminalTextColor}
                onChange={(e) => setTerminalTextColor(e.currentTarget.value)}
                title={t("toolsPage.terminal.textColorLabel")}
                aria-label={t("toolsPage.terminal.textColorLabel")}
                className="h-6 w-8 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
              />
              <input
                type="text"
                value={textColorDraft}
                onChange={(e) => setTextColorDraft(e.currentTarget.value)}
                onBlur={commitTextColor}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                spellCheck={false}
                autoComplete="off"
                maxLength={7}
                placeholder="#c0caf5"
                title={t("toolsPage.terminal.textColorLabel")}
                aria-label={t("toolsPage.terminal.textColorLabel")}
                className="h-6 w-16 rounded-md border border-border bg-transparent px-1.5 text-[11px] tabular-nums text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {t("toolsPage.terminal.fontWeightLabel")}
              </span>
              <input
                type="range"
                min={100}
                max={900}
                step={100}
                value={terminalFontWeight}
                onChange={(event) => setTerminalFontWeight(Number(event.currentTarget.value))}
                aria-label={t("toolsPage.terminal.fontWeightLabel")}
                className="h-6 w-20 cursor-pointer accent-primary"
              />
              <span className="w-7 text-right text-[11px] tabular-nums text-foreground/80">
                {terminalFontWeight}
              </span>
            </label>
            {/* No blur/opacity sliders here: restty's WebGPU/WebGL2 canvas is
                always opaque (see the file header comment), so they would
                be dead controls. */}
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {t("toolsPage.terminal.backgroundColorLabel")}
              </span>
              <input
                type="color"
                value={terminalBackgroundColor}
                onChange={(e) => setTerminalBackgroundColor(e.currentTarget.value)}
                title={t("toolsPage.terminal.backgroundColorLabel")}
                aria-label={t("toolsPage.terminal.backgroundColorLabel")}
                className="h-6 w-8 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
              />
              <input
                type="text"
                value={bgColorDraft}
                onChange={(e) => setBgColorDraft(e.currentTarget.value)}
                onBlur={commitBgColor}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                spellCheck={false}
                autoComplete="off"
                maxLength={7}
                placeholder="#1a1b26"
                title={t("toolsPage.terminal.backgroundColorLabel")}
                aria-label={t("toolsPage.terminal.backgroundColorLabel")}
                className="h-6 w-16 rounded-md border border-border bg-transparent px-1.5 text-[11px] tabular-nums text-foreground outline-none focus:border-primary"
              />
            </label>
          </div>
        )}

        <div
          onContextMenu={openContextMenu}
          className="terminal-tool-shell relative min-h-0 flex-1 overflow-hidden rounded-none border-x-0 border-b-0 border-t border-border p-2"
          // Always opaque: restty's canvas has no alpha channel, so a
          // translucent wrapper here would only hide behind it, never show
          // through it. See the file header comment.
          style={{ background: terminalBackgroundColor }}
        >
          <div
            ref={shellRef}
            tabIndex={0}
            className="terminal-tool-host h-full w-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
          {status === "error" && (
            <div className="absolute left-2 top-2 z-10 flex items-center gap-3 p-4 text-sm text-destructive">
              <span>✗ {message}</span>
              <Button variant="outline" size="sm" onClick={restartTerminal}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {t("toolsPage.terminal.restart")}
              </Button>
            </div>
          )}
          {status === "closed" && (
            <p className="absolute left-2 top-2 z-10 p-4 text-sm text-muted-foreground">
              {t("toolsPage.terminal.closed")}
            </p>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("toolsPage.terminal.contextMenu")}
          className="fixed z-50 w-44 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => runMenuAction(copySelectionWithFeedback)}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
          >
            <span>{t("toolsPage.terminal.copy")}</span>
            <kbd className="text-[10px] text-muted-foreground">Ctrl+C</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runMenuAction(pasteClipboard)}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
          >
            <span>{t("toolsPage.terminal.paste")}</span>
            <kbd className="text-[10px] text-muted-foreground">Ctrl+V</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

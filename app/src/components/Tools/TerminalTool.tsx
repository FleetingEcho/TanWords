/** Desktop Terminal tool: a local shell over xterm.js.
 *
 *  The renderer is sandboxed (contextIsolation + sandbox), so there is no
 *  Node in here — the shell lives behind `tanwords-pty`, a Rust daemon Electron
 *  main spawns (see electron/main/terminal.ts). This component is only the
 *  front half of the terminal: it renders xterm.js, sends keystrokes/resizes,
 *  and paints the daemon's output. It is hidden on the web build, where no
 *  local process exists to back a shell.
 *
 *  Byte handling is explicit. xterm hands us a UTF-8 *string* on data; the
 *  bridge moves it as base64 so a JSON/structured-clone hop can't mangle a
 *  multi-byte character; and daemon output comes back the same way, decoded
 *  back to bytes and written straight to the buffer (xterm joins split UTF-8
 *  sequences across write calls itself).
 *
 *  Layout: the root fills the page (which sits in a `min-h-0 flex-1
 *  overflow-y-auto` shell from MainLayout), the terminal is `flex-1 min-h-0`
 *  so it takes all the leftover height, and the top-right Maximize toggle runs
 *  the wrapper into browser/electron fullscreen — a ResizeObserver re-fits
 *  xterm whenever that (or any other) layout change moves the viewport. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { ArrowLeft, Droplets, Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import "@/styles/terminal-tool.css";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { subscribe } from "@/ipc/events";
import { callMain } from "@/ipc/host";
import { useSettingsStore } from "@/store/settingsStore";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "@/store/settings/types";

// ── base64 helpers ─────────────────────────────────────────────────────────
const encoder = new TextEncoder();

/** UTF-8 bytes → base64 (for the input direction). */
function b64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** base64 → raw UTF-8 bytes (for the output direction; xterm joins partials). */
function bytesFromB64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64EncodeUtf8(s: string): string {
  return b64FromBytes(encoder.encode(s));
}

type TerminalClipboard =
  | { kind: "text"; text: string }
  | { kind: "image"; path: string }
  | null;

type ContextMenuPosition = { x: number; y: number; canCopy: boolean };

/** Escape a controlled local path as one POSIX-shell token. This also matches
 * the preferred Git Bash shell on Windows. */
export function quoteTerminalPath(filePath: string): string {
  return filePath.replace(/[^A-Za-z0-9_./-]/g, "\\$&");
}

const SYSTEM_MONOSPACE_STACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** A selected local face stays first, with the machine's native monospace as
 * fallback. Escaping quotes/backslashes keeps arbitrary local family names a
 * single valid CSS font-family token. */
export function terminalFontStack(family: string): string {
  if (!family || family === DEFAULT_TERMINAL_FONT_FAMILY) return SYSTEM_MONOSPACE_STACK;
  const escaped = family.replace(/(["\\])/g, "\\$1");
  return `"${escaped}", ${SYSTEM_MONOSPACE_STACK}`;
}

export function TerminalTool({
  onBack,
  visible = true,
  shellPath = "",
  onSessionReady,
  onSessionExit,
  tabBar,
}: {
  onBack: () => void;
  visible?: boolean;
  /** Captured by the tab at creation time; changing Settings won't restart it. */
  shellPath?: string;
  onSessionReady?: (shell: string) => void;
  /** Natural shell termination (`exit`, EOF, crash) closes its workspace tab. */
  onSessionExit?: () => void;
  /** Workspace-owned tabs belong below this terminal's toolbar, above xterm. */
  tabBar?: React.ReactNode;
}) {
  const t = useT();
  const outerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const refitRef = useRef<() => void>(() => {});
  const onSessionExitRef = useRef(onSessionExit);
  onSessionExitRef.current = onSessionExit;
  const menuRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<"starting" | "connected" | "closed" | "error">("starting");
  const [message, setMessage] = useState("");
  // Tracks browser fullscreen separately so the Maximize icon can swap to a
  // Minimize ("exit fullscreen") glyph while the mode is active.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  // Opening/closing the adjustment controls must not also enable/disable the
  // glass effect. That persisted preference is intentionally separate below.
  const [appearanceControlsOpen, setAppearanceControlsOpen] = useState(false);
  // Glass look: blur controls the backdrop radius while backgroundOpacity
  // controls only the dark tint over it. Keeping them independent lets the
  // wallpaper remain sharp-but-dim or heavily frosted-but-clear.
  const transparent = useSettingsStore((state) => state.terminalTransparent);
  const setTransparent = useSettingsStore((state) => state.setTerminalTransparent);
  const blur = useSettingsStore((state) => state.terminalBackgroundBlur);
  const setBlur = useSettingsStore((state) => state.setTerminalBackgroundBlur);
  const backgroundOpacity = useSettingsStore((state) => state.terminalBackgroundOpacity);
  const setBackgroundOpacity = useSettingsStore((state) => state.setTerminalBackgroundOpacity);
  const terminalFontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const appBackgroundImage = useSettingsStore((state) => state.appBackgroundImage);
  const appBackgroundBlur = useSettingsStore((state) => state.appBackgroundBlur);
  const appBackgroundVisible = useSettingsStore((state) => state.appBackgroundVisible);

  const copySelection = useCallback(async () => {
    const term = terminalRef.current;
    if (!term?.hasSelection()) return;
    await callMain("clipboard:writeText", { text: term.getSelection() });
  }, []);

  const pasteClipboard = useCallback(async () => {
    const term = terminalRef.current;
    if (!term) return;
    const value = await callMain<TerminalClipboard>("clipboard:readForTerminal");
    if (value?.kind === "text") term.paste(value.text);
    if (value?.kind === "image") term.paste(quoteTerminalPath(value.path));
    term.focus();
  }, []);

  const selectAll = useCallback(() => {
    terminalRef.current?.selectAll();
    terminalRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
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

    const term = new Terminal({
      fontSize: terminalFontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      // WebGL paints into a canvas. Preserve its alpha channel so the terminal
      // glass controls continue to reveal the app wallpaper underneath it.
      allowTransparency: true,
      fontFamily: terminalFontStack(terminalFontFamily),
      // WebGL's color parser treats the CSS keyword `transparent` as opaque
      // black. An explicit alpha channel is required for a clear framebuffer.
      theme: { background: "rgba(0, 0, 0, 0)" },
      scrollback: 4000,
    });
    terminalRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    // Prefer xterm's GPU-backed canvas renderer. Unsupported/blocked WebGL2
    // contexts throw here, in which case xterm's built-in DOM renderer remains
    // active. Context loss later follows the same safe fallback path.
    let webgl: WebglAddon | null = null;
    try {
      const webglAddon = new WebglAddon();
      webgl = webglAddon;
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      webgl?.dispose();
      // DOM rendering is already active; no recovery work is required.
    }
    fit.fit();

    // Terminal-aware clipboard shortcuts. Ctrl+C remains SIGINT when there is
    // no selection; with a selection it copies instead. Ctrl/Cmd+V uses the
    // native clipboard so Electron can also materialize copied images.
    term.attachCustomKeyEventHandler((event) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "c" && term.hasSelection()) {
        if (event.type === "keydown") {
          event.preventDefault();
          void copySelection().catch(() => {});
        }
        return false;
      }
      if (modifier && key === "v") {
        if (event.type === "keydown") {
          event.preventDefault();
          void pasteClipboard().catch(() => {});
        }
        return false;
      }
      return true;
    });

    const state = { sessionId: null as string | null };

    // Keep the session in step with this component's lifetime.
    let alive = true;

    // Fullscreen-aware fit: entering/exiting fullscreen changes the viewport
    // size, so refit and re-sync the pty dimensions when it happens.
    const refit = () => {
      // A persistent Tools page is `display: none` while another route is in
      // front. Do not collapse the live PTY to xterm's minimum dimensions.
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      fit.fit();
      if (state.sessionId) {
        callMain("pty_resize", { id: state.sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
      }
    };
    refitRef.current = refit;

    const onFsChange = () => {
      if (!alive) return;
      setIsFullscreen(document.fullscreenElement === outerRef.current);
      refit();
    };
    document.addEventListener("fullscreenchange", onFsChange);

    // ── events ────────────────────────────────────────────────────────
    const offs = [
      subscribe<{ id: string; data?: string }>("pty:data", ({ id, data }) => {
        if (state.sessionId !== id || !alive) return;
        if (data) term.write(bytesFromB64(data));
      }),
      subscribe<{ id: string; code?: number }>("pty:exit", ({ id }) => {
        if (state.sessionId !== id || !alive) return;
        setStatus("closed");
        state.sessionId = null;
        onSessionExitRef.current?.();
      }),
    ];

    // ── spawn ─────────────────────────────────────────────────────────
    const spawn = async () => {
      try {
        const info = await callMain<{ id: string; shell: string; cwd: string; pid: number }>(
          "pty_spawn",
          { cols: term.cols, rows: term.rows, shellPath },
        );
        if (!alive) return;
        state.sessionId = info.id;
        setStatus("connected");
        onSessionReady?.(info.shell);
      } catch (err) {
        if (!alive) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : String(err));
      }
    };
    void spawn();

    // ── input & resize ────────────────────────────────────────────────
    const onData = term.onData((data) => {
      if (!state.sessionId) return;
      void callMain("pty_write", { id: state.sessionId, data: b64EncodeUtf8(data) }).catch(() => {});
    });
    const onResize = term.onResize(() => {
      if (!state.sessionId) return;
      callMain("pty_resize", { id: state.sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
    });

    // Resize the pty whenever the page layout changes (sidebar toggle, window
    // drag, fullscreen, ...). Observing the shell catches all of those because
    // its box is what xterm sizes to.
    const ro = new ResizeObserver(refit);
    ro.observe(el);

    const onFocus = () => term.focus();
    el.addEventListener("focus", onFocus);

    // ── teardown ──────────────────────────────────────────────────────
    return () => {
      alive = false;
      if (state.sessionId) callMain("pty_close", { id: state.sessionId }).catch(() => {});
      document.removeEventListener("fullscreenchange", onFsChange);
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      el.removeEventListener("focus", onFocus);
      offs.forEach((off) => off());
      term.dispose();
      refitRef.current = () => {};
      if (terminalRef.current === term) terminalRef.current = null;
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  // Typography changes are live options: updating them must not recreate the
  // Terminal instance (and therefore must not terminate the running PTY).
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = terminalFontStack(terminalFontFamily);
    term.options.fontSize = terminalFontSize;
    const frame = window.requestAnimationFrame(() => refitRef.current());
    return () => window.cancelAnimationFrame(frame);
  }, [terminalFontFamily, terminalFontSize]);

  // ── maximize toggle ─────────────────────────────────────────────────
  const toggleFullscreen = () => {
    const host = outerRef.current;
    if (!host) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void host.requestFullscreen?.();
    }
  };

  const toggleAppearanceControls = () => {
    // The first time someone opens the glass controls, preview and keep the
    // effect. Subsequent clicks only collapse/expand the controls.
    if (!transparent) setTransparent(true);
    setAppearanceControlsOpen((open) => !open);
  };

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const width = 184;
    const height = 112;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      canCopy: terminalRef.current?.hasSelection() ?? false,
    });
  };

  const runMenuAction = (action: () => void | Promise<void>) => {
    setContextMenu(null);
    void Promise.resolve(action()).catch(() => {});
  };

  return (
    <div
      ref={outerRef}
      aria-hidden={!visible}
      className="terminal-tool-outer relative h-full w-full"
    >
      {isFullscreen && (
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-background"
          aria-hidden="true"
        >
          {appBackgroundImage && appBackgroundVisible && (
            <>
              <img
                src={appBackgroundImage}
                alt=""
                className="h-full w-full object-cover"
                style={{
                  filter: `blur(${appBackgroundBlur}px)`,
                  transform: appBackgroundBlur > 0 ? "scale(1.08)" : undefined,
                }}
              />
              <div className="absolute inset-0 bg-black/20 dark:bg-black/45" />
            </>
          )}
        </div>
      )}
      <div className={`${isFullscreen ? "relative z-10" : ""} flex h-full flex-col`}>
        {/* toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            title={t("toolsPage.back")}
            aria-label={t("toolsPage.back")}
            className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="font-serif text-lg font-bold tracking-tight">
              {t("toolsPage.terminal.title")}
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "connected"
                  ? "bg-emerald-500"
                  : status === "error"
                    ? "bg-red-500"
                    : "bg-amber-500"
              }`}
            />
            {status === "connected"
              ? t("toolsPage.terminal.connected")
              : status === "error"
                ? t("toolsPage.terminal.error")
                : status === "closed"
                  ? t("toolsPage.terminal.closed")
                  : t("toolsPage.terminal.starting")}
          </span>

          <div
            role="group"
            aria-label={t("toolsPage.terminal.fontSize")}
            className="flex h-8 items-center rounded-lg border border-border bg-background/40 px-0.5"
          >
            <Button
              variant="ghost"
              size="icon"
              disabled={terminalFontSize <= 8}
              onClick={() => setTerminalFontSize(terminalFontSize - 1)}
              title={t("toolsPage.terminal.decreaseFontSize")}
              aria-label={t("toolsPage.terminal.decreaseFontSize")}
              className="h-7 w-7 rounded-md text-muted-foreground"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-9 text-center text-[11px] tabular-nums text-muted-foreground">
              {terminalFontSize}px
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={terminalFontSize >= 32}
              onClick={() => setTerminalFontSize(terminalFontSize + 1)}
              title={t("toolsPage.terminal.increaseFontSize")}
              aria-label={t("toolsPage.terminal.increaseFontSize")}
              className="h-7 w-7 rounded-md text-muted-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* glass / transparency toggle + appearance controls */}
          {appearanceControlsOpen && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {t("toolsPage.terminal.blurLabel")}
                </span>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={blur}
                  onChange={(e) => setBlur(Number(e.currentTarget.value))}
                  className="h-6 w-20 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted-foreground/30 [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-track]:h-[3px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted-foreground/30 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-primary"
                />
                <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                  {blur}px
                </span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {t("toolsPage.terminal.opacityLabel")}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={backgroundOpacity}
                  onChange={(e) => setBackgroundOpacity(Number(e.currentTarget.value))}
                  className="h-6 w-20 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted-foreground/30 [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-track]:h-[3px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted-foreground/30 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-primary"
                />
                <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                  {backgroundOpacity}%
                </span>
              </label>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleAppearanceControls}
            title={t("toolsPage.terminal.appearance")}
            aria-label={t("toolsPage.terminal.appearance")}
            aria-pressed={appearanceControlsOpen}
            className={`h-9 w-9 shrink-0 rounded-lg ${
              appearanceControlsOpen
                ? "bg-primary/15 text-primary"
                : transparent
                  ? "text-primary"
                  : "text-muted-foreground"
            }`}
          >
            <Droplets className="h-4 w-4" />
          </Button>

          {/* fullscreen toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? t("toolsPage.terminal.restore") : t("toolsPage.terminal.maximize")}
            aria-label={isFullscreen ? t("toolsPage.terminal.restore") : t("toolsPage.terminal.maximize")}
            className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>

        {tabBar}

        {/* xterm shell — fills the remaining height */}
        <div
          ref={shellRef}
          tabIndex={0}
          onContextMenu={openContextMenu}
          className="terminal-tool-shell min-h-0 flex-1 overflow-hidden rounded-none border-x-0 border-b-0 border-t border-border p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          style={
            transparent
              ? {
                  // Near-transparent tint: the app's own background map already
                  // dims the wallpaper (bg-black/45 dark / 20 light), so a light
                  // scrim here keeps text legible without reading as opaque. The
                  // backdrop-blur does the real work of frosting the image.
                  background: `rgba(8,10,14,${backgroundOpacity / 100})`,
                  backdropFilter: `blur(${blur}px)`,
                  WebkitBackdropFilter: `blur(${blur}px)`,
                }
              : { background: "rgb(13,17,23)" }
          }
        >
          {status === "error" && (
            <p className="p-4 text-sm text-destructive">✗ {message}</p>
          )}
          {status === "closed" && (
            <p className="p-4 text-sm text-muted-foreground">{t("toolsPage.terminal.closed")}</p>
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
            disabled={!contextMenu.canCopy}
            onClick={() => runMenuAction(copySelection)}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runMenuAction(selectAll)}
            className="flex w-full rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
          >
            {t("toolsPage.terminal.selectAll")}
          </button>
        </div>
      )}
    </div>
  );
}

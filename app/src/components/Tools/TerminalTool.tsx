/** Desktop Terminal page: a local shell over xterm.js or Ghostty's WASM VT core.
 *
 *  The renderer is sandboxed (contextIsolation + sandbox), so there is no
 *  Node in here — the shell lives behind `tanwords-pty`, a Rust daemon Electron
 *  main spawns (see electron/main/terminal.ts). This component is only the
 *  front half of the terminal: it renders the selected surface, sends keystrokes/resizes,
 *  and paints the daemon's output. It is hidden on the web build, where no
 *  local process exists to back a shell.
 *
 *  Byte handling is explicit. The terminal surface hands us a UTF-8 *string* on data; the
 *  bridge moves it as base64 so a JSON/structured-clone hop can't mangle a
 *  multi-byte character; and daemon output comes back the same way, decoded
 *  back to bytes and written straight to the buffer (xterm joins split UTF-8
 *  sequences across write calls itself).
 *
 *  Layout: the root fills the page (which sits in a `min-h-0 flex-1
 *  overflow-y-auto` shell from MainLayout), the terminal is `flex-1 min-h-0`
 *  so it takes all the leftover height. The standalone page owns maximize
 *  state, allowing MainLayout to remove its chrome without moving the terminal
 *  into the browser fullscreen API or recreating its PTY. */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Droplets,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import "@/styles/terminal-tool.css";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { subscribe } from "@/ipc/events";
import { callMain } from "@/ipc/host";
import { useSettingsStore } from "@/store/settingsStore";
import type { TerminalEngine } from "@/store/settings/types";
import { useFullscreenDragExit } from "@/hooks/useFullscreenDragExit";
import type { ContextMenuPosition, TerminalClipboard } from "./terminalUtils";
import {
  MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
  TERMINAL_OUTPUT_HIGH_WATER_BYTES,
  TERMINAL_OUTPUT_LOW_WATER_BYTES,
  terminalThemeFor,
  b64EncodeUtf8,
  quoteTerminalPath,
  shellTabTitle,
  terminalBackgroundRgba,
  terminalFontStack,
  terminalOutputBytes,
} from "./terminalUtils";
import { createXtermSurface, type TerminalSurface } from "./terminalSurface";

export function TerminalTool({
  onBack,
  visible = true,
  shellPath = "",
  engine = "xterm",
  onSessionReady,
  onSessionExit,
  onShellTitleChange,
  tabBar,
  maximized = false,
  onMaximizedChange = () => {},
}: {
  onBack: () => void;
  visible?: boolean;
  /** Captured by the tab at creation time; changing Settings won't restart it. */
  shellPath?: string;
  /** Captured by the tab at creation time; changing Settings affects new tabs. */
  engine?: TerminalEngine;
  onSessionReady?: (shell: string) => void;
  /** OSC 0/2 title from the shell, normalised for display; "" when the session
   *  ends or restarts, so a tab never keeps a title from a dead shell. */
  onShellTitleChange?: (title: string) => void;
  /** Natural shell termination (`exit`, EOF, crash) closes its workspace tab. */
  onSessionExit?: () => void;
  /** Workspace-owned tabs share the terminal action row above xterm. */
  tabBar?: React.ReactNode;
  maximized?: boolean;
  onMaximizedChange?: (maximized: boolean) => void;
}) {
  const t = useT();
  const { fullScreen, onMouseDown: onToolbarMouseDown } = useFullscreenDragExit();
  const shellRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalSurface | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const refitRef = useRef<() => void>(() => {});
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchResult, setSearchResult] = useState({ resultIndex: -1, resultCount: 0 });
  // Opening/closing the adjustment controls must not also enable/disable the
  // transparent background. That persisted preference is intentionally separate below.
  const [appearanceControlsOpen, setAppearanceControlsOpen] = useState(false);
  const transparent = useSettingsStore((state) => state.terminalTransparent);
  const backgroundOpacity = useSettingsStore((state) => state.terminalBackgroundOpacity);
  const setBackgroundOpacity = useSettingsStore((state) => state.setTerminalBackgroundOpacity);
  const terminalBackgroundColor = useSettingsStore((state) => state.terminalBackgroundColor);
  const setTerminalBackgroundColor = useSettingsStore((state) => state.setTerminalBackgroundColor);
  const terminalTextColor = useSettingsStore((state) => state.terminalTextColor);
  const setTerminalTextColor = useSettingsStore((state) => state.setTerminalTextColor);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const setTerminalColorScheme = useSettingsStore((state) => state.setTerminalColorScheme);
  // Custom exposes opacity directly in this toolbar, so a value below 100%
  // must use the glass rendering path even for older saved appearances whose
  // separate `transparent` flag was false.
  const effectiveTransparent = transparent
    || (terminalColorScheme === "custom" && backgroundOpacity < 100);
  const terminalRenderer = useSettingsStore((state) => state.terminalRenderer);
  // Draft for the hex text field: typed shorthand like `#ddd` is committed on
  // blur/Enter, and re-synced whenever the store value changes (colour picker,
  // Settings page, or another tab).
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

  const copySelection = useCallback(async () => {
    const term = terminalRef.current;
    if (!term?.hasSelection()) return;
    await callMain("clipboard:writeText", { text: term.getSelection() });
  }, []);

  const copySelectionWithFeedback = useCallback(async () => {
    try {
      await copySelection();
      toast.success(t("toolsPage.terminal.copied"));
    } catch {
      toast.error(t("toolsPage.terminal.copyFailed"));
    }
  }, [copySelection, t]);

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

    let cancelled = false;
    let unmountSurface: (() => void) | null = null;
    const surfaceOptions = {
      host: el,
      fontFamily: terminalFontStack(terminalFontFamily),
      fontSize: terminalFontSize,
      fontWeight: terminalFontWeight,
      theme: {
        ...terminalThemeFor(terminalColorScheme),
        foreground: terminalTextColor,
        background: effectiveTransparent ? "rgba(0, 0, 0, 0)" : terminalBackgroundColor,
      },
      transparent: effectiveTransparent,
      renderer: terminalRenderer,
      onSearchResults: setSearchResult,
    };

    const mountSurface = (term: TerminalSurface) => {
      if (cancelled) {
        term.dispose();
        return;
      }
      terminalRef.current = term;
      setStatus("starting");
      setMessage("");

    // Renderer writes are asynchronous. Feed one chunk at a time and apply
    // high/low-water backpressure to the helper while Chromium catches up.
    // Unlike truncation, pausing preserves every byte of an inline-image escape
    // sequence and keeps the parser in a valid state.
    const outputQueue: Uint8Array[] = [];
    let outputQueueHead = 0;
    let outputPendingBytes = 0;
    let outputWriting = false;
    let outputBackpressured = false;
    const setOutputBackpressure = (paused: boolean) => {
      if (!state.sessionId || outputBackpressured === paused) return;
      outputBackpressured = paused;
      void callMain("pty_set_output_backpressure", { id: state.sessionId, paused }).catch(() => {});
    };
    const pumpOutput = () => {
      if (!alive || outputWriting) return;
      const data = outputQueue[outputQueueHead];
      if (!data) return;
      outputQueueHead += 1;
      outputWriting = true;
      term.write(data, () => {
        outputPendingBytes -= data.byteLength;
        outputWriting = false;
        if (outputQueueHead === outputQueue.length) {
          // Reset in O(1) after the queue drains. Avoid Array.shift(), whose
          // repeated element moves turn a large output burst into O(n²) work.
          outputQueue.length = 0;
          outputQueueHead = 0;
        } else if (outputQueueHead >= 64 && outputQueueHead * 2 >= outputQueue.length) {
          // A continuously chatty session may never reach an empty queue. Drop
          // consumed references occasionally with one amortised compaction so
          // old chunks do not remain retained for the lifetime of the shell.
          outputQueue.splice(0, outputQueueHead);
          outputQueueHead = 0;
        }
        if (outputPendingBytes <= TERMINAL_OUTPUT_LOW_WATER_BYTES) {
          setOutputBackpressure(false);
        }
        pumpOutput();
      });
    };
    const enqueueOutput = (data: Uint8Array) => {
      outputQueue.push(data);
      outputPendingBytes += data.byteLength;
      if (outputPendingBytes >= TERMINAL_OUTPUT_HIGH_WATER_BYTES) {
        setOutputBackpressure(true);
      }
      pumpOutput();
    };

    term.fit();

    const state = { sessionId: null as string | null };

    const logicalCanvasSize = () => term.logicalCanvasSize();

    // Do not assign application shortcuts while xterm has focus: every key
    // belongs to the foreground terminal program. xterm 6 collapses all
    // modified Enter keys to plain CR, however, so preserve that browser input
    // as a CSI-u key event. This is transport encoding, not a TanWords action;
    // Herdr (or any other foreground TUI) remains responsible for its meaning.
    term.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase();
      const modifierBits = Number(event.shiftKey)
        | (Number(event.altKey) << 1)
        | (Number(event.ctrlKey) << 2)
        | (Number(event.metaKey) << 3);
      if (key === "enter" && modifierBits !== 0) {
        if (event.type === "keydown") {
          event.preventDefault();
          if (state.sessionId) {
            void callMain("pty_write", {
              id: state.sessionId,
              data: b64EncodeUtf8(`\x1b[13;${modifierBits + 1}u`),
            }).catch(() => {});
          }
        }
        return false;
      }
      return true;
    });

    // Keep the session in step with this component's lifetime.
    let alive = true;
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

    let fitFrame: number | null = null;
    let lastPtyCols = 0;
    let lastPtyRows = 0;
    let lastPtyPixelWidth = -1;
    let lastPtyPixelHeight = -1;
    const syncPtySize = () => {
      if (!state.sessionId) return;
      const { pixelWidth, pixelHeight } = logicalCanvasSize();
      if (
        term.cols === lastPtyCols
        && term.rows === lastPtyRows
        && pixelWidth === lastPtyPixelWidth
        && pixelHeight === lastPtyPixelHeight
      ) return;
      lastPtyCols = term.cols;
      lastPtyRows = term.rows;
      lastPtyPixelWidth = pixelWidth;
      lastPtyPixelHeight = pixelHeight;
      void callMain("pty_resize", {
        id: state.sessionId,
        cols: term.cols,
        rows: term.rows,
        pixelWidth,
        pixelHeight,
      }).catch(() => {});
    };

    // Layout transitions and window drags can deliver many ResizeObserver
    // callbacks in one paint. Fit at most once per animation frame and only
    // send the PTY a resize when its grid or logical viewport actually changed.
    const refit = () => {
      // A persistent Terminal page is `display: none` while another route is in
      // front. Do not collapse the live PTY to xterm's minimum dimensions.
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      if (fitFrame !== null) return;
      // The sentinel also keeps this correct under synchronous RAF shims used
      // by tests and a few embedded webviews.
      fitFrame = -1;
      const scheduledFrame = window.requestAnimationFrame(() => {
        fitFrame = null;
        if (!alive || el.clientWidth === 0 || el.clientHeight === 0) return;
        term.fit();
        syncPtySize();
      });
      if (fitFrame !== null) fitFrame = scheduledFrame;
    };
    refitRef.current = refit;

    // ── events ────────────────────────────────────────────────────────
    const offs = [
      subscribe<{ id: string; data?: unknown }>("pty:data", ({ id, data }) => {
        if (state.sessionId !== id || !alive) return;
        try {
          const bytes = terminalOutputBytes(data);
          if (!bytes?.byteLength) return;
          enqueueOutput(bytes);
        } catch {
          // A malformed/late transport event must not take down the React tree
          // or the other terminal tabs. The live session can keep streaming.
        }
      }),
      subscribe<{ id: string; code?: number; error?: string }>("pty:exit", ({ id, code, error }) => {
        if (state.sessionId !== id || !alive) return;
        state.sessionId = null;
        if ((code ?? 1) === 0) {
          setStatus("closed");
          onSessionExitRef.current?.();
          return;
        }
        recoverAfterFailure(error || t("toolsPage.terminal.recovering"));
      }),
    ];

    // ── spawn ─────────────────────────────────────────────────────────
    const spawn = async () => {
      try {
        const info = await callMain<{ id: string; shell: string; cwd: string; pid: number }>(
          "pty_spawn",
          { cols: term.cols, rows: term.rows, ...logicalCanvasSize(), shellPath },
        );
        if (!alive) {
          // Unmount can win the race with a slow spawn handshake. Close the
          // newly-created backend session instead of leaking an orphan shell.
          void callMain("pty_close", { id: info.id }).catch(() => {});
          return;
        }
        state.sessionId = info.id;
        lastPtyCols = term.cols;
        lastPtyRows = term.rows;
        ({ pixelWidth: lastPtyPixelWidth, pixelHeight: lastPtyPixelHeight } = logicalCanvasSize());
        setStatus("connected");
        onSessionReadyRef.current?.(info.shell);
        // A session that remains healthy for a while earns a fresh recovery
        // budget; rapid crash loops still stop after the bounded retry count.
        stabilityTimer = setTimeout(() => {
          recoveryAttemptsRef.current = 0;
        }, 30_000);
      } catch (err) {
        if (!alive) return;
        recoverAfterFailure(err instanceof Error ? err.message : String(err));
      }
    };
    void spawn();

    // ── input & resize ────────────────────────────────────────────────
    const onData = term.onData((data) => {
      if (!state.sessionId) return;
      void callMain("pty_write", { id: state.sessionId, data: b64EncodeUtf8(data) }).catch(() => {});
    });
    const onResize = term.onResize(() => {
      syncPtySize();
    });
    // Shells already announce their cwd and foreground command over OSC 0/2.
    // Forward that to whoever owns the tab strip; a tab reading `~/projects/demo`
    // or `npm run build` is what makes two persistent shells tellable apart.
    const onTitleChange = term.onTitleChange((title) => {
      if (!alive) return;
      onShellTitleChangeRef.current?.(shellTabTitle(title));
    });

    // Resize the pty whenever the page layout changes (sidebar toggle, window
    // drag, fullscreen, ...). Observing the shell catches all of those because
    // its box is what xterm sizes to.
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    // Chromium updates device metrics when a window crosses displays even when
    // its CSS box stays the same, so ResizeObserver alone cannot cover DPR-only
    // changes.
    window.addEventListener("resize", refit);

    const onFocus = () => term.focus();
    el.addEventListener("focus", onFocus);

    // ── teardown ──────────────────────────────────────────────────────
    return () => {
      alive = false;
      if (state.sessionId) callMain("pty_close", { id: state.sessionId }).catch(() => {});
      if (retryTimer) clearTimeout(retryTimer);
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      onData.dispose();
      onResize.dispose();
      onTitleChange.dispose();
      // A restart replaces the shell behind this tab. Retiring the title with
      // the session keeps the tab from advertising a directory nothing is in.
      onShellTitleChangeRef.current?.("");
      ro.disconnect();
      window.removeEventListener("resize", refit);
      el.removeEventListener("focus", onFocus);
      offs.forEach((off) => off());
      term.dispose();
      outputQueue.length = 0;
      outputQueueHead = 0;
      outputPendingBytes = 0;
      refitRef.current = () => {};
      if (terminalRef.current === term) terminalRef.current = null;
    };
    };

    if (engine === "xterm") {
      unmountSurface = mountSurface(createXtermSurface(surfaceOptions)) ?? null;
    } else {
      void import("./ghosttySurface")
        .then(({ createGhosttySurface }) => createGhosttySurface(surfaceOptions))
        .then((surface) => {
          unmountSurface = mountSurface(surface) ?? null;
        })
        .catch((error) => {
          if (cancelled) return;
          setStatus("error");
          setMessage(error instanceof Error ? error.message : String(error));
        });
    }

    return () => {
      cancelled = true;
      unmountSurface?.();
    };
  }, [engine, sessionGeneration]);

  // WebGL is fast for an opaque terminal, but its dim-text glyph atlas can
  // reveal opaque black cell rectangles when composited onto a transparent
  // canvas (notably around Vite/Rollup's subdued file-size output). Use xterm's
  // built-in renderer for the glass mode so ANSI foreground styles remain
  // transparent; explicit ANSI backgrounds used by full-screen TUIs still
  // render normally. Auto selects that safe combination; Settings can override
  // it for users who prefer consistent performance or rendering behaviour.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.applyRenderer(terminalRenderer, effectiveTransparent);
  }, [effectiveTransparent, sessionGeneration, terminalRenderer]);

  // Keep xterm's idea of the default cell background aligned with the shell.
  // In particular, reverse-video cells should resolve against the selected
  // solid colour instead of xterm's transparent-background fallback.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.applyTheme({
      ...terminalThemeFor(terminalColorScheme),
      foreground: terminalTextColor,
      background: effectiveTransparent ? "rgba(0, 0, 0, 0)" : terminalBackgroundColor,
    });
  }, [effectiveTransparent, sessionGeneration, terminalBackgroundColor, terminalColorScheme, terminalTextColor]);

  // Search the actual xterm scrollback buffer. Incremental searches preserve a
  // matching selection while the query grows; explicit navigation starts from
  // the current match instead.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term?.supportsSearch) return;
    if (!searchOpen || !searchQuery) {
      term.clearSearchDecorations();
      setSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    term.findNext(searchQuery, searchCaseSensitive, true);
  }, [searchCaseSensitive, searchOpen, searchQuery, sessionGeneration]);

  useEffect(() => {
    if (!searchOpen || !visible) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen, visible]);

  // Typography changes are live options: updating them must not recreate the
  // Terminal instance (and therefore must not terminate the running PTY).
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.applyTypography(terminalFontStack(terminalFontFamily), terminalFontSize, terminalFontWeight);
    const frame = window.requestAnimationFrame(() => refitRef.current());
    return () => window.cancelAnimationFrame(frame);
  }, [terminalFontFamily, terminalFontSize, terminalFontWeight]);

  // MainLayout changes two large boxes when maximize toggles. ResizeObserver
  // normally catches that, and this scheduled fit also covers hosts where the
  // observer coalesces the transition away.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => refitRef.current());
    return () => window.cancelAnimationFrame(frame);
  }, [maximized]);

  // ── maximize toggle ─────────────────────────────────────────────────
  const toggleFullscreen = () => {
    onMaximizedChange(!maximized);
  };

  const toggleAppearanceControls = () => {
    // This button only reveals the controls. Appearance changes belong to the
    // controls themselves, so opening or closing cannot rewrite a preset.
    setAppearanceControlsOpen((open) => !open);
  };

  const restartTerminal = () => {
    recoveryAttemptsRef.current = 0;
    setSessionGeneration((generation) => generation + 1);
  };

  const closeSearch = () => {
    terminalRef.current?.clearSearchDecorations();
    setSearchResult({ resultIndex: -1, resultCount: 0 });
    setSearchOpen(false);
    window.requestAnimationFrame(() => terminalRef.current?.focus());
  };

  const findNext = () => {
    if (!searchQuery) return;
    terminalRef.current?.findNext(searchQuery, searchCaseSensitive);
  };

  const findPrevious = () => {
    if (!searchQuery) return;
    terminalRef.current?.findPrevious(searchQuery, searchCaseSensitive);
  };

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const term = terminalRef.current;
    if (!term?.hasSelection()) {
      // Full-screen terminal programs can draw and handle their own mouse menus.
      // With no xterm selection there is nothing for TanWords to copy, so keep
      // our overlay out of the way while still suppressing Chromium's menu.
      setContextMenu(null);
      return;
    }
    const width = 184;
    const height = 112;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
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
        {/* One compact row for both workspace tabs and terminal actions. */}
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

          {engine === "xterm" && <Button
            variant="ghost"
            size="icon"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            title={t("toolsPage.terminal.search")}
            aria-label={t("toolsPage.terminal.search")}
            aria-pressed={searchOpen}
            className={`h-9 w-9 shrink-0 rounded-lg ${
              searchOpen ? "bg-primary/15 text-primary" : "text-foreground/80"
            }`}
          >
            <Search className="h-4 w-4" />
          </Button>}

          {/* glass / transparency controls toggle */}
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
                : effectiveTransparent
                  ? "text-primary"
                  : "text-foreground/80"
            }`}
          >
            <Droplets className="h-4 w-4" />
          </Button>

          {/* fullscreen toggle */}
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

        {/* Keep appearance settings on their own row. They otherwise compete
            with the tabs and terminal actions for horizontal space. */}
        {appearanceControlsOpen && (
          <div
            role="group"
            aria-label={t("toolsPage.terminal.appearance")}
            className="app-region-no-drag flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 bg-transparent px-4 py-2 sm:px-6"
          >
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
                  <SelectItem value="light">{t("toolsPage.terminal.themeLight")}</SelectItem>
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

        {engine === "xterm" && searchOpen && (
          <div
            role="search"
            className="terminal-search-bar flex shrink-0 items-center gap-1.5 border-t border-border/70 bg-transparent px-3 py-1.5 shadow-sm sm:px-6"
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.shiftKey) findPrevious();
                  else findNext();
                }
              }}
              aria-label={t("toolsPage.terminal.searchInput")}
              placeholder={t("toolsPage.terminal.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            <span
              aria-live="polite"
              className="min-w-12 text-right text-[10px] tabular-nums text-muted-foreground"
            >
              {searchQuery
                ? searchResult.resultCount > 0
                  ? searchResult.resultIndex >= 0
                    ? `${searchResult.resultIndex + 1} / ${searchResult.resultCount}`
                    : `${searchResult.resultCount}+`
                  : t("toolsPage.terminal.noMatches")
                : ""}
            </span>
            <button
              type="button"
              onClick={() => setSearchCaseSensitive((value) => !value)}
              title={t("toolsPage.terminal.matchCase")}
              aria-label={t("toolsPage.terminal.matchCase")}
              aria-pressed={searchCaseSensitive}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold transition-colors ${
                searchCaseSensitive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              Aa
            </button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!searchQuery}
              onClick={findPrevious}
              title={t("toolsPage.terminal.previousMatch")}
              aria-label={t("toolsPage.terminal.previousMatch")}
              className="h-7 w-7 shrink-0 rounded-md text-muted-foreground"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!searchQuery}
              onClick={findNext}
              title={t("toolsPage.terminal.nextMatch")}
              aria-label={t("toolsPage.terminal.nextMatch")}
              className="h-7 w-7 shrink-0 rounded-md text-muted-foreground"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={closeSearch}
              title={t("toolsPage.terminal.closeSearch")}
              aria-label={t("toolsPage.terminal.closeSearch")}
              className="h-7 w-7 shrink-0 rounded-md text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* xterm shell — fills the remaining height. The measured host is a
            padding-free child: FitAddon measures the parent of `.xterm`, so
            putting padding/borders on that same element can over-report its
            drawable height and clip the final row at certain window sizes. */}
        <div
          onContextMenu={openContextMenu}
          className="terminal-tool-shell relative min-h-0 flex-1 overflow-hidden rounded-none border-x-0 border-b-0 border-t border-border p-2"
          style={
            effectiveTransparent
              ? {
                  // The user-chosen background colour remains a translucent tint
                  // while the wallpaper itself stays sharp.
                  // The app's own background map already dims the wallpaper
                  // (bg-black/45 dark / 20 light), so this scrim keeps text
                  // legible without reading as opaque.
                  background: terminalBackgroundRgba(terminalBackgroundColor, backgroundOpacity),
                }
              : { background: terminalBackgroundColor }
          }
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
            disabled={!contextMenu.canCopy}
            onClick={() => runMenuAction(copySelectionWithFeedback)}
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

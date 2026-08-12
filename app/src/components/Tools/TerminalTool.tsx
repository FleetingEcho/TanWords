/** Desktop Terminal page: a local shell over xterm.js.
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
 *  so it takes all the leftover height. The standalone page owns maximize
 *  state, allowing MainLayout to remove its chrome without moving the terminal
 *  into the browser fullscreen API or recreating its PTY. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Droplets,
  ExternalLink,
  History,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { subscribe } from "@/ipc/events";
import { callMain } from "@/ipc/host";
import { openExternal } from "@/ipc/shell";
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
const TERMINAL_SCROLLBACK_LINES = 5_000;
const HERDR_URL = "https://github.com/herdrdev/herdr";
// Full-screen TUIs such as Herdr can legitimately repaint several MiB while
// xterm is still completing its first asynchronous write. Keep that finite
// startup intact while retaining a hard bound for genuinely runaway output.
const MAX_PENDING_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_AUTOMATIC_RECOVERY_ATTEMPTS = 3;
const SEARCH_DECORATIONS: NonNullable<ISearchOptions["decorations"]> = {
  matchBackground: "#5f4a18",
  matchBorder: "#c99b26",
  matchOverviewRuler: "#c99b26",
  activeMatchBackground: "#b85f14",
  activeMatchBorder: "#ffd166",
  activeMatchColorOverviewRuler: "#ffd166",
};

function terminalSearchOptions(caseSensitive: boolean, incremental = false): ISearchOptions {
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

export function TerminalTool({
  onBack,
  visible = true,
  shellPath = "",
  onSessionReady,
  onSessionExit,
  tabBar,
  maximized = false,
  onMaximizedChange = () => {},
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
  maximized?: boolean;
  onMaximizedChange?: (maximized: boolean) => void;
}) {
  const t = useT();
  const shellRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const refitRef = useRef<() => void>(() => {});
  const onSessionExitRef = useRef(onSessionExit);
  onSessionExitRef.current = onSessionExit;
  const onSessionReadyRef = useRef(onSessionReady);
  onSessionReadyRef.current = onSessionReady;
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
      // SearchAddon uses xterm's decoration and overview-ruler APIs to paint
      // all matches. xterm 6 still marks those APIs as proposed and throws at
      // the first search unless the embedding terminal opts in explicitly.
      allowProposedApi: true,
      // WebGL paints into a canvas. Preserve its alpha channel so the terminal
      // glass controls continue to reveal the app wallpaper underneath it.
      allowTransparency: true,
      fontFamily: terminalFontStack(terminalFontFamily),
      // WebGL's color parser treats the CSS keyword `transparent` as opaque
      // black. An explicit alpha channel is required for a clear framebuffer.
      theme: { background: "rgba(0, 0, 0, 0)" },
      // Scrollback lives in xterm's JS buffer, independently of the WebGL
      // canvas renderer. Keep a generous daily-development history without the
      // excessive aggregate memory exposure across two persistent tabs. The
      // usual Herdr workflow owns its larger pane history outside this buffer.
      scrollback: TERMINAL_SCROLLBACK_LINES,
    });
    terminalRef.current = term;
    const fit = new FitAddon();
    const searchAddon = new SearchAddon({ highlightLimit: 1000 });
    searchAddonRef.current = searchAddon;
    term.loadAddon(fit);
    term.loadAddon(searchAddon);
    const searchResultsSubscription = searchAddon.onDidChangeResults((result) => {
      setSearchResult(result);
    });
    term.open(el);
    setStatus("starting");
    setMessage("");

    // xterm's writes are asynchronous. Feed it one chunk at a time and cap the
    // waiting queue so a command that prints indefinitely cannot retain
    // unlimited decoded output in the renderer while Chromium is busy painting.
    const outputQueue: Uint8Array[] = [];
    let outputQueueBytes = 0;
    let outputWriting = false;
    let droppedOutput = false;
    let outputSuppressed = false;
    const setOutputSuppressed = (suppressed: boolean) => {
      if (!state.sessionId || outputSuppressed === suppressed) return;
      outputSuppressed = suppressed;
      void callMain("pty_set_output_suppressed", { id: state.sessionId, suppressed }).catch(() => {});
    };
    const pumpOutput = () => {
      if (!alive || outputWriting) return;
      const data = outputQueue.shift();
      if (!data) {
        if (!droppedOutput) return;
        droppedOutput = false;
        outputWriting = true;
        const notice = encoder.encode(`\r\n[TanWords] ${t("toolsPage.terminal.outputTruncated")}\r\n`);
        term.write(notice, () => {
          outputWriting = false;
          setOutputSuppressed(false);
          pumpOutput();
        });
        return;
      }
      outputQueueBytes -= data.byteLength;
      outputWriting = true;
      term.write(data, () => {
        outputWriting = false;
        pumpOutput();
      });
    };
    const enqueueOutput = (data: Uint8Array) => {
      let discarded = false;
      while (outputQueue.length > 0 && outputQueueBytes + data.byteLength > MAX_PENDING_OUTPUT_BYTES) {
        outputQueueBytes -= outputQueue.shift()!.byteLength;
        discarded = true;
      }
      const bounded = data.byteLength > MAX_PENDING_OUTPUT_BYTES
        ? data.slice(data.byteLength - MAX_PENDING_OUTPUT_BYTES)
        : data;
      if (bounded.byteLength !== data.byteLength) discarded = true;
      if (discarded) {
        droppedOutput = true;
        setOutputSuppressed(true);
      }
      outputQueue.push(bounded);
      outputQueueBytes += bounded.byteLength;
      pumpOutput();
    };

    // Prefer xterm's GPU-backed canvas renderer. Unsupported/blocked WebGL2
    // contexts throw here, in which case xterm's built-in DOM renderer remains
    // active. Context loss later follows the same safe fallback path.
    let webgl: WebglAddon | null = null;
    let contextLossSubscription: { dispose: () => void } | null = null;
    try {
      const webglAddon = new WebglAddon();
      webgl = webglAddon;
      contextLossSubscription = webglAddon.onContextLoss(() => {
        // xterm falls back to its built-in renderer after the GPU context is
        // lost. Dispose promptly so a dead canvas cannot retain GPU memory.
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      webgl?.dispose();
      // DOM rendering is already active; no recovery work is required.
    }
    fit.fit();

    // Terminal-aware clipboard shortcuts. Ctrl+C remains SIGINT when there is
    // no selection; with a selection it copies instead. Ctrl/Cmd+V uses the
    // native clipboard so Electron can also materialize copied images. Search
    // stays in the renderer and never sends the query to the shell.
    term.attachCustomKeyEventHandler((event) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "f") {
        if (event.type === "keydown") {
          event.preventDefault();
          setSearchOpen(true);
        }
        return false;
      }
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
    const syncPtySize = () => {
      if (!state.sessionId || (term.cols === lastPtyCols && term.rows === lastPtyRows)) return;
      lastPtyCols = term.cols;
      lastPtyRows = term.rows;
      void callMain("pty_resize", {
        id: state.sessionId,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => {});
    };

    // Layout transitions and window drags can deliver many ResizeObserver
    // callbacks in one paint. Fit at most once per animation frame and only
    // send the PTY a resize when its rows or columns actually changed.
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
        fit.fit();
        syncPtySize();
      });
      if (fitFrame !== null) fitFrame = scheduledFrame;
    };
    refitRef.current = refit;

    // ── events ────────────────────────────────────────────────────────
    const offs = [
      subscribe<{ id: string; data?: string }>("pty:data", ({ id, data }) => {
        if (state.sessionId !== id || !alive) return;
        if (!data) return;
        try {
          enqueueOutput(bytesFromB64(data));
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
          { cols: term.cols, rows: term.rows, shellPath },
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
      if (retryTimer) clearTimeout(retryTimer);
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      contextLossSubscription?.dispose();
      searchResultsSubscription.dispose();
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      el.removeEventListener("focus", onFocus);
      offs.forEach((off) => off());
      term.dispose();
      outputQueue.length = 0;
      outputQueueBytes = 0;
      refitRef.current = () => {};
      if (terminalRef.current === term) terminalRef.current = null;
      if (searchAddonRef.current === searchAddon) searchAddonRef.current = null;
    };
  }, [sessionGeneration]);

  // Search the actual xterm scrollback buffer. Incremental searches preserve a
  // matching selection while the query grows; explicit navigation starts from
  // the current match instead.
  useEffect(() => {
    const addon = searchAddonRef.current;
    if (!addon) return;
    if (!searchOpen || !searchQuery) {
      addon.clearDecorations();
      setSearchResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    // Vite Fast Refresh can preserve an xterm instance that was constructed
    // before decorated search was enabled. Update the live option immediately
    // before using SearchAddon's proposed decoration API as well as setting the
    // constructor default above.
    if (terminalRef.current) terminalRef.current.options.allowProposedApi = true;
    addon.findNext(searchQuery, terminalSearchOptions(searchCaseSensitive, true));
  }, [searchCaseSensitive, searchOpen, searchQuery, sessionGeneration]);

  useEffect(() => {
    if (!searchOpen || !visible) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen, visible]);

  // Catch find while focus is on the toolbar/search controls as well as in the
  // xterm canvas. Hidden persistent terminal tabs must not compete for it.
  useEffect(() => {
    if (!visible) return;
    const openSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(true);
      if (searchOpen) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener("keydown", openSearch, true);
    return () => document.removeEventListener("keydown", openSearch, true);
  }, [searchOpen, visible]);

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
    // The first time someone opens the glass controls, preview and keep the
    // effect. Subsequent clicks only collapse/expand the controls.
    if (!transparent) setTransparent(true);
    setAppearanceControlsOpen((open) => !open);
  };

  const restartTerminal = () => {
    recoveryAttemptsRef.current = 0;
    setSessionGeneration((generation) => generation + 1);
  };

  const closeSearch = () => {
    searchAddonRef.current?.clearDecorations();
    setSearchResult({ resultIndex: -1, resultCount: 0 });
    setSearchOpen(false);
    window.requestAnimationFrame(() => terminalRef.current?.focus());
  };

  const findNext = () => {
    if (!searchQuery) return;
    if (terminalRef.current) terminalRef.current.options.allowProposedApi = true;
    searchAddonRef.current?.findNext(
      searchQuery,
      terminalSearchOptions(searchCaseSensitive),
    );
  };

  const findPrevious = () => {
    if (!searchQuery) return;
    if (terminalRef.current) terminalRef.current.options.allowProposedApi = true;
    searchAddonRef.current?.findPrevious(
      searchQuery,
      terminalSearchOptions(searchCaseSensitive),
    );
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
      aria-hidden={!visible}
      className="terminal-tool-outer relative h-full w-full"
    >
      <div className="flex h-full flex-col">
        {/* toolbar */}
        <div className="app-drag-region flex shrink-0 flex-wrap items-center gap-3 px-4 sm:px-6">
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

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  aria-label={t("toolsPage.terminal.scrollbackTooltip")}
                  className="app-region-no-drag flex cursor-help items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary/90 outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <History className="h-3 w-3" aria-hidden="true" />
                  {t("toolsPage.terminal.scrollbackBadge")}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-72 leading-relaxed">
                <p className="font-medium text-popover-foreground">
                  {t("toolsPage.terminal.scrollbackLimit")}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {t("toolsPage.terminal.scrollbackHerdrRecommendation")}
                </p>
                <a
                  href={HERDR_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    void openExternal(HERDR_URL).catch(() => {
                      window.open(HERDR_URL, "_blank", "noopener,noreferrer");
                    });
                  }}
                  className="app-region-no-drag mt-2 inline-flex items-center gap-1 font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("toolsPage.terminal.openHerdr")}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

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

          <Button
            variant="ghost"
            size="icon"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            title={t("toolsPage.terminal.search")}
            aria-label={t("toolsPage.terminal.search")}
            aria-pressed={searchOpen}
            className={`h-9 w-9 shrink-0 rounded-lg ${
              searchOpen ? "bg-primary/15 text-primary" : "text-muted-foreground"
            }`}
          >
            <Search className="h-4 w-4" />
          </Button>

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
            title={maximized ? t("toolsPage.terminal.restore") : t("toolsPage.terminal.maximize")}
            aria-label={maximized ? t("toolsPage.terminal.restore") : t("toolsPage.terminal.maximize")}
            className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground"
          >
            {maximized ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>

        {tabBar}

        {searchOpen && (
          <div
            role="search"
            className="terminal-search-bar flex shrink-0 items-center gap-1.5 border-t border-border/70 bg-background/75 px-3 py-1.5 shadow-sm backdrop-blur-md sm:px-6"
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

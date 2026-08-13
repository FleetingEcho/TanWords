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
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import {
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { subscribe } from "@/ipc/events";
import { callMain } from "@/ipc/host";
import { openExternal } from "@/ipc/shell";
import { useSettingsStore } from "@/store/settingsStore";
import { useFullscreenDragExit } from "@/hooks/useFullscreenDragExit";
import type { ContextMenuPosition, TerminalClipboard } from "./terminalUtils";
import {
  HERDR_URL,
  MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
  MAX_PENDING_OUTPUT_BYTES,
  TERMINAL_SCROLLBACK_LINES,
  terminalThemeFor,
  bytesFromB64,
  b64EncodeUtf8,
  encoder,
  quoteTerminalPath,
  shellTabTitle,
  terminalBackgroundRgba,
  terminalFontStack,
  terminalSearchOptions,
} from "./terminalUtils";

export function TerminalTool({
  onBack,
  visible = true,
  shellPath = "",
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
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const refitRef = useRef<() => void>(() => {});
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const webglContextLossSubscriptionRef = useRef<{ dispose: () => void } | null>(null);
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
  const terminalBackgroundColor = useSettingsStore((state) => state.terminalBackgroundColor);
  const setTerminalBackgroundColor = useSettingsStore((state) => state.setTerminalBackgroundColor);
  const terminalTextColor = useSettingsStore((state) => state.terminalTextColor);
  const setTerminalTextColor = useSettingsStore((state) => state.setTerminalTextColor);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const setTerminalColorScheme = useSettingsStore((state) => state.setTerminalColorScheme);
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
      // Full-screen TUIs commonly use inverse video for focused inputs. With a
      // transparent light palette that swaps a dark default foreground onto a
      // dark row while the transparent background cannot supply a light glyph
      // colour. Let xterm correct those glyphs to accessible contrast without
      // changing the user's palette or making the glass canvas opaque.
      minimumContrastRatio: 4.5,
      fontFamily: terminalFontStack(terminalFontFamily),
      fontWeight: terminalFontWeight,
      fontWeightBold: Math.max(700, terminalFontWeight),
      theme: {
        ...terminalThemeFor(terminalColorScheme),
        foreground: terminalTextColor,
        // An opaque terminal can give WebGL its real backing colour. Glass
        // mode keeps the canvas clear and uses the shell tint below instead.
        background: transparent ? "rgba(0, 0, 0, 0)" : terminalBackgroundColor,
      },
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

    fit.fit();

    const state = { sessionId: null as string | null };

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

    const onFocus = () => term.focus();
    el.addEventListener("focus", onFocus);

    // ── teardown ──────────────────────────────────────────────────────
    return () => {
      alive = false;
      if (state.sessionId) callMain("pty_close", { id: state.sessionId }).catch(() => {});
      if (retryTimer) clearTimeout(retryTimer);
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      webglContextLossSubscriptionRef.current?.dispose();
      webglContextLossSubscriptionRef.current = null;
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
      searchResultsSubscription.dispose();
      onData.dispose();
      onResize.dispose();
      onTitleChange.dispose();
      // A restart replaces the shell behind this tab. Retiring the title with
      // the session keeps the tab from advertising a directory nothing is in.
      onShellTitleChangeRef.current?.("");
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

    const disposeWebgl = () => {
      webglContextLossSubscriptionRef.current?.dispose();
      webglContextLossSubscriptionRef.current = null;
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
    };

    disposeWebgl();
    const useWebgl = terminalRenderer === "webgl"
      || (terminalRenderer === "auto" && !transparent);
    if (!useWebgl) return;

    try {
      const webglAddon = new WebglAddon();
      webglAddonRef.current = webglAddon;
      webglContextLossSubscriptionRef.current = webglAddon.onContextLoss(disposeWebgl);
      term.loadAddon(webglAddon);
    } catch {
      disposeWebgl();
      // xterm's built-in renderer is already active.
    }

    return disposeWebgl;
  }, [sessionGeneration, terminalRenderer, transparent]);

  // Keep xterm's idea of the default cell background aligned with the shell.
  // In particular, reverse-video cells should resolve against the selected
  // solid colour instead of xterm's transparent-background fallback.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.theme = {
      ...terminalThemeFor(terminalColorScheme),
      foreground: terminalTextColor,
      background: transparent ? "rgba(0, 0, 0, 0)" : terminalBackgroundColor,
    };
  }, [sessionGeneration, terminalBackgroundColor, terminalColorScheme, terminalTextColor, transparent]);

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

  // Typography changes are live options: updating them must not recreate the
  // Terminal instance (and therefore must not terminate the running PTY).
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = terminalFontStack(terminalFontFamily);
    term.options.fontSize = terminalFontSize;
    term.options.fontWeight = terminalFontWeight;
    term.options.fontWeightBold = Math.max(700, terminalFontWeight);
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
          } flex min-w-0 shrink-0 items-center border-y border-border bg-background/80 text-foreground shadow-sm backdrop-blur-md`}
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

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  aria-label={t("toolsPage.terminal.scrollbackTooltip")}
                  className="app-region-no-drag flex cursor-help items-center gap-1 rounded-full border border-primary/30 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
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
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            title={t("toolsPage.terminal.search")}
            aria-label={t("toolsPage.terminal.search")}
            aria-pressed={searchOpen}
            className={`h-9 w-9 shrink-0 rounded-lg ${
              searchOpen ? "bg-primary/15 text-primary" : "text-foreground/80"
            }`}
          >
            <Search className="h-4 w-4" />
          </Button>

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
                : transparent
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
            className="app-region-no-drag flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 bg-background/55 px-4 py-2 backdrop-blur-md sm:px-6"
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
                  className="h-7 w-32 border-border bg-background/70 px-2 py-0 text-[11px] focus:ring-1 focus:ring-ring focus:ring-offset-0"
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
                  // The user-chosen background colour as a translucent tint
                  // over the wallpaper; backdrop-blur does the real frosting.
                  // The app's own background map already dims the wallpaper
                  // (bg-black/45 dark / 20 light), so this scrim keeps text
                  // legible without reading as opaque.
                  background: terminalBackgroundRgba(terminalBackgroundColor, backgroundOpacity),
                  backdropFilter: `blur(${blur}px)`,
                  WebkitBackdropFilter: `blur(${blur}px)`,
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

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
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { RotateCcw } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import "@/styles/terminal-tool.css";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { callMain } from "@/ipc/host";
import { useSettingsStore } from "@/store/settingsStore";
import { useFullscreenDragExit } from "@/hooks/useFullscreenDragExit";
import type { ContextMenuPosition, TerminalClipboard } from "./terminalUtils";
import {
  terminalThemeFor,
  terminalBackgroundRgba,
  terminalFontStack,
  terminalSearchOptions,
  quoteTerminalPath,
} from "./terminalUtils";
import { useTerminalSession } from "./useTerminalSession";
import {
  TerminalToolbar,
  TerminalAppearanceControls,
  TerminalSearchBar,
} from "./TerminalToolParts";

export function TerminalTool({
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
  /** Captured by the tab at creation time; changing Settings won't restart it. */
  shellPath?: string;
  /** This tab's current terminal engine ("xterm", since this is `TerminalTool`)
   *  and its setter, shown as a switch in the appearance panel — see
   *  `TerminalEngineSwitch`. Omitted only in tests that don't exercise it. */
  engine?: import("@/store/settings/types").TerminalEngine;
  onEngineChange?: (engine: import("@/store/settings/types").TerminalEngine) => void;
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
  const restoreFromToolbarGesture = useCallback(() => onMaximizedChange(false), [onMaximizedChange]);
  const {
    fullScreen,
    onMouseDown: onToolbarMouseDown,
    onDoubleClick: onToolbarDoubleClick,
  } = useFullscreenDragExit({
    immersive: maximized,
    onExitImmersive: restoreFromToolbarGesture,
  });
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
  // transparent background. That persisted preference is intentionally separate below.
  const [appearanceControlsOpen, setAppearanceControlsOpen] = useState(false);
  const transparent = useSettingsStore((state) => state.terminalTransparent);
  const backgroundOpacity = useSettingsStore((state) => state.terminalBackgroundOpacity);
  const backgroundBlur = useSettingsStore((state) => state.terminalBackgroundBlur);
  const terminalBackgroundColor = useSettingsStore((state) => state.terminalBackgroundColor);
  const terminalTextColor = useSettingsStore((state) => state.terminalTextColor);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  // Custom exposes opacity directly in this toolbar, so a value below 100%
  // must use the glass rendering path even for older saved appearances whose
  // separate `transparent` flag was false.
  const effectiveTransparent = transparent
    || (terminalColorScheme === "custom" && backgroundOpacity < 100);
  const terminalRenderer = useSettingsStore((state) => state.terminalRenderer);
  const terminalFontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const terminalFontWeight = useSettingsStore((state) => state.terminalFontWeight);

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

  useTerminalSession({
    shellRef,
    terminalRef,
    searchAddonRef,
    refitRef,
    webglAddonRef,
    webglContextLossSubscriptionRef,
    onSessionExitRef,
    onSessionReadyRef,
    onShellTitleChangeRef,
    recoveryAttemptsRef,
    setStatus,
    setMessage,
    setSessionGeneration,
    setSearchResult,
    shellPath,
    t,
    terminalFontSize,
    terminalColorScheme,
    terminalTextColor,
    terminalBackgroundColor,
    effectiveTransparent,
    terminalFontFamily,
    terminalFontWeight,
    sessionGeneration,
  });

  // WebGL is fast for an opaque terminal, but its dim-text glyph atlas can
  // reveal opaque black cell rectangles when composited onto a transparent
  // canvas (notably around Vite/Rollup's subdued file-size output). Use xterm's
  // built-in renderer for the glass mode so ANSI foreground styles remain
  // transparent; explicit ANSI backgrounds used by full-screen TUIs still
  // render normally. Auto selects that safe combination; Settings can override
  // it for users who prefer consistent performance or rendering behaviour.
  // A hidden retained tab keeps its Terminal and PTY alive, but has nothing to
  // paint, so release WebGL's context/textures until that tab becomes visible
  // again. The built-in renderer remains available throughout that interval.
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
      || (terminalRenderer === "auto" && !effectiveTransparent);
    if (!visible || !useWebgl) return;

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
  }, [effectiveTransparent, sessionGeneration, terminalRenderer, visible]);

  // Keep xterm's idea of the default cell background aligned with the shell.
  // In particular, reverse-video cells should resolve against the selected
  // solid colour instead of xterm's transparent-background fallback.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.theme = {
      ...terminalThemeFor(terminalColorScheme),
      foreground: terminalTextColor,
      background: effectiveTransparent ? terminalBackgroundRgba(terminalBackgroundColor, 0) : terminalBackgroundColor,
    };
  }, [effectiveTransparent, sessionGeneration, terminalBackgroundColor, terminalColorScheme, terminalTextColor]);

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
    // This button only reveals the controls. Appearance changes belong to the
    // controls themselves, so opening or closing cannot rewrite a preset.
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
        <TerminalToolbar
          tabBar={tabBar}
          status={status}
          searchOpen={searchOpen}
          appearanceControlsOpen={appearanceControlsOpen}
          effectiveTransparent={effectiveTransparent}
          maximized={maximized}
          fullScreen={fullScreen}
          onToolbarMouseDown={onToolbarMouseDown}
          onToolbarDoubleClick={onToolbarDoubleClick}
          closeSearch={closeSearch}
          setSearchOpen={setSearchOpen}
          toggleAppearanceControls={toggleAppearanceControls}
          toggleFullscreen={toggleFullscreen}
        />

        {/* Keep appearance settings on their own row. They otherwise compete
            with the tabs and terminal actions for horizontal space. */}
        {appearanceControlsOpen && (
          <TerminalAppearanceControls engine={engine} onEngineChange={onEngineChange} />
        )}

        {searchOpen && (
          <TerminalSearchBar
            searchInputRef={searchInputRef}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchCaseSensitive={searchCaseSensitive}
            setSearchCaseSensitive={setSearchCaseSensitive}
            searchResult={searchResult}
            closeSearch={closeSearch}
            findNext={findNext}
            findPrevious={findPrevious}
          />
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
                  // xterm's DOM renderer draws default-foreground dim text
                  // (SGR 2 — most CLIs' secondary/description lines) by
                  // halving the *foreground*'s alpha, not by mixing toward a
                  // shade. Stacked on top of this pane's own translucent
                  // background, that second alpha layer can wash dim text
                  // out to near-invisible on a light glass theme (dark text
                  // at 50% alpha over a light backdrop reads as light-on-
                  // light). terminal-tool.css's `.xterm-dim` override reads
                  // this custom property for a milder, still-legible alpha;
                  // terminalBackgroundRgba is just a hex+opacity→rgba
                  // converter despite the name, reused here for text colour.
                  "--terminal-dim-color": terminalBackgroundRgba(terminalTextColor, 78),
                  // Blurs whatever sits behind this pane (app wallpaper, other
                  // windows) — not the terminal's own text, which paints in a
                  // layer above this backdrop-filter's effect.
                  ...(backgroundBlur > 0
                    ? {
                        backdropFilter: `blur(${backgroundBlur}px)`,
                        WebkitBackdropFilter: `blur(${backgroundBlur}px)`,
                      }
                    : {}),
                } as React.CSSProperties
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

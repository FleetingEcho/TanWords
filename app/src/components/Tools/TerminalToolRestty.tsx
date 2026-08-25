/** Desktop Terminal page: a local shell over restty, the experimental
 *  WASM/WebGPU-WebGL2 terminal renderer that is the fresh-install default
 *  (`DEFAULT_TERMINAL_ENGINE`); xterm.js (`TerminalTool.tsx`) remains a
 *  selectable, fully-featured fallback. Selected per-tab in
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
 *  "Select all" has no restty API to call, so it isn't offered. Restty handles
 *  ordinary clipboard text itself; TanWords intercepts non-text paste events
 *  so its desktop clipboard bridge can materialize images as temporary files.
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
import { Terminal as ResttyTerminal } from "restty/xterm";
import { Droplets, Maximize2, Minimize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import "@/styles/terminal-tool.css";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettingsStore } from "@/store/settingsStore";
import { useFullscreenDragExit } from "@/hooks/useFullscreenDragExit";
import { callMain } from "@/ipc/host";
import { isDesktopHost } from "@/platform";
import { TerminalEngineSwitch } from "./TerminalEngineSwitch";
import { createSandboxPtyTransport } from "./sandboxPtyTransport";
import { MAX_AUTOMATIC_RECOVERY_ATTEMPTS, quoteTerminalPath, type TerminalClipboard } from "./terminalUtils";
import { createElectronPtyTransport, resttyFontsFor, resttyThemeFor, type PtySessionHooks } from "./resttySupport";
export type { PtySessionHooks } from "./resttySupport";

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
  const terminalRef = useRef<ResttyTerminal | null>(null);
  const onSessionExitRef = useRef(onSessionExit);
  onSessionExitRef.current = onSessionExit;
  const onSessionReadyRef = useRef(onSessionReady);
  onSessionReadyRef.current = onSessionReady;
  const onShellTitleChangeRef = useRef(onShellTitleChange);
  onShellTitleChangeRef.current = onShellTitleChange;
  const recoveryAttemptsRef = useRef(0);
  const [status, setStatus] = useState<"starting" | "connected" | "closed" | "error">("starting");
  const [message, setMessage] = useState("");
  const [sessionGeneration, setSessionGeneration] = useState(0);
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

  const pasteClipboardImage = useCallback(async (event: React.ClipboardEvent<HTMLDivElement>) => {
    // Restty already handles text paste (including bracketed-paste mode). Its
    // DataTransfer reader intentionally ignores non-text payloads, so only take
    // over when no text is present and the native desktop bridge can provide a
    // temporary image file path.
    if (!isDesktopHost || event.clipboardData.getData("text/plain")) return;
    event.preventDefault();
    event.stopPropagation();

    const value = await callMain<TerminalClipboard>("clipboard:readForTerminal").catch(() => null);
    if (value?.kind !== "image") return;
    terminalRef.current?.restty?.sendKeyInput(quoteTerminalPath(value.path), "paste");
    terminalRef.current?.focus();
  }, []);

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
      // TanWords is a single-pane terminal host. Restty's default menu adds
      // its own split/close/PTY controls and consumes right-clicks that the
      // foreground TUI (for example Herdr) needs to receive.
      surface: { defaultContextMenu: false },
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

  return (
    <div
      aria-hidden={!visible}
      className="terminal-tool-outer relative h-full w-full"
    >
      <div className="flex h-full flex-col">
        <div
          data-testid="terminal-tab-toolbar"
          onMouseDown={onToolbarMouseDown}
          onDoubleClick={onToolbarDoubleClick}
          title={maximized
            ? t("toolsPage.terminal.restore")
            : fullScreen
              ? t("windowControls.dragToExitFullscreen")
              : undefined}
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
          onPasteCapture={(event) => { void pasteClipboardImage(event); }}
          onContextMenu={(event) => event.preventDefault()}
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

    </div>
  );
}

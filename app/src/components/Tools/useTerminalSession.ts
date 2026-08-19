/** Terminal session lifecycle for one workspace tab: owns the xterm `Terminal`
 *  instance and the PTY behind it. Extracted from `TerminalTool` so the page
 *  component is just layout + appearance; this hook is the front half of the
 *  local shell (the daemon `tanwords-pty` is the back half — see
 *  electron/main/terminal.ts). Re-runs only when `sessionGeneration` changes,
 *  i.e. on an explicit restart; settings changes are applied by live options
 *  in the owning component, not by recreating the Terminal. */
import { useEffect } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import type { WebglAddon } from "@xterm/addon-webgl";
import { subscribe } from "@/ipc/events";
import { callMain } from "@/ipc/host";
import { useT } from "@/hooks/useT";
import type { TerminalColorScheme } from "@/store/settings/types";
import {
  MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
  TERMINAL_IIP_SIZE_LIMIT_BYTES,
  TERMINAL_IMAGE_PIXEL_LIMIT,
  TERMINAL_IMAGE_STORAGE_MB,
  TERMINAL_OUTPUT_HIGH_WATER_BYTES,
  TERMINAL_OUTPUT_LOW_WATER_BYTES,
  TERMINAL_SIXEL_SIZE_LIMIT_BYTES,
  TERMINAL_SCROLLBACK_LINES,
  terminalThemeFor,
  b64EncodeUtf8,
  shellTabTitle,
  terminalBackgroundRgba,
  terminalFontStack,
  terminalOutputBytes,
  terminalPixelSizeReport,
  type TerminalRenderDimensions,
} from "./terminalUtils";

type TerminalStatus = "starting" | "connected" | "closed" | "error";

export interface UseTerminalSessionParams {
  shellRef: RefObject<HTMLDivElement | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  searchAddonRef: MutableRefObject<SearchAddon | null>;
  refitRef: MutableRefObject<() => void>;
  webglAddonRef: MutableRefObject<WebglAddon | null>;
  webglContextLossSubscriptionRef: MutableRefObject<{ dispose: () => void } | null>;
  onSessionExitRef: MutableRefObject<(() => void) | undefined>;
  onSessionReadyRef: MutableRefObject<((shell: string) => void) | undefined>;
  onShellTitleChangeRef: MutableRefObject<((title: string) => void) | undefined>;
  recoveryAttemptsRef: MutableRefObject<number>;
  setStatus: Dispatch<SetStateAction<TerminalStatus>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setSessionGeneration: Dispatch<SetStateAction<number>>;
  setSearchResult: Dispatch<SetStateAction<{ resultIndex: number; resultCount: number }>>;
  shellPath: string;
  t: ReturnType<typeof useT>;
  terminalFontSize: number;
  terminalColorScheme: TerminalColorScheme;
  terminalTextColor: string;
  terminalBackgroundColor: string;
  effectiveTransparent: boolean;
  terminalFontFamily: string;
  terminalFontWeight: number;
  sessionGeneration: number;
}

export function useTerminalSession(params: UseTerminalSessionParams) {
  const {
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
  } = params;
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const term = new Terminal({
      fontSize: terminalFontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      // Keep wheel/trackpad movement fluid without the long easing tail that
      // makes interactive terminal output feel detached from the user's hand.
      smoothScrollDuration: 80,
      scrollSensitivity: 1,
      fastScrollSensitivity: 5,
      // Prevent wide CJK/ambiguous glyphs from bleeding into the next cell when
      // the selected local font does not provide a perfectly monospace face.
      rescaleOverlappingGlyphs: true,
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
        // mode keeps the canvas clear and uses the shell tint below instead —
        // but minimumContrastRatio below reads this color's RGB channels
        // (ignoring alpha) to decide how to correct dim/default-foreground
        // glyphs. Passing the chosen tint at alpha 0 keeps the canvas exactly
        // as transparent as literal black would, while giving the corrector
        // the real backdrop lightness — literal black would make it brighten
        // text for a black backdrop that a light glass theme never has,
        // washing dark text out against the actual light background.
        background: effectiveTransparent ? terminalBackgroundRgba(terminalBackgroundColor, 0) : terminalBackgroundColor,
      },
      // Scrollback lives in xterm's JS buffer, independently of the WebGL
      // canvas renderer. Keep a generous daily-development history without the
      // excessive aggregate memory exposure across two persistent tabs. The
      // usual Herdr workflow owns its larger pane history outside this buffer.
      scrollback: TERMINAL_SCROLLBACK_LINES,
    });
    terminalRef.current = term;
    const fit = new FitAddon();
    const imageAddon = new ImageAddon({
      enableSizeReports: true,
      pixelLimit: TERMINAL_IMAGE_PIXEL_LIMIT,
      storageLimit: TERMINAL_IMAGE_STORAGE_MB,
      showPlaceholder: true,
      sixelSupport: true,
      sixelScrolling: true,
      sixelSizeLimit: TERMINAL_SIXEL_SIZE_LIMIT_BYTES,
      iipSupport: true,
      iipSizeLimit: TERMINAL_IIP_SIZE_LIMIT_BYTES,
    });
    const searchAddon = new SearchAddon({ highlightLimit: 1000 });
    searchAddonRef.current = searchAddon;
    term.loadAddon(fit);
    term.loadAddon(imageAddon);
    term.loadAddon(searchAddon);
    const searchResultsSubscription = searchAddon.onDidChangeResults((result) => {
      setSearchResult(result);
    });
    term.open(el);
    // Image-aware terminal programs use these logical pixel dimensions to map
    // image pixels to terminal cells. The image layer handles Retina resolution
    // independently so DPR never changes the image's on-screen size.
    const pixelSizeReportSubscription = term.parser.registerCsiHandler(
      { final: "t" },
      (params) => {
        const dimensions = (term as unknown as {
          _core?: { _renderService?: { dimensions?: TerminalRenderDimensions } };
        })._core?._renderService?.dimensions;
        const response = terminalPixelSizeReport(params, dimensions);
        if (!response) return false;
        term.input(response, false);
        return true;
      },
    );
    setStatus("starting");
    setMessage("");

    // xterm's writes are asynchronous. Feed it one chunk at a time and apply
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

    fit.fit();

    const state = { sessionId: null as string | null };

    const logicalCanvasSize = () => {
      const dimensions = (term as unknown as {
        _core?: { _renderService?: { dimensions?: TerminalRenderDimensions } };
      })._core?._renderService?.dimensions;
      return {
        pixelWidth: Math.max(0, Math.round(dimensions?.css.canvas.width ?? 0)),
        pixelHeight: Math.max(0, Math.round(dimensions?.css.canvas.height ?? 0)),
      };
    };

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
    const sendPtyResizeNow = () => {
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
      lastPtyResizeSentAt = Date.now();
      void callMain("pty_resize", {
        id: state.sessionId,
        cols: term.cols,
        rows: term.rows,
        pixelWidth,
        pixelHeight,
      }).catch(() => {});
    };
    // A window drag can call this dozens of times a second. Sending every one
    // straight through resizes the PTY, which delivers SIGWINCH to whatever is
    // running — a full-screen TUI (Herdr, htop, vim) repaints its entire screen
    // on each one and writes that burst back over the PTY. At 60Hz that burst
    // competes with the next frame's own resize work and visibly stutters.
    // Bound how often the PTY actually hears about a resize (xterm's own local
    // fit() below still runs every frame, so the grid still tracks the drag);
    // a trailing call guarantees the final size lands once the drag settles.
    let ptyResizeThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPtyResizeSentAt = 0;
    const PTY_RESIZE_THROTTLE_MS = 100;
    const syncPtySize = () => {
      if (!state.sessionId || ptyResizeThrottleTimer) return;
      const elapsed = Date.now() - lastPtyResizeSentAt;
      if (elapsed >= PTY_RESIZE_THROTTLE_MS) {
        sendPtyResizeNow();
        return;
      }
      ptyResizeThrottleTimer = setTimeout(() => {
        ptyResizeThrottleTimer = null;
        sendPtyResizeNow();
      }, PTY_RESIZE_THROTTLE_MS - elapsed);
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
        fit.fit();
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
      if (ptyResizeThrottleTimer) clearTimeout(ptyResizeThrottleTimer);
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      webglContextLossSubscriptionRef.current?.dispose();
      webglContextLossSubscriptionRef.current = null;
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
      searchResultsSubscription.dispose();
      pixelSizeReportSubscription.dispose();
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
      if (searchAddonRef.current === searchAddon) searchAddonRef.current = null;
    };
  }, [sessionGeneration]);
}

import { FitAddon, Terminal, init } from "ghostty-web";
import type { TerminalSurface, TerminalSurfaceOptions, TerminalSurfaceTheme } from "./terminalSurface";
import { installGhosttyCanvasFixes } from "./ghosttyCanvas";
import { GhosttyQueryInterceptor } from "./ghosttyQueries";

// ghostty-web 0.4 caches the resolved instance but not an in-flight load. Keep
// concurrent new tabs on one initialization promise so the embedded WASM is
// compiled and instantiated once.
let initialization: Promise<void> | null = null;

export async function createGhosttySurface(options: TerminalSurfaceOptions): Promise<TerminalSurface> {
  initialization ??= init().catch((error) => {
    initialization = null;
    throw error;
  });
  await initialization;
  installGhosttyCanvasFixes();

  const term = new Terminal({
    fontSize: options.fontSize,
    fontFamily: options.fontFamily,
    cursorBlink: true,
    cursorStyle: "block",
    smoothScrollDuration: 80,
    allowTransparency: options.transparent,
    theme: options.theme,
    scrollback: 5_000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(options.host);

  let currentTheme = options.theme;
  const dataListeners = new Set<(data: string) => void>();
  const emitData = (data: string) => dataListeners.forEach((listener) => listener(data));
  const terminalDataSubscription = term.onData(emitData);
  const queryInterceptor = new GhosttyQueryInterceptor();
  const drainTerminalResponses = () => {
    // ghostty-web 0.4 reads only one libghostty response in writeInternal().
    // Drain any remaining DSR-style replies before the shell starts waiting.
    for (let count = 0; count < 32; count += 1) {
      const response = term.wasmTerm?.readResponse();
      if (!response) break;
      emitData(response);
    }
  };

  return {
    engine: "ghostty",
    supportsSearch: false,
    get cols() { return term.cols; },
    get rows() { return term.rows; },
    write: (data, callback) => {
      const filtered = queryInterceptor.process(data, currentTheme);
      if (filtered.data.byteLength > 0) term.write(filtered.data, callback);
      else queueMicrotask(callback);
      filtered.responses.forEach(emitData);
      drainTerminalResponses();
    },
    paste: (data) => term.paste(data),
    input: (data, wasUserInput) => term.input(data, wasUserInput),
    focus: () => term.focus(),
    hasSelection: () => term.hasSelection(),
    getSelection: () => term.getSelection(),
    selectAll: () => term.selectAll(),
    onData: (listener) => {
      dataListeners.add(listener);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onResize: (listener) => term.onResize(listener),
    onTitleChange: (listener) => term.onTitleChange(listener),
    // xterm's handler returns false to consume an event; ghostty-web 0.4 uses
    // the inverse convention. Normalize it at the surface boundary so ordinary
    // keystrokes keep reaching the shell and modified Enter is sent only once.
    attachCustomKeyEventHandler: (handler) => {
      term.attachCustomKeyEventHandler((event) => !handler(event));
    },
    fit: () => fit.fit(),
    // Ghostty's public Canvas API does not expose the internal cell viewport.
    // CSS pixels are the correct PTY unit and are sufficient for this initial
    // text-only path; image/pixel-report compatibility is intentionally absent.
    logicalCanvasSize: () => ({
      pixelWidth: Math.max(0, Math.round(options.host.clientWidth)),
      pixelHeight: Math.max(0, Math.round(options.host.clientHeight)),
    }),
    applyRenderer: () => {},
    applyTheme: (theme: TerminalSurfaceTheme) => {
      currentTheme = theme;
      term.options.theme = theme;
    },
    applyTypography: (fontFamily, fontSize) => {
      term.options.fontFamily = fontFamily;
      term.options.fontSize = fontSize;
    },
    clearSearchDecorations: () => {},
    findNext: () => {},
    findPrevious: () => {},
    dispose: () => {
      terminalDataSubscription.dispose();
      dataListeners.clear();
      fit.dispose?.();
      term.dispose();
    },
  };
}

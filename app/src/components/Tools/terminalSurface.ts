import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import type { TerminalEngine, TerminalRenderer } from "@/store/settings/types";
import {
  TERMINAL_IIP_SIZE_LIMIT_BYTES,
  TERMINAL_IMAGE_PIXEL_LIMIT,
  TERMINAL_IMAGE_STORAGE_MB,
  TERMINAL_SCROLLBACK_LINES,
  TERMINAL_SIXEL_SIZE_LIMIT_BYTES,
  terminalPixelSizeReport,
  terminalSearchOptions,
  type TerminalRenderDimensions,
} from "./terminalUtils";

export type TerminalSurfaceTheme = Record<string, string | undefined>;

export interface TerminalSurfaceOptions {
  host: HTMLElement;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  theme: TerminalSurfaceTheme;
  transparent: boolean;
  renderer: TerminalRenderer;
  onSearchResults: (result: { resultIndex: number; resultCount: number }) => void;
}

interface Disposable {
  dispose(): void;
}

/** The renderer-neutral contract owned by TerminalTool's PTY lifecycle.
 * xterm-only features remain optional so a second parser/renderer never has to
 * impersonate SearchAddon, ImageAddon, or WebGL. */
export interface TerminalSurface {
  readonly engine: TerminalEngine;
  readonly supportsSearch: boolean;
  readonly cols: number;
  readonly rows: number;
  write(data: Uint8Array, callback: () => void): void;
  paste(data: string): void;
  input(data: string, wasUserInput?: boolean): void;
  focus(): void;
  hasSelection(): boolean;
  getSelection(): string;
  selectAll(): void;
  onData(listener: (data: string) => void): Disposable;
  onResize(listener: () => void): Disposable;
  onTitleChange(listener: (title: string) => void): Disposable;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  fit(): void;
  logicalCanvasSize(): { pixelWidth: number; pixelHeight: number };
  applyRenderer(renderer: TerminalRenderer, transparent: boolean): void;
  applyTheme(theme: TerminalSurfaceTheme): void;
  applyTypography(fontFamily: string, fontSize: number, fontWeight: number): void;
  clearSearchDecorations(): void;
  findNext(query: string, caseSensitive: boolean, incremental?: boolean): void;
  findPrevious(query: string, caseSensitive: boolean): void;
  dispose(): void;
}

export function createXtermSurface(options: TerminalSurfaceOptions): TerminalSurface {
  const term = new Terminal({
    fontSize: options.fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    cursorStyle: "block",
    cursorInactiveStyle: "outline",
    smoothScrollDuration: 80,
    scrollSensitivity: 1,
    fastScrollSensitivity: 5,
    rescaleOverlappingGlyphs: true,
    allowProposedApi: true,
    allowTransparency: true,
    minimumContrastRatio: 4.5,
    fontFamily: options.fontFamily,
    fontWeight: options.fontWeight,
    fontWeightBold: Math.max(700, options.fontWeight),
    theme: options.theme,
    scrollback: TERMINAL_SCROLLBACK_LINES,
  });
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
  term.loadAddon(fit);
  term.loadAddon(imageAddon);
  term.loadAddon(searchAddon);
  const searchResultsSubscription = searchAddon.onDidChangeResults(options.onSearchResults);
  term.open(options.host);

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

  let webglAddon: WebglAddon | null = null;
  let webglContextLossSubscription: Disposable | null = null;
  const disposeWebgl = () => {
    webglContextLossSubscription?.dispose();
    webglContextLossSubscription = null;
    webglAddon?.dispose();
    webglAddon = null;
  };
  const applyRenderer = (renderer: TerminalRenderer, transparent: boolean) => {
    disposeWebgl();
    const useWebgl = renderer === "webgl" || (renderer === "auto" && !transparent);
    if (!useWebgl) return;
    try {
      webglAddon = new WebglAddon();
      webglContextLossSubscription = webglAddon.onContextLoss(disposeWebgl);
      term.loadAddon(webglAddon);
    } catch {
      disposeWebgl();
    }
  };
  return {
    engine: "xterm",
    supportsSearch: true,
    get cols() { return term.cols; },
    get rows() { return term.rows; },
    write: (data, callback) => term.write(data, callback),
    paste: (data) => term.paste(data),
    input: (data, wasUserInput) => term.input(data, wasUserInput),
    focus: () => term.focus(),
    hasSelection: () => term.hasSelection(),
    getSelection: () => term.getSelection(),
    selectAll: () => term.selectAll(),
    onData: (listener) => term.onData(listener),
    onResize: (listener) => term.onResize(listener),
    onTitleChange: (listener) => term.onTitleChange(listener),
    attachCustomKeyEventHandler: (handler) => term.attachCustomKeyEventHandler(handler),
    fit: () => fit.fit(),
    logicalCanvasSize: () => {
      const dimensions = (term as unknown as {
        _core?: { _renderService?: { dimensions?: TerminalRenderDimensions } };
      })._core?._renderService?.dimensions;
      return {
        pixelWidth: Math.max(0, Math.round(dimensions?.css.canvas.width ?? 0)),
        pixelHeight: Math.max(0, Math.round(dimensions?.css.canvas.height ?? 0)),
      };
    },
    applyRenderer,
    applyTheme: (theme) => { term.options.theme = theme; },
    applyTypography: (fontFamily, fontSize, fontWeight) => {
      term.options.fontFamily = fontFamily;
      term.options.fontSize = fontSize;
      term.options.fontWeight = fontWeight;
      term.options.fontWeightBold = Math.max(700, fontWeight);
    },
    clearSearchDecorations: () => searchAddon.clearDecorations(),
    findNext: (query, caseSensitive, incremental = false) => {
      term.options.allowProposedApi = true;
      searchAddon.findNext(query, terminalSearchOptions(caseSensitive, incremental));
    },
    findPrevious: (query, caseSensitive) => {
      term.options.allowProposedApi = true;
      searchAddon.findPrevious(query, terminalSearchOptions(caseSensitive));
    },
    dispose: () => {
      disposeWebgl();
      searchResultsSubscription.dispose();
      pixelSizeReportSubscription.dispose();
      (fit as FitAddon & { dispose?: () => void }).dispose?.();
      term.dispose();
    },
  };
}

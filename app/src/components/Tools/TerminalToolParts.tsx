/** Toolbar, appearance panel, and search bar for `TerminalTool`, extracted so
 *  the page component is layout + effects only. Each subcomponent reads its
 *  own settings-store slices and calls `useT()` itself; the parent passes only
 *  tab/engine state and the handlers it owns. */
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, MouseEventHandler, ReactNode, RefObject, SetStateAction } from "react";
import {
  ChevronDown,
  ChevronUp,
  Droplets,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TerminalEngineSwitch } from "./TerminalEngineSwitch";
import type { TerminalEngine } from "@/store/settings/types";

type TerminalStatus = "starting" | "connected" | "closed" | "error";

export function TerminalToolbar({
  tabBar,
  status,
  searchOpen,
  appearanceControlsOpen,
  effectiveTransparent,
  maximized,
  fullScreen,
  onToolbarMouseDown,
  closeSearch,
  setSearchOpen,
  toggleAppearanceControls,
  toggleFullscreen,
}: {
  tabBar?: ReactNode;
  status: TerminalStatus;
  searchOpen: boolean;
  appearanceControlsOpen: boolean;
  effectiveTransparent: boolean;
  maximized: boolean;
  fullScreen: boolean;
  onToolbarMouseDown?: MouseEventHandler<HTMLElement>;
  closeSearch: () => void;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  toggleAppearanceControls: () => void;
  toggleFullscreen: () => void;
}) {
  const t = useT();
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  return (
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
  );
}

export function TerminalAppearanceControls({
  engine,
  onEngineChange,
}: {
  engine?: TerminalEngine;
  onEngineChange?: (engine: TerminalEngine) => void;
}) {
  const t = useT();
  const terminalColorScheme = useSettingsStore((s) => s.terminalColorScheme);
  const setTerminalColorScheme = useSettingsStore((s) => s.setTerminalColorScheme);
  const terminalTextColor = useSettingsStore((s) => s.terminalTextColor);
  const setTerminalTextColor = useSettingsStore((s) => s.setTerminalTextColor);
  const terminalBackgroundColor = useSettingsStore((s) => s.terminalBackgroundColor);
  const setTerminalBackgroundColor = useSettingsStore((s) => s.setTerminalBackgroundColor);
  const backgroundOpacity = useSettingsStore((s) => s.terminalBackgroundOpacity);
  const setBackgroundOpacity = useSettingsStore((s) => s.setTerminalBackgroundOpacity);
  const backgroundBlur = useSettingsStore((s) => s.terminalBackgroundBlur);
  const setBackgroundBlur = useSettingsStore((s) => s.setTerminalBackgroundBlur);
  const terminalFontWeight = useSettingsStore((s) => s.terminalFontWeight);
  const setTerminalFontWeight = useSettingsStore((s) => s.setTerminalFontWeight);
  const [bgColorDraft, setBgColorDraft] = useState(terminalBackgroundColor);
  useEffect(() => {
    setBgColorDraft(terminalBackgroundColor);
  }, [terminalBackgroundColor]);
  const commitBgColor = useCallback(
    () => setTerminalBackgroundColor(bgColorDraft),
    [bgColorDraft, setTerminalBackgroundColor],
  );
  const [textColorDraft, setTextColorDraft] = useState(terminalTextColor);
  useEffect(() => {
    setTextColorDraft(terminalTextColor);
  }, [terminalTextColor]);
  const commitTextColor = useCallback(
    () => setTerminalTextColor(textColorDraft),
    [textColorDraft, setTerminalTextColor],
  );
  return (
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
            <label className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {t("toolsPage.terminal.blurLabel")}
                </span>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={backgroundBlur}
                  onChange={(e) => setBackgroundBlur(Number(e.currentTarget.value))}
                  aria-label={t("toolsPage.terminal.blurLabel")}
                  className="h-6 w-20 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted-foreground/30 [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-track]:h-[3px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted-foreground/30 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-primary"
                />
                <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                  {backgroundBlur}px
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
  );
}

export function TerminalSearchBar({
  searchInputRef,
  searchQuery,
  setSearchQuery,
  searchCaseSensitive,
  setSearchCaseSensitive,
  searchResult,
  closeSearch,
  findNext,
  findPrevious,
}: {
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  searchCaseSensitive: boolean;
  setSearchCaseSensitive: Dispatch<SetStateAction<boolean>>;
  searchResult: { resultIndex: number; resultCount: number };
  closeSearch: () => void;
  findNext: () => void;
  findPrevious: () => void;
}) {
  const t = useT();
  return (
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
  );
}

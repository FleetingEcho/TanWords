import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, ExternalLink } from "lucide-react";
import { useT } from "@/hooks/useT";
import { invoke } from "@/ipc/backend";
import { openExternal } from "@/ipc/shell";
import { useSettingsStore } from "@/store/settingsStore";
import { DEFAULT_TERMINAL_FONT_FAMILY, type TerminalColorScheme, type TerminalEngine } from "@/store/settings/types";
import { HERDR_URL } from "@/components/Tools/terminalUtils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingRow } from "./SettingsShared";

interface LocalFontData {
  family: string;
}

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

function RangeValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 font-semibold tabular-nums text-foreground">
      {children}
    </span>
  );
}

export function TerminalSection() {
  const t = useT();
  const engine = useSettingsStore((state) => state.terminalEngine);
  const setEngine = useSettingsStore((state) => state.setTerminalEngine);
  const transparent = useSettingsStore((state) => state.terminalTransparent);
  const blur = useSettingsStore((state) => state.terminalBackgroundBlur);
  const opacity = useSettingsStore((state) => state.terminalBackgroundOpacity);
  const backgroundColor = useSettingsStore((state) => state.terminalBackgroundColor);
  const textColor = useSettingsStore((state) => state.terminalTextColor);
  const colorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const renderer = useSettingsStore((state) => state.terminalRenderer);
  const fontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const fontSize = useSettingsStore((state) => state.terminalFontSize);
  const fontWeight = useSettingsStore((state) => state.terminalFontWeight);
  const shellPath = useSettingsStore((state) => state.terminalShellPath);
  const setTransparent = useSettingsStore((state) => state.setTerminalTransparent);
  const setBlur = useSettingsStore((state) => state.setTerminalBackgroundBlur);
  const setOpacity = useSettingsStore((state) => state.setTerminalBackgroundOpacity);
  const setBackgroundColor = useSettingsStore((state) => state.setTerminalBackgroundColor);
  const setTextColor = useSettingsStore((state) => state.setTerminalTextColor);
  const setColorScheme = useSettingsStore((state) => state.setTerminalColorScheme);
  const setRenderer = useSettingsStore((state) => state.setTerminalRenderer);
  // Draft for the hex text field: typed shorthand like `#ddd` is committed on
  // blur/Enter and re-synced when the store value changes elsewhere.
  const [bgColorDraft, setBgColorDraft] = useState(backgroundColor);
  useEffect(() => { setBgColorDraft(backgroundColor); }, [backgroundColor]);
  const [textColorDraft, setTextColorDraft] = useState(textColor);
  useEffect(() => { setTextColorDraft(textColor); }, [textColor]);
  const setFontFamily = useSettingsStore((state) => state.setTerminalFontFamily);
  const setFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const setFontWeight = useSettingsStore((state) => state.setTerminalFontWeight);
  const setShellPath = useSettingsStore((state) => state.setTerminalShellPath);
  const [shellDraft, setShellDraft] = useState(shellPath);
  const [defaultShellPath, setDefaultShellPath] = useState("");
  const [localFonts, setLocalFonts] = useState<string[]>([]);
  const [fontAccess, setFontAccess] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [fontOpen, setFontOpen] = useState(false);
  const [fontSearch, setFontSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("pty_default_shell").then((path) => {
      if (cancelled || !path) return;
      setDefaultShellPath(path);
      if (!shellPath) setShellDraft((current) => current || path);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    setShellDraft(shellPath || defaultShellPath);
  }, [shellPath, defaultShellPath]);

  const commitShellPath = () => {
    const path = shellDraft.trim();
    setShellDraft(path || defaultShellPath);
    setShellPath(path === defaultShellPath ? "" : path);
  };

  const loadLocalFonts = async () => {
    const queryLocalFonts = (window as LocalFontWindow).queryLocalFonts;
    if (!queryLocalFonts) {
      setFontAccess("unavailable");
      return;
    }
    setFontAccess("loading");
    try {
      // Must run from this button gesture: Chromium protects installed font
      // enumeration behind the local-fonts permission.
      const fonts = await queryLocalFonts.call(window);
      const families = [...new Set(fonts.map((font) => font.family.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      setLocalFonts(families);
      setFontAccess("ready");
    } catch {
      setFontAccess("unavailable");
    }
  };

  const fontOptions = [
    { value: DEFAULT_TERMINAL_FONT_FAMILY, label: t("settings.terminalSystemMonospace") },
    { value: "Inter", label: t("settings.terminalAppFont") },
    ...(fontFamily !== DEFAULT_TERMINAL_FONT_FAMILY
      && fontFamily !== "Inter"
      && !localFonts.includes(fontFamily)
      ? [{ value: fontFamily, label: fontFamily }]
      : []),
    ...localFonts
      .filter((family) => family !== DEFAULT_TERMINAL_FONT_FAMILY && family !== "Inter")
      .map((family) => ({ value: family, label: family })),
  ];
  const query = fontSearch.trim().toLocaleLowerCase();
  const filteredFontOptions = query
    ? fontOptions.filter((option) => option.label.toLocaleLowerCase().includes(query))
    : fontOptions;
  const selectedFontLabel = fontOptions.find((option) => option.value === fontFamily)?.label ?? fontFamily;

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card px-5">
      <SettingRow
        label={t("settings.terminalEngine")}
        sub={t("settings.terminalEngineSub")}
      >
        <div role="tablist" aria-label={t("settings.terminalEngine")} className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          {(["xterm", "restty"] as TerminalEngine[]).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={engine === option}
              onClick={() => setEngine(option)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                engine === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option === "xterm" ? t("settings.terminalEngineXterm") : t("settings.terminalEngineRestty")}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings.terminalShellPath")}
        sub={t("settings.terminalShellPathSub")}
      >
        <div className="w-80 max-w-full space-y-1.5">
          <div className="flex gap-2">
            <input
              type="text"
              value={shellDraft}
              placeholder={t("settings.terminalShellPathAuto")}
              onChange={(event) => setShellDraft(event.target.value)}
              onBlur={commitShellPath}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitShellPath();
                  event.currentTarget.blur();
                }
              }}
              aria-label={t("settings.terminalShellPath")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => {
                setShellDraft(defaultShellPath);
                setShellPath("");
              }}
              className="h-9 shrink-0 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted"
            >
              {t("settings.terminalShellPathReset")}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("settings.terminalShellPathNewTabs")}
          </p>
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings.terminalScrollback")}
        sub={t("settings.terminalScrollbackSub")}
      >
        <div className="max-w-sm space-y-2 text-xs text-muted-foreground">
          <p>{t("settings.terminalScrollbackHerdrRecommendation")}</p>
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
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("settings.terminalOpenHerdr")}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </SettingRow>

      <SettingRow
        label={t("toolsPage.terminal.themeLabel")}
        sub={t("settings.terminalThemeSub")}
      >
        <Select
          value={colorScheme}
          onValueChange={(value) => setColorScheme(value as TerminalColorScheme)}
        >
          <SelectTrigger aria-label={t("toolsPage.terminal.themeLabel")} className="h-9 w-56">
            <SelectValue>
              {colorScheme === "custom" ? t("toolsPage.terminal.themeCustom") : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tokyo-night">{t("toolsPage.terminal.themeTokyoNight")}</SelectItem>
            <SelectItem value="dracula">{t("toolsPage.terminal.themeDracula")}</SelectItem>
            <SelectItem value="light">{t("toolsPage.terminal.themeLight")}</SelectItem>
            <SelectItem value="high-contrast">{t("toolsPage.terminal.themeHighContrast")}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label={t("toolsPage.terminal.textColorLabel")}
        sub={t("settings.terminalTextColorSub")}
      >
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={textColor}
            onChange={(e) => setTextColor(e.target.value)}
            title={t("toolsPage.terminal.textColorLabel")}
            aria-label={t("toolsPage.terminal.textColorLabel")}
            className="h-9 w-16 cursor-pointer rounded-md border border-input bg-transparent p-1"
          />
          <input
            type="text"
            value={textColorDraft}
            onChange={(e) => setTextColorDraft(e.target.value)}
            onBlur={() => setTextColor(textColorDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            placeholder="#c0caf5"
            title={t("toolsPage.terminal.textColorLabel")}
            aria-label={t("toolsPage.terminal.textColorLabel")}
            className="h-9 w-24 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums text-foreground outline-none focus:border-primary"
          />
          <span className="text-xs tabular-nums text-muted-foreground">{textColor}</span>
        </div>
      </SettingRow>

      {engine === "xterm" && (
        <SettingRow
          label={t("toolsPage.terminal.transparent")}
          sub={t("settings.terminalTransparentSub")}
        >
          <button
            type="button"
            role="switch"
            aria-checked={transparent}
            aria-label={t("toolsPage.terminal.transparent")}
            onClick={() => setTransparent(!transparent)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              transparent ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                transparent ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </SettingRow>
      )}

      {engine === "xterm" && (
        <SettingRow
          label={t("settings.terminalRenderer")}
          sub={t("settings.terminalRendererSub")}
        >
          <Select
            value={renderer}
            onValueChange={(value) => setRenderer(value as "auto" | "webgl" | "dom")}
          >
            <SelectTrigger aria-label={t("settings.terminalRenderer")} className="h-9 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("settings.terminalRendererAuto")}</SelectItem>
              <SelectItem value="webgl">{t("settings.terminalRendererWebgl")}</SelectItem>
              <SelectItem value="dom">{t("settings.terminalRendererDom")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      )}

      {engine === "xterm" && (
        <SettingRow
          label={t("toolsPage.terminal.blurLabel")}
          sub={t("settings.terminalBackgroundBlurSub")}
        >
          <div className="w-52 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>0px</span>
              <RangeValue>{blur}px</RangeValue>
              <span>30px</span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={blur}
              onChange={(event) => setBlur(Number(event.target.value))}
              className="w-full accent-primary"
              aria-label={t("toolsPage.terminal.blurLabel")}
            />
          </div>
        </SettingRow>
      )}

      {engine === "xterm" && (
        <SettingRow
          label={t("toolsPage.terminal.opacityLabel")}
          sub={t("settings.terminalBackgroundOpacitySub")}
        >
          <div className="w-52 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <RangeValue>{opacity}%</RangeValue>
              <span>100%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              className="w-full accent-primary"
              aria-label={t("toolsPage.terminal.opacityLabel")}
            />
          </div>
        </SettingRow>
      )}

      <SettingRow
        label={t("toolsPage.terminal.backgroundColorLabel")}
        sub={t("settings.terminalBackgroundColorSub")}
      >
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
            title={t("toolsPage.terminal.backgroundColorLabel")}
            aria-label={t("toolsPage.terminal.backgroundColorLabel")}
            className="h-9 w-16 cursor-pointer rounded-md border border-input bg-transparent p-1"
          />
          <input
            type="text"
            value={bgColorDraft}
            onChange={(e) => setBgColorDraft(e.target.value)}
            onBlur={() => setBackgroundColor(bgColorDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            placeholder="#1a1b26"
            title={t("toolsPage.terminal.backgroundColorLabel")}
            aria-label={t("toolsPage.terminal.backgroundColorLabel")}
            className="h-9 w-24 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums text-foreground outline-none focus:border-primary"
          />
          <span className="text-xs tabular-nums text-muted-foreground">{backgroundColor}</span>
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings.terminalFontFamily")}
        sub={t("settings.terminalFontFamilySub")}
      >
        <div className="w-64 space-y-1.5">
          <Popover
            open={fontOpen}
            onOpenChange={(open) => {
              setFontOpen(open);
              if (open && fontAccess === "idle") void loadLocalFonts();
              if (!open) setFontSearch("");
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                role="combobox"
                aria-label={t("settings.terminalFontFamily")}
                aria-expanded={fontOpen}
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                style={{ fontFamily: fontFamily === DEFAULT_TERMINAL_FONT_FAMILY ? "ui-monospace" : fontFamily }}
              >
                <span className="truncate">{selectedFontLabel}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              <input
                type="search"
                value={fontSearch}
                onChange={(event) => setFontSearch(event.target.value)}
                aria-label={t("settings.terminalFontSearch")}
                placeholder={t("settings.terminalFontSearch")}
                className="mb-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div role="listbox" className="max-h-64 overflow-y-auto">
                {filteredFontOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={fontFamily === option.value}
                    onClick={() => {
                      setFontFamily(option.value);
                      setFontOpen(false);
                      setFontSearch("");
                    }}
                    className="flex w-full items-center rounded-sm py-1.5 pl-2 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent"
                    style={{ fontFamily: option.value === DEFAULT_TERMINAL_FONT_FAMILY ? "ui-monospace" : option.value }}
                  >
                    <Check className={`mr-2 h-4 w-4 shrink-0 ${fontFamily === option.value ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{option.label}</span>
                  </button>
                ))}
                {filteredFontOptions.length === 0 && (
                  <p className="px-2 py-5 text-center text-xs text-muted-foreground">
                    {t("settings.terminalFontNoResults")}
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
          {fontAccess === "loading" && (
            <p className="text-[11px] text-muted-foreground">{t("settings.terminalFontsLoading")}</p>
          )}
          {fontAccess === "ready" && (
            <p className="text-[11px] text-muted-foreground">
              {t("settings.terminalFontsLoaded", { count: localFonts.length })}
            </p>
          )}
          {fontAccess === "unavailable" && (
            <p className="text-[11px] text-muted-foreground">{t("settings.terminalFontsUnavailable")}</p>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings.terminalFontSize")}
        sub={t("settings.terminalFontSizeSub")}
      >
        <div className="w-52 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>8px</span>
            <RangeValue>{fontSize}px</RangeValue>
            <span>32px</span>
          </div>
          <input
            type="range"
            min={8}
            max={32}
            step={1}
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
            className="w-full accent-primary"
            aria-label={t("settings.terminalFontSize")}
          />
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings.terminalFontWeight")}
        sub={t("settings.terminalFontWeightSub")}
      >
        <div className="w-52 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>100</span>
            <RangeValue>{fontWeight}</RangeValue>
            <span>900</span>
          </div>
          <input
            type="range"
            min={100}
            max={900}
            step={100}
            value={fontWeight}
            onChange={(event) => setFontWeight(Number(event.target.value))}
            className="w-full accent-primary"
            aria-label={t("settings.terminalFontWeight")}
          />
        </div>
      </SettingRow>
    </div>
  );
}

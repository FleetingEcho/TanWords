import React from "react";
import { invoke } from "@/ipc/backend";
import { openExternal as openUrl } from "@/ipc/shell";
import {
  BrainCircuit, Check, ChevronsLeft, ChevronsRight, ClipboardPaste, Cloud, CloudOff, Database, Lock,
  FilePlus2, Languages, MessageSquarePlus, Monitor, Moon, Palette, Quote, Search, Server, Settings, Sun,
  Grid2x2Plus, Rss, Type, Unplug, User, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WordSearchBox } from "@/components/shared/WordSearchBox";
import { TtsControl } from "@/components/ui/TtsControl";
import { SentenceSearchBox } from "@/components/shared/SentenceSearchBox";
import { WindowControls } from "@/components/Layout/WindowControls";
import { useAppLockStore } from "@/store/appLockStore";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import type { DbConnection } from "@/hooks/useDB.types";
import { useProviderStatus } from "@/hooks/useProviderStatus";
import { NavPage, useNavStore } from "@/store/navStore";
import { UpdateButton } from "@/components/Layout/UpdateButton";
import { useSettingsStore } from "@/store/settingsStore";
import { useAnalysisStore } from "@/store/analysisStore";
import { useVocabEnrichStore } from "@/store/vocabEnrichStore";
import { GitHubIcon } from "@/components/ui/icons";
import { useToolsBallStore } from "@/store/toolsBallStore";
import { hostCapabilities, isDesktopHost } from "@/platform";

type McpState = { status: { running: boolean; error: string | null } };

const PAGE_IDS: NavPage[] = (["feeds", "vocabulary", "documents", "chat", "dashboard", "music", "settings", "tools"] as NavPage[])
  .filter((id) => id !== "music" || hostCapabilities.music);

/** The icon standing in for the active theme. One definition: the top bar
 *  renders a wide and a narrow copy of this menu, and keeping two `theme ===`
 *  ladders in sync failed exactly the way you would expect — the narrow one
 *  had no branch for the custom palettes, so Catppuccin showed the
 *  follow-the-system monitor. */
function ThemeIcon({ theme }: { theme: string }) {
  if (theme === "light" || theme === "catppuccin-latte" || theme === "tokyo-night-day") {
    return <Sun className="h-4 w-4" />;
  }
  if (theme === "dark") return <Moon className="h-4 w-4" />;
  if (theme === "system") return <Monitor className="h-4 w-4" />;
  return <Palette className="h-4 w-4" />;
}

export function CommandBar({ activePage }: { activePage: NavPage }) {
  const t = useT();
  const navigate = useNavStore((state) => state.navigate);
  const defaultProvider = useSettingsStore((state) => state.defaultAiProvider);
  const setDefaultProvider = useSettingsStore((state) => state.setDefaultAiProvider);
  const language = useSettingsStore((state) => state.uiLanguage);
  const setLanguage = useSettingsStore((state) => state.setUiLanguage);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const visibleItems = useSettingsStore((state) => state.visibleTopBarItems);
  const toggleToolsModal = useToolsBallStore((state) => state.toggleModal);
  const userAvatar = useSettingsStore((state) => state.userAvatar);
  const visible = (item: import("@/store/settingsStore").TopBarItemId) => {
    if (!visibleItems.includes(item)) return false;
    if (item === "mcp") return hostCapabilities.mcp;
    if (item === "updates") return hostCapabilities.updater;
    return true;
  };
  const analysisJobs = useAnalysisStore((state) => state.jobs);
  const cancelAnalyzing = useAnalysisStore((state) => state.cancel);
  const vocabBulk = useVocabEnrichStore((state) => state.bulk);
  const vocabSingleJobs = useVocabEnrichStore((state) => state.singleJobs);
  // Everything that can be running in the background, from any page, normalized into one
  // list — Reading's Learn/analyze (useAnalysisStore) and Vocabulary's single/bulk
  // re-analyze (useVocabEnrichStore) are tracked in separate stores since they're
  // unrelated features, but they share this one always-visible indicator + cancel UI.
  const runningJobs = React.useMemo(() => {
    const jobs = analysisJobs.map((j) => ({ id: j.id, title: j.title, cancel: () => cancelAnalyzing(j.id) }));
    if (vocabBulk.running) {
      jobs.push({
        id: "vocab-bulk",
        title: t("vocab.bulkEnrichProgress", { done: vocabBulk.done, total: vocabBulk.total }),
        cancel: () => vocabBulk.controller?.abort(),
      });
    }
    for (const [word, job] of Object.entries(vocabSingleJobs)) {
      if (job.status !== "running") continue;
      jobs.push({ id: `vocab-word-${word}`, title: t("vocab.reanalyzeWordTitle", { word }), cancel: () => job.controller.abort() });
    }
    return jobs;
  }, [analysisJobs, cancelAnalyzing, vocabBulk, vocabSingleJobs, t]);
  const isAnalyzing = runningJobs.length > 0;
  const [analyzingOpen, setAnalyzingOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [searchMode, setSearchMode] = React.useState<"word" | "sentence">(
    () => (localStorage.getItem("commandbar-search-mode") === "sentence" ? "sentence" : "word")
  );
  const toggleSearchMode = () => setSearchMode((mode) => {
    const next = mode === "word" ? "sentence" : "word";
    localStorage.setItem("commandbar-search-mode", next);
    return next;
  });
  const [iconsCollapsed, setIconsCollapsed] = React.useState(
    () => localStorage.getItem("commandbar-icons-collapsed") === "1"
  );
  const toggleIconsCollapsed = () => setIconsCollapsed((collapsed) => {
    const next = !collapsed;
    localStorage.setItem("commandbar-icons-collapsed", next ? "1" : "0");
    return next;
  });
  const [mcp, setMcp] = React.useState<{ running: boolean; error: string | null }>({ running: false, error: null });
  const { ready: providersReady, connected: providerConnected, available: availableProviders } = useProviderStatus();
  const db = useDB();
  const [connection, setConnection] = React.useState<DbConnection | null>(null);
  const lockEnabled = useAppLockStore((s) => s.enabled);

  // Fetched once: every path that changes the active profile (connect,
  // disconnect, switch) reloads the whole app, so there's nothing to poll.
  React.useEffect(() => {
    db.getConnection().then(setConnection);
  }, []);

  const refreshMcp = React.useCallback(() => {
    invoke<McpState>("mcp_get_config").then((result) => setMcp(result.status)).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!hostCapabilities.mcp) return;
    refreshMcp();
    const timer = window.setInterval(refreshMcp, 5000);
    window.addEventListener("tanwords:mcp-status-changed", refreshMcp);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("tanwords:mcp-status-changed", refreshMcp);
    };
  }, [refreshMcp]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dispatch = (name: string) => window.dispatchEvent(new CustomEvent(name));
  const newDocument = () => { navigate("documents"); window.setTimeout(() => dispatch("tanwords:new-document"), 0); };
  const newChat = () => { navigate("chat"); window.setTimeout(() => dispatch("tanwords:new-chat"), 0); };
  const openGitHub = async () => {
    const url = "https://github.com/FleetingEcho/TanWords";
    try { await openUrl(url); } catch { window.open(url, "_blank", "noopener,noreferrer"); }
  };
  const openScratch = () => navigate("reading");

  const commands = [
    ...PAGE_IDS.map((page) => ({ label: t(`nav.${page}`), icon: Search, run: () => navigate(page) })),
    { label: t("command.newDocument"), icon: FilePlus2, run: newDocument },
    { label: t("command.newChat"), icon: MessageSquarePlus, run: newChat },
    { label: t("scratch.open"), icon: ClipboardPaste, run: openScratch },
  ].filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));

  // Three states, not two: until the keychain read finishes there is no
  // registry to judge, and flashing the amber "not configured" warning at a
  // user who *has* configured a key is worse than saying nothing.
  const aiTitle = !providersReady
    ? t("command.aiLoading")
    : providerConnected ? t("command.switchModel") : t("command.aiDisconnected");
  const aiTone = !providersReady
    ? "text-muted-foreground"
    : providerConnected ? "text-foreground" : "text-amber-500";

  const context = activePage === "documents"
    ? { label: t("command.newDocument"), icon: FilePlus2, run: newDocument }
    : null;

  return (
    <>
      {/* `z-30` is load-bearing, not decoration. `backdrop-blur-sm` makes this
          header a stacking context, so the inline search dropdown's own `z-50`
          only orders it *within* the header — it cannot lift it above anything
          outside. Without a z-index here the header and the page below it are
          both `auto`, so the page paints later and its toolbars (the Browser
          address bar, FeedTabs at z-20, sticky list headers at z-10) come out
          on top of the dropdown. This has to stay above all of those. */}
      <header className="app-drag-region relative z-30 flex min-h-12 shrink-0 select-none flex-col lg:flex-row lg:items-center gap-x-1.5 gap-y-2 border-b border-border/80 bg-background/90 px-3 py-2 backdrop-blur-xl">
        {visible("search") && (
          <div className="flex min-w-0 order-2 w-full lg:order-none lg:w-auto lg:max-w-2xl lg:flex-1 lg:shrink items-center gap-1">
            <div className="min-w-0 flex-1">
              {searchMode === "word" ? <WordSearchBox variant="inline" /> : <SentenceSearchBox variant="inline" />}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSearchMode}
              title={searchMode === "word" ? t("command.switchToSentenceSearch") : t("command.switchToWordSearch")}
              className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground"
            >
              {searchMode === "word" ? <Quote className="h-4 w-4" /> : <Type className="h-4 w-4" />}
            </Button>
          </div>
        )}

        {/* `lg:flex-1`, not `flex-none`: the trailing `flex-1` spacer inside can
          only push the window controls to the right edge if this row actually
          spans the header. With `flex-none` it was only as wide as its content,
          so hiding the search box (which used to be the thing stretching the
          header) left the controls floating mid-bar. */}
        {/* Below `lg` the header stacks, so this wrapper keeps the icon row and
          * the window controls on one line instead of giving the controls a
          * row of their own. `lg:contents` dissolves it above that. */}
        <div className="flex w-full min-w-0 items-center gap-1.5 lg:contents">
        <div className="rss-tabs-scroll flex min-w-0 w-full items-center gap-1.5 overflow-x-auto lg:w-auto lg:flex-1">
        {visible("context") && context && <><div className="mx-1 hidden h-5 w-px bg-border sm:block" /><Button variant="ghost" onClick={context.run} className="h-8 gap-2 rounded-lg px-2.5 text-xs font-medium text-foreground"><context.icon className="h-4 w-4 text-primary" /><span className="hidden lg:inline">{context.label}</span></Button></>}

        {/* Any speech in the app — the reader's article playback and the
          * selection toolbar's speak button both drive ttsPlayerStore — shows
          * up here and can be paused, skipped or cancelled from here. Renders
          * nothing while idle. Unrelated to the podcast/music player, which
          * keeps its own bar. */}
        {hostCapabilities.nativeTts && <TtsControl />}

        {/* Learn/analyze keeps running in the background if you navigate away from
          * Reading (or if it was queued straight from the Feeds list or the reader's
          * quick-analyze button) — this stays visible everywhere so you know it's
          * still working. Hovering summarizes what's running; clicking opens the
          * list so any job can be cancelled individually. */}
        {isAnalyzing && (
          <>
            <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <Popover open={analyzingOpen} onOpenChange={setAnalyzingOpen}>
              <PopoverTrigger asChild>
                <button
                  title={runningJobs.length > 1 ? t("command.analyzingHint", { n: runningJobs.length }) : runningJobs[0]?.title}
                  className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
                  <span className="hidden sm:inline">
                    {t("command.analyzing")}
                    {runningJobs.length > 1 ? ` (${runningJobs.length})` : ""}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2">
                <p className="px-1.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("command.analyzing")}</p>
                <div className="space-y-0.5">
                  {runningJobs.map((job) => (
                    <div key={job.id} className="flex items-center gap-2 rounded-lg py-1 pl-1.5 pr-1">
                      <span className="h-3 w-3 shrink-0 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={job.title}>{job.title}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={job.cancel}
                        title={t("settings.cancel")}
                        aria-label={t("settings.cancel")}
                        className="h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}

        {/* Paste-in reader: read and mine any text that isn't in a feed.
          * Hideable like any other top-bar control; the command palette entry
          * stays either way. */}
        {visible("scratch") && <Button
          variant="ghost"
          onClick={openScratch}
          title={t("scratch.open")}
          className="hidden lg:inline-flex h-8 shrink-0 gap-2 rounded-lg px-2.5 text-xs font-medium text-foreground"
        >
          <ClipboardPaste className="h-4 w-4 text-primary" />
          <span className="hidden lg:inline">{t("scratch.open")}</span>
        </Button>}

        {/* Everything after this point is trailing chrome, so the spacer sits
          * here rather than just before the window controls — otherwise the
          * icon group and avatar stay stranded on the left. */}
        <div className="flex-1" />

        <div className="hidden lg:flex shrink-0 items-center gap-0.5 border-l border-border pl-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleIconsCollapsed}
            title={iconsCollapsed ? t("command.expandIcons") : t("command.collapseIcons")}
            className="h-8 w-8 rounded-lg text-muted-foreground"
          >
            {iconsCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </Button>
          {!iconsCollapsed && <>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleToolsModal}
            title={t("tools.ballLabel")}
            className="h-8 w-8 rounded-lg text-muted-foreground"
          >
            <Grid2x2Plus className="h-4 w-4" />
          </Button>
          {visible("db") && <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("settings", undefined, "data")}
                className={`relative h-8 w-8 rounded-lg ${connection?.kind === "turso" && connection.offline ? "text-amber-500" : "text-muted-foreground"}`}
              >
                {connection?.kind === "turso"
                  ? (connection.offline ? <CloudOff className="h-4 w-4" /> : <Cloud className="h-4 w-4" />)
                  : <Database className="h-4 w-4" />}
                {connection?.kind === "turso" && !connection.offline && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="max-w-64">
              <p className="font-medium">{connection?.kind === "turso" ? t("command.dbCloud") : t("command.dbLocal")}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {connection?.kind === "turso" ? connection.remoteUrl : connection?.path}
              </p>
              {connection?.kind === "turso" && connection.offline && <p className="mt-1 text-amber-500">{t("settings.remoteDBOffline")}</p>}
            </TooltipContent>
          </Tooltip>}
          {hostCapabilities.mcp && visible("mcp") && <Button variant="ghost" size="icon" onClick={() => navigate("settings", undefined, "mcp")} title={mcp.error || (mcp.running ? t("command.mcpRunning") : t("command.mcpStopped"))} className={`relative h-8 w-8 rounded-lg ${mcp.error ? "text-amber-500" : mcp.running ? "text-foreground" : "text-muted-foreground"}`}><Server className="h-4 w-4" />{mcp.running && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-background" />}</Button>}
          {visible("ai") && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title={aiTitle} className={`relative h-8 w-8 rounded-lg ${aiTone}`}>
                {providerConnected || !providersReady ? <BrainCircuit className="h-4 w-4" /> : <Unplug className="h-4 w-4" />}
                {providersReady && providerConnected && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <div className="px-2.5 py-2"><p className="text-xs font-semibold">{t("command.globalModel")}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{t("command.globalModelHint")}</p></div>
              <div className="my-1 h-px bg-border" />
              {availableProviders.map((provider) => (
                <DropdownMenuItem key={provider.id} onClick={() => setDefaultProvider(provider.id)} className="py-2.5">
                  <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{provider.name}</span><span className="block truncate font-mono text-[10px] text-muted-foreground">{provider.modelId}</span></span>
                  {provider.id === defaultProvider && <Check className="h-4 w-4 text-emerald-500" />}
                </DropdownMenuItem>
              ))}
              {availableProviders.length === 0 && <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">{t("command.noModels")}</p>}
              <div className="my-1 h-px bg-border" />
              <DropdownMenuItem onClick={() => navigate("settings")}><Settings className="h-4 w-4" />{t("command.manageModels")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {visible("language") && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" title={t("settings.uiLanguage")} className="h-8 w-8 rounded-lg text-muted-foreground"><Languages className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setLanguage("zh")}><span className="w-5 font-medium">中</span><span className="flex-1">中文</span>{language === "zh" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLanguage("en")}><span className="w-5 font-medium">En</span><span className="flex-1">English</span>{language === "en" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {visible("theme") && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" title={t("settings.theme")} className="h-8 w-8 rounded-lg text-muted-foreground"><ThemeIcon theme={theme} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setTheme("light")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.light")}</span>{theme === "light" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.dark")}</span>{theme === "dark" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("catppuccin-latte")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.catppuccinLatte")}</span>{theme === "catppuccin-latte" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("catppuccin-mocha")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.catppuccinMocha")}</span>{theme === "catppuccin-mocha" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dracula")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.dracula")}</span>{theme === "dracula" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("tokyo-night")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.tokyoNight")}</span>{theme === "tokyo-night" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("tokyo-night-day")}><Sun className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.tokyoNightDay")}</span>{theme === "tokyo-night-day" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("tokyo-night-storm")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.tokyoNightStorm")}</span>{theme === "tokyo-night-storm" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dim")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.dim")}</span>{theme === "dim" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.system")}</span>{theme === "system" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {hostCapabilities.updater && visible("updates") && <UpdateButton placement="toolbar" />}
          {visible("github") && <Button variant="ghost" size="icon" onClick={() => void openGitHub()} title="GitHub" className="h-8 w-8 rounded-lg text-muted-foreground"><GitHubIcon className="h-4 w-4" /></Button>}
          </>}
          <Button variant="ghost" size="icon" onClick={() => navigate("settings")} title={t("command.profile")} className="h-8 w-8 rounded-full p-0 overflow-hidden ring-1 ring-border/60 text-muted-foreground">
            {userAvatar ? <img src={userAvatar} alt="" className="h-full w-full object-cover" /> : <User className="h-4 w-4" />}
          </Button>
        </div>
        {visible("theme") && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title={t("settings.theme")}
                aria-label={t("settings.theme")}
                className="lg:hidden h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ThemeIcon theme={theme} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setTheme("light")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.light")}</span>{theme === "light" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.dark")}</span>{theme === "dark" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("catppuccin-latte")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.catppuccinLatte")}</span>{theme === "catppuccin-latte" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("catppuccin-mocha")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.catppuccinMocha")}</span>{theme === "catppuccin-mocha" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dracula")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.dracula")}</span>{theme === "dracula" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("tokyo-night")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.tokyoNight")}</span>{theme === "tokyo-night" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("tokyo-night-day")}><Sun className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.tokyoNightDay")}</span>{theme === "tokyo-night-day" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("tokyo-night-storm")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.tokyoNightStorm")}</span>{theme === "tokyo-night-storm" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dim")}><Palette className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.dim")}</span>{theme === "dim" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="h-4 w-4" /><span className="flex-1 whitespace-nowrap">{t("settings.system")}</span>{theme === "system" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="ghost" size="icon" onClick={() => navigate("feeds")} title={t("nav.feeds")} aria-label={t("nav.feeds")} className="lg:hidden h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <Rss className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => navigate("settings")} title={t("command.profile")} className="lg:hidden order-first h-8 w-8 shrink-0 rounded-full p-0 overflow-hidden ring-1 ring-border/60 text-muted-foreground">
          {userAvatar ? <img src={userAvatar} alt="" className="h-full w-full object-cover" /> : <User className="h-4 w-4" />}
        </Button>
        </div>

        {/* Outside the scrolling row above, and shrink-0: window controls must
          * survive any width. Inside it they were scrolled out of reach the
          * moment the toolbar overflowed — a window you cannot close. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Only when a password exists — a lock button that cannot lock is
            * worse than no button. */}
          {lockEnabled && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => useAppLockStore.getState().lock()}
              title={t("lock.lockNow")}
              aria-label={t("lock.lockNow")}
              className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Lock className="h-4 w-4" />
            </Button>
          )}
          {isDesktopHost && <WindowControls />}
        </div>
        </div>
      </header>

      {paletteOpen && <div className="fixed inset-0 z-100 flex justify-center bg-black/45 px-4 pt-[14vh] backdrop-blur-xs" onMouseDown={() => setPaletteOpen(false)}><div className="h-fit w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex h-12 items-center gap-3 border-b border-border px-4"><Search className="h-4 w-4 text-muted-foreground" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setPaletteOpen(false)} placeholder={t("command.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm outline-hidden" /><button onClick={() => setPaletteOpen(false)}><X className="h-4 w-4 text-muted-foreground" /></button></div><div className="max-h-80 overflow-y-auto p-2">{commands.map((command, index) => <button key={`${command.label}-${index}`} onClick={() => { command.run(); setPaletteOpen(false); setQuery(""); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-muted"><command.icon className="h-4 w-4 text-muted-foreground" /><span>{command.label}</span></button>)}</div></div></div>}
    </>
  );
}

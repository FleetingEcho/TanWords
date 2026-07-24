import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  BrainCircuit, Check, FilePlus2, Languages,
  MessageSquarePlus, Monitor, Moon, Search, Server, Settings, Sparkles, Sun, Unplug, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WordSearchBox } from "@/components/shared/WordSearchBox";
import { useT } from "@/hooks/useT";
import { findBestProvider } from "@/providers/select";
import { getAllProviders, type AIProvider } from "@/providers";
import { NavPage, useNavStore } from "@/store/navStore";
import { UpdateButton } from "@/components/Layout/UpdateButton";
import { useSettingsStore } from "@/store/settingsStore";
import { useAnalysisStore } from "@/store/analysisStore";
import { GitHubIcon } from "@/components/ui/icons";

type McpState = { status: { running: boolean; error: string | null } };

const PAGE_IDS: NavPage[] = ["feeds", "vocabulary", "documents", "chat", "dashboard", "scene-lab", "music", "settings"];

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
  const visible = (item: import("@/store/settingsStore").TopBarItemId) => visibleItems.includes(item);
  const isAnalyzing = useAnalysisStore((state) => state.isAnalyzing);
  const analyzingJobs = useAnalysisStore((state) => state.jobs);
  const cancelAnalyzing = useAnalysisStore((state) => state.cancel);
  const [analyzingOpen, setAnalyzingOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [mcp, setMcp] = React.useState<{ running: boolean; error: string | null }>({ running: false, error: null });
  const [providerConnected, setProviderConnected] = React.useState(() => Boolean(findBestProvider()));
  const [availableProviders, setAvailableProviders] = React.useState<AIProvider[]>(() => getAllProviders().filter((provider) => provider.apiKey));

  const refreshMcp = React.useCallback(() => {
    invoke<McpState>("mcp_get_config").then((result) => setMcp(result.status)).catch(() => {});
  }, []);

  React.useEffect(() => {
    refreshMcp();
    const refreshStatus = () => {
      refreshMcp();
      setProviderConnected(Boolean(findBestProvider()));
      setAvailableProviders(getAllProviders().filter((provider) => provider.apiKey));
    };
    const timer = window.setInterval(refreshStatus, 5000);
    window.addEventListener("tanwords:mcp-status-changed", refreshStatus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("tanwords:mcp-status-changed", refreshStatus);
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
  const digest = () => dispatch("tanwords:conversation-note");
  const openGitHub = async () => {
    const url = "https://github.com/FleetingEcho/TanWords";
    try { await openUrl(url); } catch { window.open(url, "_blank", "noopener,noreferrer"); }
  };
  const commands = [
    ...PAGE_IDS.map((page) => ({ label: t(`nav.${page}`), icon: Search, run: () => navigate(page) })),
    { label: t("command.newDocument"), icon: FilePlus2, run: newDocument },
    { label: t("command.newChat"), icon: MessageSquarePlus, run: newChat },
  ].filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));

  const context = activePage === "documents"
    ? { label: t("command.newDocument"), icon: FilePlus2, run: newDocument }
    : activePage === "chat"
      ? { label: t("command.conversationNote"), icon: Sparkles, run: digest }
      : null;

  return (
    <>
      <header className="relative z-20 flex h-12 shrink-0 select-none items-center gap-1.5 border-b border-border/80 bg-background/90 px-3 backdrop-blur-xl">
        {visible("search") && <div className="min-w-0 max-w-72 flex-1"><WordSearchBox variant="inline" /></div>}

        {visible("context") && context && <><div className="mx-1 hidden h-5 w-px bg-border sm:block" /><Button variant="ghost" onClick={context.run} className="h-8 gap-2 rounded-lg px-2.5 text-xs font-medium text-foreground"><context.icon className="h-4 w-4 text-primary" /><span className="hidden lg:inline">{context.label}</span></Button></>}

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
                  title={analyzingJobs.length > 1 ? t("command.analyzingHint", { n: analyzingJobs.length }) : analyzingJobs[0]?.title}
                  className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
                  <span className="hidden sm:inline">
                    {t("command.analyzing")}
                    {analyzingJobs.length > 1 ? ` (${analyzingJobs.length})` : ""}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2">
                <p className="px-1.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("command.analyzing")}</p>
                <div className="space-y-0.5">
                  {analyzingJobs.map((job) => (
                    <div key={job.id} className="flex items-center gap-2 rounded-lg py-1 pl-1.5 pr-1">
                      <span className="h-3 w-3 shrink-0 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={job.title}>{job.title}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => cancelAnalyzing(job.id)}
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

        <div className="ml-auto flex items-center gap-0.5 border-l border-border pl-2">
          {visible("mcp") && <Button variant="ghost" size="icon" onClick={() => navigate("settings")} title={mcp.error || (mcp.running ? t("command.mcpRunning") : t("command.mcpStopped"))} className={`relative h-8 w-8 rounded-lg ${mcp.error ? "text-amber-500" : mcp.running ? "text-foreground" : "text-muted-foreground"}`}><Server className="h-4 w-4" />{mcp.running && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-background" />}</Button>}
          {visible("ai") && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title={providerConnected ? t("command.switchModel") : t("command.aiDisconnected")} className={`relative h-8 w-8 rounded-lg ${providerConnected ? "text-foreground" : "text-amber-500"}`}>
                {providerConnected ? <BrainCircuit className="h-4 w-4" /> : <Unplug className="h-4 w-4" />}
                {providerConnected && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
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
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" title={t("settings.theme")} className="h-8 w-8 rounded-lg text-muted-foreground">{theme === "light" ? <Sun className="h-4 w-4" /> : theme === "dark" ? <Moon className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="h-4 w-4" /><span className="flex-1">{t("settings.light")}</span>{theme === "light" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="h-4 w-4" /><span className="flex-1">{t("settings.dark")}</span>{theme === "dark" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="h-4 w-4" /><span className="flex-1">{t("settings.system")}</span>{theme === "system" && <Check className="h-4 w-4 text-primary" />}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {visible("updates") && <UpdateButton placement="toolbar" />}
          {visible("github") && <Button variant="ghost" size="icon" onClick={() => void openGitHub()} title="GitHub" className="h-8 w-8 rounded-lg text-muted-foreground"><GitHubIcon className="h-4 w-4" /></Button>}
          <Button variant="ghost" size="icon" onClick={() => navigate("settings")} title={t("nav.settings")} className="h-8 w-8 rounded-lg text-muted-foreground"><Settings className="h-4 w-4" /></Button>
        </div>
      </header>

      {paletteOpen && <div className="fixed inset-0 z-[100] flex justify-center bg-black/45 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={() => setPaletteOpen(false)}><div className="h-fit w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex h-12 items-center gap-3 border-b border-border px-4"><Search className="h-4 w-4 text-muted-foreground" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setPaletteOpen(false)} placeholder={t("command.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /><button onClick={() => setPaletteOpen(false)}><X className="h-4 w-4 text-muted-foreground" /></button></div><div className="max-h-80 overflow-y-auto p-2">{commands.map((command, index) => <button key={`${command.label}-${index}`} onClick={() => { command.run(); setPaletteOpen(false); setQuery(""); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-muted"><command.icon className="h-4 w-4 text-muted-foreground" /><span>{command.label}</span></button>)}</div></div></div>}
    </>
  );
}

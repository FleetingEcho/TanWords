import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Eye, EyeOff, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, useSettingsStore, Theme } from "@/store/settingsStore";
import { DEFAULT_ENRICH_SYSTEM_PROMPT } from "@/providers/base";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { ProviderSection } from "./ProviderSection";
import { TtsSection } from "./TtsSection";
import { getTotalTokens, clearUsage } from "@/store/usageStore";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const LEVELS = ["A2", "B1", "B2", "C1", "C2"] as const;

export function SettingRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-border last:border-0 gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleGroup({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg">
      {options.map((o) => (
        <Button
          key={o.id}
          variant="ghost"
          onClick={() => onChange(o.id)}
          className={`h-auto px-3 py-1 rounded-md text-xs font-medium transition-colors hover:bg-transparent ${
            value === o.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function EnrichPromptEditor() {
  const t = useT();
  const customEnrichPrompt = useSettingsStore((s) => s.customEnrichPrompt);
  const setCustomEnrichPrompt = useSettingsStore((s) => s.setCustomEnrichPrompt);
  const [draft, setDraft] = useState(customEnrichPrompt || DEFAULT_ENRICH_SYSTEM_PROMPT);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDraft(customEnrichPrompt || DEFAULT_ENRICH_SYSTEM_PROMPT), [customEnrichPrompt]);

  const onChange = useCallback((value: string) => {
    setDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setCustomEnrichPrompt(value), 500);
  }, [setCustomEnrichPrompt]);

  const resetToDefault = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDraft(DEFAULT_ENRICH_SYSTEM_PROMPT);
    setCustomEnrichPrompt("");
  };

  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("settings.enrichPrompt")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("settings.enrichPromptSub")}</p>
        </div>
        {draft !== DEFAULT_ENRICH_SYSTEM_PROMPT && (
          <Button variant="ghost" onClick={resetToDefault} className="h-auto px-2 py-1 text-xs shrink-0">
            {t("settings.enrichPromptReset")}
          </Button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("settings.enrichPromptPlaceholder")}
        rows={8}
        className="w-full px-3 py-2 rounded-lg border border-input bg-background text-xs font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring resize-y"
      />
    </div>
  );
}

const SECTIONS = ["general", "providers", "learning", "tts", "mcp", "data"] as const;
type SectionId = (typeof SECTIONS)[number];

export function SettingsPage() {
  const settings = useSettingsStore();
  const t = useT();
  const db = useDB();

  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    general: null, providers: null, learning: null, tts: null, mcp: null, data: null,
  });

  // Scrollspy: highlight the nav item for whichever section is in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full animate-fade-in">
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-full px-8 py-6 space-y-10">
          <section ref={(el) => { sectionRefs.current.general = el; }} data-section="general" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.general")}</p>
            <div className="bg-card border border-border rounded-xl px-5 divide-y divide-border">
              <SettingRow label={t("settings.uiLanguage")} sub={t("settings.uiLanguageSub")}>
                <ToggleGroup
                  options={[{ id: "zh", label: "中文" }, { id: "en", label: "English" }]}
                  value={settings.uiLanguage}
                  onChange={(v) => settings.setUiLanguage(v)}
                />
              </SettingRow>
              <SettingRow label={t("settings.theme")} sub={t("settings.themeSub")}>
                <ToggleGroup
                  options={[
                    { id: "light", label: t("settings.light") },
                    { id: "dark", label: t("settings.dark") },
                    { id: "system", label: t("settings.system") },
                  ]}
                  value={settings.theme}
                  onChange={(v) => settings.setTheme(v as Theme)}
                />
              </SettingRow>
              <SettingRow label={t("settings.quickDoc")} sub={t("settings.quickDocSub")}>
                <ToggleGroup
                  options={[
                    { id: "on", label: t("settings.on") },
                    { id: "off", label: t("settings.off") },
                  ]}
                  value={settings.showQuickDoc ? "on" : "off"}
                  onChange={(v) => settings.setShowQuickDoc(v === "on")}
                />
              </SettingRow>
              <div className="py-4">
                <div className="mb-3">
                  <div className="flex items-center gap-2.5">
                    <p className="text-sm font-medium">{t("settings.topBarItems")}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{t("settings.topBarItemsSelected", { n: settings.visibleTopBarItems.length })}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.topBarItemsSub")}</p>
                </div>
                <div className="flex max-w-4xl flex-wrap gap-2">
                  {DEFAULT_TOPBAR_ITEMS.map((item) => {
                    const visible = settings.visibleTopBarItems.includes(item);
                    return (
                      <label key={item} className={`flex h-8 w-32 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${visible ? "border-primary/30 bg-primary/[0.07] text-foreground" : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
                        <Checkbox className="h-3.5 w-3.5 rounded-full shadow-none" checked={visible} onCheckedChange={(checked) => settings.setTopBarItemVisible(item, checked === true)} />
                        <span className="truncate">{t(`settings.topBar.${item}`)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="py-4">
                <div className="mb-3">
                  <div className="flex items-center gap-2.5">
                    <p className="text-sm font-medium">{t("settings.sidebarTabs")}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t("settings.sidebarTabsSelected", { n: settings.visibleSidebarTabs.length })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.sidebarTabsSub")}</p>
                </div>
                <div className="flex max-w-3xl flex-wrap gap-2">
                  {DEFAULT_SIDEBAR_TABS.map((tab) => {
                    const visible = settings.visibleSidebarTabs.includes(tab);
                    return (
                      <label
                        key={tab}
                        className={`flex h-8 w-32 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
                          visible
                            ? "border-primary/30 bg-primary/[0.07] text-foreground"
                            : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <Checkbox className="h-3.5 w-3.5 rounded-full shadow-none" checked={visible} onCheckedChange={(checked) => settings.setSidebarTabVisible(tab, checked === true)} />
                        <span className="truncate">{t(`nav.${tab}`)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section ref={(el) => { sectionRefs.current.providers = el; }} data-section="providers" className="scroll-mt-6 space-y-6">
            <ProviderSection />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.usage")}</p>
              <AiUsageCard />
            </div>
          </section>

          <section ref={(el) => { sectionRefs.current.learning = el; }} data-section="learning" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.section.learning")}</p>
            <div className="bg-card border border-border rounded-xl px-5 divide-y divide-border">
              <SettingRow label={t("settings.targetLevel")} sub={t("settings.targetLevelSub")}>
                <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg">
                  {LEVELS.map((lvl) => {
                    const selected = settings.targetLevels.includes(lvl);
                    return (
                      <Button
                        key={lvl}
                        variant="ghost"
                        onClick={() =>
                          settings.setTargetLevels(
                            selected
                              ? settings.targetLevels.filter((l) => l !== lvl)
                              : [...LEVELS.filter((l) => settings.targetLevels.includes(l) || l === lvl)]
                          )
                        }
                        className={`h-auto px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                          selected ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary" : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                        }`}
                      >
                        {lvl}
                      </Button>
                    );
                  })}
                </div>
              </SettingRow>
              <EnrichPromptEditor />
            </div>
          </section>

          <section ref={(el) => { sectionRefs.current.tts = el; }} data-section="tts" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.section.tts")}</p>
            <TtsSection />
          </section>

          <section ref={(el) => { sectionRefs.current.mcp = el; }} data-section="mcp" className="scroll-mt-6">
            <McpSection />
          </section>

          <section ref={(el) => { sectionRefs.current.data = el; }} data-section="data" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.section.data")}</p>
            <DataSection db={db} t={t} />
          </section>
        </div>
      </div>
    </div>
  );
}

type McpConfig = { enabled: boolean; port: number; token: string };
type McpStatus = { running: boolean; endpoint: string | null; error: string | null };

function McpSection() {
  const t = useT();
  const [config, setConfig] = useState<McpConfig>({ enabled: false, port: 47831, token: "" });
  const [status, setStatus] = useState<McpStatus>({ running: false, endpoint: null, error: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ config: McpConfig; status: McpStatus }>("mcp_get_config")
      .then(async (result) => {
        const token = result.config.token || await invoke<string>("mcp_generate_token");
        setConfig({ ...result.config, token });
        setStatus(result.status);
      })
      .catch((error) => toast.error(String(error)))
      .finally(() => setLoading(false));
  }, []);

  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1400);
  };

  const regenerate = async () => {
    const token = await invoke<string>("mcp_generate_token");
    setConfig((current) => ({ ...current, token }));
  };

  const apply = async (candidate: McpConfig = config, rollback?: McpConfig) => {
    if (candidate.port < 1024 || candidate.port > 65535) {
      toast.error(t("settings.mcpPortInvalid"));
      return;
    }
    setSaving(true);
    try {
      const next = await invoke<McpStatus>("mcp_apply_config", { config: candidate });
      setConfig(candidate);
      setStatus(next);
      window.dispatchEvent(new CustomEvent("tanwords:mcp-status-changed"));
      toast.success(next.running ? t("settings.mcpStarted") : t("settings.mcpStopped"));
    } catch (error) {
      if (rollback) setConfig(rollback);
      setStatus((current) => ({ ...current, running: false, error: String(error) }));
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleServer = () => {
    if (loading || saving) return;
    const next = { ...config, enabled: !config.enabled };
    setConfig(next);
    void apply(next, config);
  };

  const endpoint = status.endpoint || `http://127.0.0.1:${config.port}/mcp`;
  const clientConfig = JSON.stringify({
    mcpServers: { tanwords: { url: endpoint, headers: { Authorization: `Bearer ${config.token}` } } },
  }, null, 2);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t("settings.section.mcp")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.mcpDescription")}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.running ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500" : "border-border bg-muted/50 text-muted-foreground"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.running ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
          {status.running ? t("settings.mcpRunning") : t("settings.mcpNotRunning")}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-5 border-b border-border bg-gradient-to-r from-primary/[0.07] to-transparent px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><Server className="h-5 w-5" /></div>
            <div><p className="text-sm font-semibold">{t("settings.mcpLocalServer")}</p><p className="text-xs text-muted-foreground">{t("settings.mcpLocalOnly")}</p></div>
          </div>
          <button type="button" disabled={loading || saving} onClick={toggleServer} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${config.enabled ? "bg-primary" : "bg-muted"}`} aria-label={t("settings.mcpEnable")}>
            <span className={`pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${config.enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <label className="space-y-1.5"><span className="text-xs font-medium">{t("settings.mcpPort")}</span><input type="number" min={1024} max={65535} value={config.port} onChange={(event) => setConfig((current) => ({ ...current, port: Number(event.target.value) }))} className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
            <div className="space-y-1.5"><span className="text-xs font-medium">{t("settings.mcpEndpoint")}</span><div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-muted/30 px-3"><code className="min-w-0 flex-1 truncate text-xs">{endpoint}</code><button type="button" onClick={() => copy(endpoint, "endpoint")} className="text-muted-foreground hover:text-foreground">{copied === "endpoint" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}</button></div></div>
          </div>

          <div className="space-y-1.5"><div className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-primary" /><span className="text-xs font-medium">{t("settings.mcpToken")}</span></div><div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3"><code className="min-w-0 flex-1 truncate text-xs">{showToken ? config.token : "•".repeat(32)}</code><button type="button" onClick={() => setShowToken((value) => !value)} className="text-muted-foreground hover:text-foreground">{showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button type="button" onClick={() => copy(config.token, "token")} className="text-muted-foreground hover:text-foreground">{copied === "token" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}</button><button type="button" onClick={regenerate} title={t("settings.mcpRegenerate")} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-4 w-4" /></button></div><p className="text-[11px] text-muted-foreground">{t("settings.mcpTokenHint")}</p></div>

          <div className="rounded-lg border border-border bg-muted/25 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium">{t("settings.mcpClientConfig")}</span><Button variant="ghost" onClick={() => copy(clientConfig, "config")} className="h-7 gap-1.5 px-2 text-xs">{copied === "config" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}{t("settings.mcpCopy")}</Button></div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{clientConfig}</pre></div>

          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t("settings.mcpTools")}</p><Button onClick={() => void apply()} disabled={loading || saving || !config.enabled} className="h-9 rounded-lg px-4 text-xs font-semibold">{saving ? t("settings.mcpApplying") : t("settings.mcpApply")}</Button></div>
          {status.error && <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{status.error}</p>}
        </div>
      </div>
    </div>
  );
}

function DataSection({ db, t }: { db: ReturnType<typeof useDB>; t: ReturnType<typeof useT> }) {
  const [dbPath, setDbPath] = useState("");
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingSwitchPath, setPendingSwitchPath] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    db.getDbPath().then(setDbPath);
    db.getDbSize().then(setDbSize);
  }, []);

  const formattedDbSize = dbSize === null
    ? "…"
    : dbSize >= 1024 ** 3
      ? `${(dbSize / 1024 ** 3).toFixed(2)} GB`
      : dbSize >= 1024 ** 2
        ? `${(dbSize / 1024 ** 2).toFixed(2)} MB`
        : dbSize >= 1024
          ? `${(dbSize / 1024).toFixed(1)} KB`
          : `${dbSize} B`;

  const handleOpenExisting = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (typeof picked === "string") setPendingSwitchPath(picked);
  };

  const handleNewLocation = async () => {
    const picked = await saveDialog({
      defaultPath: "tanwords.db",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (picked) setPendingSwitchPath(picked);
  };

  const confirmSwitch = async () => {
    if (!pendingSwitchPath) return;
    setSwitching(true);
    try {
      await db.switchDbPath(pendingSwitchPath);
      toast.success(t("settings.switchDBOk"));
      setTimeout(() => window.location.reload(), 600);
    } catch {
      // useDB already toasts the failure
      setSwitching(false);
      setPendingSwitchPath(null);
    }
  };

  const handleExport = async () => {
    const dest = await saveDialog({
      defaultPath: `tanwords-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (!dest) return;
    setExporting(true);
    try {
      await db.exportBackup(dest);
      toast.success(t("settings.exportOk"));
    } catch {
      // useDB already toasts the failure
    } finally {
      setExporting(false);
    }
  };

  const handleClearTranslations = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    await db.clearTranslations();
    setConfirmClear(false);
    toast.success(t("settings.dangerClearedOk"));
  };

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl px-5 divide-y divide-border">
        <SettingRow label={t("settings.dbLocation")}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-[360px] truncate font-mono text-[11px] text-muted-foreground" title={dbPath}>{dbPath || "…"}</span>
            <span className="shrink-0 rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground" title={t("settings.dbSizeIncludesAuxiliary")}>{formattedDbSize}</span>
          </div>
        </SettingRow>
        <SettingRow label={t("settings.switchDB")} sub={t("settings.switchDBSub")}>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleOpenExisting}
              className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
            >
              {t("settings.switchDBOpenExisting")}
            </Button>
            <Button
              variant="outline"
              onClick={handleNewLocation}
              className="h-8 px-3 rounded-lg text-xs font-medium border border-input hover:bg-muted transition-colors"
            >
              {t("settings.switchDBNewLocation")}
            </Button>
          </div>
        </SettingRow>
        <SettingRow label={t("settings.exportDB")} sub={t("settings.exportDBSub")}>
          <Button
            onClick={handleExport}
            disabled={exporting}
            className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {exporting ? t("settings.exporting") : t("settings.exportDB")}
          </Button>
        </SettingRow>
      </div>

      <div className="bg-destructive/5 border border-destructive/20 rounded-xl px-5">
        <SettingRow label={t("settings.dangerClearTranslations")} sub={t("settings.dangerClearTranslationsSub")}>
          <Button
            variant="ghost"
            onClick={handleClearTranslations}
            className={`h-8 px-4 rounded-lg text-xs font-semibold transition-colors ${
              confirmClear
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "border border-destructive/40 text-destructive hover:bg-destructive/10"
            }`}
          >
            {confirmClear ? t("settings.dangerConfirm") : t("settings.dangerClear")}
          </Button>
        </SettingRow>
      </div>

      <ConfirmModal
        open={pendingSwitchPath !== null}
        title={t("settings.switchDBConfirmTitle")}
        message={t("settings.switchDBConfirmMessage")}
        confirmLabel={switching ? t("settings.switching") : t("settings.switchDB")}
        danger={false}
        confirmDisabled={switching}
        onCancel={() => setPendingSwitchPath(null)}
        onConfirm={confirmSwitch}
      />
    </div>
  );
}

function AiUsageCard() {
  const t = useT();
  const [totals, setTotals] = useState(getTotalTokens());
  const [_, forceUpdate] = useState(0);

  const handleClear = () => {
    clearUsage();
    setTotals(getTotalTokens());
    forceUpdate((n) => n + 1);
  };

  useEffect(() => {
    const handler = () => setTotals(getTotalTokens());
    window.addEventListener("usage-updated", handler);
    return () => window.removeEventListener("usage-updated", handler);
  }, []);

  const fmt = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();

  return (
    <div className="bg-card border border-border rounded-xl px-5 py-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-x-4">
          <span className="text-xs text-muted-foreground">{t("settings.inputTokens")}: <span className="font-mono font-semibold text-foreground">{fmt(totals.input)}</span></span>
          <span className="text-xs text-muted-foreground">{t("settings.outputTokens")}: <span className="font-mono font-semibold text-foreground">{fmt(totals.output)}</span></span>
          <span className="text-xs text-muted-foreground">{t("settings.totalTokens")}: <span className="font-mono font-semibold text-foreground">{fmt(totals.total)}</span></span>
        </div>
        <Button variant="link" onClick={handleClear} className="h-auto p-0 text-xs text-muted-foreground hover:text-destructive transition-colors">{t("settings.clearUsage")}</Button>
      </div>
    </div>
  );
}

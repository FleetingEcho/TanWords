import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { invoke } from "@/ipc/backend";
import { Check, ChevronDown, Copy, Eye, EyeOff, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

type McpConfig = { enabled: boolean; port: number; token: string };
type McpStatus = { running: boolean; endpoint: string | null; error: string | null };

/** Grouped by the resource each tool acts on, mirroring src-tauri/src/mcp/tools.rs. */
const MCP_TOOL_GROUPS: { key: string; tools: string[] }[] = [
  { key: "vocabulary", tools: ["vocabulary_search", "vocabulary_known_words", "vocabulary_get", "vocabulary_add", "vocabulary_add_batch", "vocabulary_update", "vocabulary_delete"] },
  { key: "documents", tools: ["documents_list", "documents_search", "documents_get", "documents_create", "documents_update", "documents_append", "documents_delete"] },
  { key: "sentences", tools: ["sentences_list", "sentences_search", "sentences_add"] },
  { key: "articles", tools: ["articles_add", "articles_list", "articles_get", "articles_comment"] },
  { key: "feeds", tools: ["feeds_list", "feeds_entries"] },
  { key: "hackernews", tools: ["hackernews_list", "hackernews_search", "hackernews_comments"] },
];

function McpToolsDetail({ t }: { t: (key: string, vars?: Record<string, string | number>) => string }) {
  const [expanded, setExpanded] = useState(false);
  const toolCount = MCP_TOOL_GROUPS.reduce((count, group) => count + group.tools.length, 0);

  return (
    <div className="rounded-lg border border-border/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{t("settings.mcpTools", { n: toolCount })}</span>
        <span className="flex items-center gap-1 shrink-0">
          {expanded ? t("settings.mcpToolsCollapse") : t("settings.mcpToolsExpand")}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {MCP_TOOL_GROUPS.map((group) => (
            <div key={group.key}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`settings.mcpToolGroup.${group.key}`)}
              </p>
              <ul className="space-y-1">
                {group.tools.map((tool) => (
                  <li key={tool} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{tool}</code>
                    <span className="text-muted-foreground">{t(`settings.mcpTool.${tool}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function McpSection() {
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
        <div className="flex items-center justify-between gap-5 border-b border-border bg-linear-to-r from-primary/[0.07] to-transparent px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><Server className="h-5 w-5" /></div>
            <div><p className="text-sm font-semibold">{t("settings.mcpLocalServer")}</p><p className="text-xs text-muted-foreground">{t("settings.mcpLocalOnly")}</p></div>
          </div>
          <button type="button" disabled={loading || saving} onClick={toggleServer} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${config.enabled ? "bg-primary" : "bg-muted"}`} aria-label={t("settings.mcpEnable")}>
            <span className={`pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${config.enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <label className="space-y-1.5"><span className="text-xs font-medium">{t("settings.mcpPort")}</span><input type="number" min={1024} max={65535} value={config.port} onChange={(event) => setConfig((current) => ({ ...current, port: Number(event.target.value) }))} className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-hidden focus:ring-2 focus:ring-ring" /></label>
            <div className="space-y-1.5"><span className="text-xs font-medium">{t("settings.mcpEndpoint")}</span><div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-muted/30 px-3"><code className="min-w-0 flex-1 truncate text-xs">{endpoint}</code><button type="button" onClick={() => copy(endpoint, "endpoint")} className="text-muted-foreground hover:text-foreground">{copied === "endpoint" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}</button></div></div>
          </div>

          <div className="space-y-1.5"><div className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-primary" /><span className="text-xs font-medium">{t("settings.mcpToken")}</span></div><div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3"><code className="min-w-0 flex-1 truncate text-xs">{showToken ? config.token : "•".repeat(32)}</code><button type="button" onClick={() => setShowToken((value) => !value)} className="text-muted-foreground hover:text-foreground">{showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button><button type="button" onClick={() => copy(config.token, "token")} className="text-muted-foreground hover:text-foreground">{copied === "token" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}</button><button type="button" onClick={regenerate} title={t("settings.mcpRegenerate")} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-4 w-4" /></button></div><p className="text-[11px] text-muted-foreground">{t("settings.mcpTokenHint")}</p></div>

          <div className="rounded-lg border border-border bg-muted/25 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium">{t("settings.mcpClientConfig")}</span><Button variant="ghost" onClick={() => copy(clientConfig, "config")} className="h-7 gap-1.5 px-2 text-xs">{copied === "config" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}{t("settings.mcpCopy")}</Button></div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{clientConfig}</pre></div>

          <McpToolsDetail t={t} />

          <div className="flex flex-wrap items-center justify-end gap-3"><Button onClick={() => void apply()} disabled={loading || saving || !config.enabled} className="h-9 rounded-lg px-4 text-xs font-semibold">{saving ? t("settings.mcpApplying") : t("settings.mcpApply")}</Button></div>
          {status.error && <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{status.error}</p>}
        </div>
      </div>
    </div>
  );
}

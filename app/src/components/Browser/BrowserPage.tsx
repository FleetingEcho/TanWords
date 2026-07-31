import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Home, MessageSquareQuote, RotateCw, Trash2 } from "lucide-react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useBrowserPanel } from "./useBrowserPanel";
import { BrowserTabStrip } from "./BrowserTabStrip";
import { BrowserEmptyState } from "./BrowserEmptyState";
import { BrowserAskPane } from "./BrowserAskPane";

export default function BrowserPage() {
  const t = useT();
  const {
    setContainer, tabs, active, error,
    open, reload, goBack, goForward, goHome, clearData,
    newTab, selectTab, closeTab,
  } = useBrowserPanel();

  const url = active?.url ?? "";
  const opened = !!active && !active.atHome && !!active.panelId;
  const loading = !!active?.loading;

  const [addressInput, setAddressInput] = useState(url);
  const editingRef = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  // Keep the address bar in sync with in-page navigation (clicking a link
  // inside the embedded site) and with tab switches — but never while the
  // user is actively typing a new address, or their edit would get
  // overwritten mid-keystroke.
  useEffect(() => {
    if (!editingRef.current) setAddressInput(url);
  }, [url, active?.key]);

  const go = () => void open(addressInput);

  const handleClearData = async () => {
    setClearing(true);
    try {
      await clearData();
      toast.success(t("browser.clearDataDone"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <BrowserTabStrip
        tabs={tabs}
        activeKey={active?.key}
        onSelect={selectTab}
        onClose={closeTab}
        onNew={newTab}
      />

      {/* Fixed h-12 (not py-2 + content-driven height) so this row's box height
        * is deterministic — the native browser panel is positioned to start
        * exactly where this row's rect measures out to, and any implicit growth
        * here (e.g. platform-specific form-control sizing) would silently push
        * the toolbar's own content down past that boundary, under the panel. */}
      <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-3">
        <Button
          variant="ghost" size="icon" onClick={() => void goBack()} disabled={!opened}
          className="h-8 w-8 text-muted-foreground" title={t("browser.back")} aria-label={t("browser.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="icon" onClick={() => void goForward()} disabled={!opened}
          className="h-8 w-8 text-muted-foreground" title={t("browser.forward")} aria-label={t("browser.forward")}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="icon" onClick={() => void reload()} disabled={!opened}
          className="h-8 w-8 text-muted-foreground" title={t("browser.reload")} aria-label={t("browser.reload")}
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="ghost" size="icon" onClick={goHome} disabled={!opened}
          className="h-8 w-8 text-muted-foreground" title={t("browser.home")} aria-label={t("browser.home")}
        >
          <Home className="h-4 w-4" />
        </Button>

        <div className="relative mx-1 flex-1 min-w-0">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onFocus={() => { editingRef.current = true; }}
            onBlur={() => { editingRef.current = false; }}
            onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); go(); } }}
            placeholder={t("browser.addressPlaceholder")}
            className="h-8 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <Button
          variant="ghost" size="icon" onClick={() => void openShell(url)} disabled={!opened}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title={t("browser.openInDefaultBrowser")} aria-label={t("browser.openInDefaultBrowser")}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="icon" onClick={() => setAskOpen((v) => !v)}
          className={`h-8 w-8 ${askOpen ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
          title={t("browser.askSelection")} aria-label={t("browser.askSelection")}
        >
          <MessageSquareQuote className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="icon" onClick={() => setConfirmClear(true)}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          title={t("browser.clearData")} aria-label={t("browser.clearData")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div ref={setContainer} className="relative min-h-0 flex-1 bg-muted/20">
          {!opened && !active?.preview && <BrowserEmptyState onOpen={(u) => void open(u)} />}
          {active?.preview && (
            // The native view is detached while a modal is up (it would
            // otherwise render on top of it — see browserPanelStore.ts) —
            // this still frame stands in so the page reads as paused, not gone.
            <img src={active.preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
        </div>
        {askOpen && <BrowserAskPane onClose={() => setAskOpen(false)} />}
      </div>

      <ConfirmModal
        open={confirmClear}
        title={t("browser.clearDataConfirmTitle")}
        message={t("browser.clearDataConfirmMessage")}
        confirmLabel={clearing ? t("browser.clearingData") : t("browser.clearData")}
        confirmDisabled={clearing}
        danger
        onConfirm={() => void handleClearData()}
        onCancel={() => !clearing && setConfirmClear(false)}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Home, MessageSquareQuote, RotateCw, ShieldCheck, ShieldOff, Trash2, VenetianMask } from "lucide-react";
import { openExternal as openShell } from "@/ipc/shell";
import { useT } from "@/hooks/useT";
import { isDesktopHost } from "@/platform";
import { getWebToken } from "@/platform/webClient";
import { useSettingsStore } from "@/store/settingsStore";
import { usePrivateBrowsingStore } from "@/store/privateBrowsingStore";
import { invoke } from "@/ipc/backend";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useBrowserPanel } from "./useBrowserPanel";
import { useWebBrowser } from "./useWebBrowser";
import { BrowserTabStrip } from "./BrowserTabStrip";
import { BrowserEmptyState } from "./BrowserEmptyState";
import { BrowserAskPane } from "./BrowserAskPane";
import { BrowserHistoryMenu } from "./BrowserHistoryMenu";

/** The Browser page: desktop uses a native `WebContentsView` (with optional
 *  ad/tracker blocking); web falls back to `<iframe>`s. The toolbar is shared —
 *  only the content surface and a couple of desktop-only buttons differ. */
export default function BrowserPage() {
  return isDesktopHost ? <DesktopBrowserPage /> : <WebBrowserPage />;
}

/** Shared toolbar. `rightExtras` lets each host add desktop-only buttons
 *  (shield, clear-data) to the right end without duplicating the nav/address
 *  markup. */
function BrowserToolbar({
  t, opened, loading, url,
  onBack, onForward, onReload, onHome,
  addressInput, onAddressChange, onAddressFocus, onAddressBlur, onAddressKeyDown, onGo,
  onOpenExternal, askOpen, onToggleAsk, rightExtras,
}: {
  t: ReturnType<typeof useT>;
  opened: boolean;
  loading: boolean;
  url: string;
  onBack: () => void; onForward: () => void; onReload: () => void; onHome: () => void;
  addressInput: string;
  onAddressChange: (v: string) => void;
  onAddressFocus: () => void; onAddressBlur: () => void;
  onAddressKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onGo: () => void;
  onOpenExternal: () => void;
  askOpen: boolean; onToggleAsk: () => void;
  rightExtras?: React.ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-3">
      <Button variant="ghost" size="icon" onClick={onBack} disabled={!opened}
        className="h-8 w-8 text-muted-foreground" title={t("browser.back")} aria-label={t("browser.back")}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onForward} disabled={!opened}
        className="h-8 w-8 text-muted-foreground" title={t("browser.forward")} aria-label={t("browser.forward")}>
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onReload} disabled={!opened}
        className="h-8 w-8 text-muted-foreground" title={t("browser.reload")} aria-label={t("browser.reload")}>
        <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      </Button>
      <Button variant="ghost" size="icon" onClick={onHome} disabled={!opened}
        className="h-8 w-8 text-muted-foreground" title={t("browser.home")} aria-label={t("browser.home")}>
        <Home className="h-4 w-4" />
      </Button>

      <div className="relative mx-1 flex-1 min-w-0">
        <Globe className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={addressInput}
          onChange={(e) => onAddressChange(e.target.value)}
          onFocus={onAddressFocus}
          onBlur={onAddressBlur}
          onKeyDown={onAddressKeyDown}
          placeholder={t("browser.addressPlaceholder")}
          className="h-8 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-hidden transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <Button variant="ghost" size="icon" onClick={onOpenExternal} disabled={!opened}
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        title={t("browser.openInDefaultBrowser")} aria-label={t("browser.openInDefaultBrowser")}>
        <ExternalLink className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onToggleAsk}
        className={`h-8 w-8 ${askOpen ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
        title={t("browser.askSelection")} aria-label={t("browser.askSelection")}>
        <MessageSquareQuote className="h-4 w-4" />
      </Button>
      {rightExtras}
      <span className="sr-only">{url}</span>
    </div>
  );
}

function DesktopBrowserPage() {
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

  const adBlockEnabled = useSettingsStore((s) => s.browserAdBlockEnabled);
  const setAdBlockEnabled = useSettingsStore((s) => s.setBrowserAdBlockEnabled);
  const privateMode = usePrivateBrowsingStore((s) => s.enabled);
  const togglePrivateMode = usePrivateBrowsingStore((s) => s.toggle);

  // Keep the main-process blocker in sync with the persisted preference — on
  // mount (after settings hydrate) and on every toggle. The main process
  // defaults on, so a first-run page load is blocked until this lands if the
  // stored value happens to be off.
  useEffect(() => {
    void invoke("browser_set_adblock_enabled", { enabled: adBlockEnabled });
  }, [adBlockEnabled]);

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
      <BrowserTabStrip tabs={tabs} activeKey={active?.key} onSelect={selectTab} onClose={closeTab} onNew={newTab} />
      <BrowserToolbar
        t={t} opened={opened} loading={loading} url={url}
        onBack={() => void goBack()} onForward={() => void goForward()} onReload={() => void reload()} onHome={goHome}
        addressInput={addressInput}
        onAddressChange={setAddressInput}
        onAddressFocus={() => { editingRef.current = true; }}
        onAddressBlur={() => { editingRef.current = false; }}
        onAddressKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); go(); } }}
        onGo={go}
        onOpenExternal={() => void openShell(url)}
        askOpen={askOpen} onToggleAsk={() => setAskOpen((v) => !v)}
        rightExtras={
          <>
            <BrowserHistoryMenu onOpen={(u) => void open(u)} />
            <Button
              variant="ghost" size="icon"
              onClick={togglePrivateMode}
              className={`h-8 w-8 ${privateMode ? "text-primary" : "text-muted-foreground"}`}
              title={privateMode ? t("browser.privateModeOn") : t("browser.privateModeOff")}
              aria-label={privateMode ? t("browser.privateModeOn") : t("browser.privateModeOff")}
            >
              <VenetianMask className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={() => setAdBlockEnabled(!adBlockEnabled)}
              className={`h-8 w-8 ${adBlockEnabled ? "text-emerald-500" : "text-muted-foreground"}`}
              title={adBlockEnabled ? t("browser.adBlockOn") : t("browser.adBlockOff")}
              aria-label={adBlockEnabled ? t("browser.adBlockOn") : t("browser.adBlockOff")}
            >
              {adBlockEnabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={() => setConfirmClear(true)}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              title={t("browser.clearData")} aria-label={t("browser.clearData")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {error && (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div ref={setContainer} className="relative min-h-0 flex-1 bg-muted/20">
          {!opened && !active?.preview && <BrowserEmptyState onOpen={(u) => void open(u)} />}
          {active?.preview && (
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

function WebBrowserPage() {
  const t = useT();
  const {
    tabs, active, activeKey,
    open, reload, goBack, goForward, goHome,
    newTab, selectTab, closeTab, markLoaded,
  } = useWebBrowser();

  const url = active?.url ?? "";
  const opened = !!active && !active.atHome && !!active.url;
  const loading = !!active?.loading;

  const [addressInput, setAddressInput] = useState(url);
  const editingRef = useRef(false);
  const [askOpen, setAskOpen] = useState(false);

  const adBlockEnabled = useSettingsStore((s) => s.browserAdBlockEnabled);
  const setAdBlockEnabled = useSettingsStore((s) => s.setBrowserAdBlockEnabled);

  useEffect(() => {
    if (!editingRef.current) setAddressInput(url);
  }, [url, active?.key]);

  const go = () => void open(addressInput);

  // Route the iframe through the server-side filtering proxy: the app's JS
  // can't intercept cross-origin iframe traffic, so blocking happens in the
  // Rust server. The session token rides along once on the top-level load; the
  // server sets an HttpOnly cookie so the subresource requests the returned
  // HTML makes stay authenticated. `block=0` lets the user disable blocking.
  const token = getWebToken();
  const proxySrc = opened && active.url && token
    ? `/api/browser/proxy?u=${encodeURIComponent(active.url)}&token=${encodeURIComponent(token)}&block=${adBlockEnabled ? 1 : 0}`
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <BrowserTabStrip tabs={tabs} activeKey={activeKey} onSelect={selectTab} onClose={closeTab} onNew={newTab} />
      <BrowserToolbar
        t={t} opened={opened} loading={loading} url={url}
        onBack={goBack} onForward={goForward} onReload={reload} onHome={goHome}
        addressInput={addressInput}
        onAddressChange={setAddressInput}
        onAddressFocus={() => { editingRef.current = true; }}
        onAddressBlur={() => { editingRef.current = false; }}
        onAddressKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); go(); } }}
        onGo={go}
        onOpenExternal={() => void openShell(url)}
        askOpen={askOpen} onToggleAsk={() => setAskOpen((v) => !v)}
        rightExtras={
          <Button
            variant="ghost" size="icon"
            onClick={() => setAdBlockEnabled(!adBlockEnabled)}
            className={`h-8 w-8 ${adBlockEnabled ? "text-emerald-500" : "text-muted-foreground"}`}
            title={adBlockEnabled ? t("browser.adBlockOn") : t("browser.adBlockOff")}
            aria-label={adBlockEnabled ? t("browser.adBlockOn") : t("browser.adBlockOff")}
          >
            {adBlockEnabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 bg-muted/20">
          {!opened && <BrowserEmptyState onOpen={(u) => void open(u)} />}
          {opened && proxySrc && (
            <iframe
              // `block` is in the key so toggling ad-block reloads the page
              // through the proxy with the new filter state.
              key={`${active.key}:${active.reloadSeq}:${adBlockEnabled ? 1 : 0}`}
              src={proxySrc}
              title={active.title || active.url || ""}
              onLoad={() => markLoaded(active.key)}
              className="absolute inset-0 h-full w-full border-0"
              referrerPolicy="no-referrer"
              sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
            />
          )}
        </div>
        {askOpen && <BrowserAskPane onClose={() => setAskOpen(false)} />}
      </div>
    </div>
  );
}

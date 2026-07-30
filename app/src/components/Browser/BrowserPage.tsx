import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Globe, RotateCw, Trash2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useBrowserPanel } from "./useBrowserPanel";
import { BrowserEmptyState } from "./BrowserEmptyState";

export default function BrowserPage() {
  const t = useT();
  const {
    setContainer, url, title, loading, opened, error,
    open, reload, goBack, goForward, clearData,
  } = useBrowserPanel();

  const [addressInput, setAddressInput] = useState(url);
  const editingRef = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Keep the address bar in sync with in-page navigation (clicking a link
  // inside the embedded site) — but never while the user is actively typing
  // a new address, or their edit would get overwritten mid-keystroke.
  useEffect(() => {
    if (!editingRef.current) setAddressInput(url);
  }, [url]);

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

        {title && opened && (
          <span className="hidden max-w-40 shrink-0 truncate text-xs text-muted-foreground md:inline" title={title}>
            {title}
          </span>
        )}

        <Button
          variant="ghost" size="icon" onClick={() => setConfirmClear(true)} disabled={!opened}
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

      <div ref={setContainer} className="relative min-h-0 flex-1 bg-muted/20">
        {!opened && <BrowserEmptyState onOpen={(u) => void open(u)} />}
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

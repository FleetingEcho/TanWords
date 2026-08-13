import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Globe, Home, RotateCw, VenetianMask } from "lucide-react";
import { useT } from "@/hooks/useT";
import { invoke } from "@/ipc/backend";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { BrowserPanelBlocker, useBrowserPanelBlockStore } from "@/store/browserPanelStore";
import { usePrivateBrowsingStore } from "@/store/privateBrowsingStore";
import { useFloatingBrowserPanel } from "@/hooks/useFloatingBrowserPanel";
import { BrowserTabStrip } from "@/components/Browser/BrowserTabStrip";
import { BrowserEmptyState } from "@/components/Browser/BrowserEmptyState";
import { BrowserHistoryMenu } from "@/components/Browser/BrowserHistoryMenu";
import { FloatingBrowserTitleBar } from "./FloatingBrowserTitleBar";
import { FloatingBrowserResizeHandles, type ResizeEdges } from "./FloatingBrowserResizeHandle";

const MIN_W = 260;
const MIN_H = 480;

/** The floating mobile-browser's "detached" chrome — same bezel content as
 *  the docked `FloatingBrowserWidget`, rendered into its own standalone
 *  window instead (see `floatingBrowserMain.tsx` / `floating-browser.html`).
 *  No pos/size store here — the OS window bounds ARE the widget's bounds.
 *  Dragging the title bar moves the window natively (`app-drag-region`).
 *  Resizing does NOT rely on the frameless window's native edge-resize:
 *  transparent frameless windows don't reliably expose resize cursors/hit
 *  areas on macOS, so this reuses the same 8-way handles the docked widget
 *  uses, wired to `floating_browser_window_set_bounds` (→ `win.setBounds()`)
 *  instead of local CSS state. `useFloatingBrowserPanel`'s existing
 *  ResizeObserver/window-resize listener reacts to the resulting native
 *  resize the same way it reacts to the docked widget's CSS-driven one, so
 *  the page content keeps following the window with no extra wiring. */
export function FloatingBrowserPopoutApp() {
  const {
    setContainer, tabs, active, error,
    open: openUrl, reload, goBack, goForward, goHome,
    newTab, selectTab, closeTab, destroyAll,
  } = useFloatingBrowserPanel({ forceVisible: true });

  const t = useT();
  const privateMode = usePrivateBrowsingStore((s) => s.enabled);
  const togglePrivateMode = usePrivateBrowsingStore((s) => s.toggle);
  const [confirmClose, setConfirmClose] = useState(false);
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{
    startScreenX: number; startScreenY: number;
    orig: { x: number; y: number; width: number; height: number };
    edges: ResizeEdges;
  } | null>(null);

  // Same reasoning as the docked widget: a resize that crosses the native
  // "screen" area loses its DOM pointer events to the loaded page, so the
  // native view is hidden for the duration of any resize drag.
  const blockedForResizeRef = useRef(false);
  const onResizePointerDown = (edges: ResizeEdges, e: React.PointerEvent) => {
    if (!blockedForResizeRef.current) {
      blockedForResizeRef.current = true;
      useBrowserPanelBlockStore.getState().block();
    }
    void invoke<{ x: number; y: number; width: number; height: number }>("window_get_bounds").then((orig) => {
      resizeRef.current = { startScreenX: e.screenX, startScreenY: e.screenY, orig, edges };
    });
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setResizing(true);
    const dx = e.screenX - r.startScreenX;
    const dy = e.screenY - r.startScreenY;
    let width = r.orig.width;
    let height = r.orig.height;
    if (r.edges.right) width = r.orig.width + dx;
    if (r.edges.left) width = r.orig.width - dx;
    if (r.edges.bottom) height = r.orig.height + dy;
    if (r.edges.top) height = r.orig.height - dy;
    width = Math.max(MIN_W, width);
    height = Math.max(MIN_H, height);
    const x = r.edges.left ? r.orig.x + r.orig.width - width : r.orig.x;
    const y = r.edges.top ? r.orig.y + r.orig.height - height : r.orig.y;
    void invoke("floating_browser_window_set_bounds", { x, y, width, height }).catch(() => {});
  };
  const onResizePointerUp = () => {
    resizeRef.current = null;
    setResizing(false);
    if (blockedForResizeRef.current) {
      blockedForResizeRef.current = false;
      useBrowserPanelBlockStore.getState().unblock();
    }
  };

  const opened = !!active && !active.atHome && !!active.panelId;
  const loading = !!active?.loading;
  const url = active?.url ?? "";
  const [addressInput, setAddressInput] = useState(url);
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setAddressInput(url);
  }, [url, active?.key]);

  const go = () => { editingRef.current = false; void openUrl(addressInput); };
  const dock = () => void invoke("floating_browser_dock");
  // Hides this OS window without docking or destroying anything — the tab
  // keeps running exactly as it was. Reopened from the main window's
  // CommandBar icon (see floatingBrowserStore's "detachedHidden" status).
  const minimizePopout = () => void invoke("floating_browser_window_hide");
  const confirmDestroy = () => {
    destroyAll();
    setConfirmClose(false);
    window.close();
  };

  return (
    // h-screen/w-screen (viewport units), not h-full/w-full: this window is
    // transparent, and a percentage chain up through html/body/#root has to
    // resolve against an ancestor with a *definite* height — if that chain
    // ever comes up empty here (unlike the main window, nothing else in this
    // document depends on it, so it was never verified) the container the
    // native view gets measured against would be zero-sized, and the native
    // content would be attached and "correctly" bounded to nothing.
    // Viewport units side-step the whole chain.
    <div className="relative h-screen w-screen">
      <div className={`app-region-no-drag flex h-full w-full flex-col overflow-hidden rounded-[2rem] border-[6px] border-neutral-900 bg-background ${resizing ? "select-none" : ""}`}>
        <FloatingBrowserTitleBar
          dragging={false}
          nativeDrag
          onDock={dock}
          onMinimize={minimizePopout}
          onRequestClose={() => setConfirmClose(true)}
        />

        <BrowserTabStrip tabs={tabs} activeKey={active?.key} onSelect={selectTab} onClose={closeTab} onNew={newTab} />

        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
          <Button variant="ghost" size="icon" onClick={goBack} disabled={!opened}
            className="h-6 w-6 text-muted-foreground" title={t("browser.back")} aria-label={t("browser.back")}>
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={goForward} disabled={!opened}
            className="h-6 w-6 text-muted-foreground" title={t("browser.forward")} aria-label={t("browser.forward")}>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={reload} disabled={!opened}
            className="h-6 w-6 text-muted-foreground" title={t("browser.reload")} aria-label={t("browser.reload")}>
            <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={goHome} disabled={!opened}
            className="h-6 w-6 text-muted-foreground" title={t("browser.home")} aria-label={t("browser.home")}>
            <Home className="h-3.5 w-3.5" />
          </Button>
          <div className="relative min-w-0 flex-1">
            <Globe className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              value={addressInput}
              onChange={(e) => { editingRef.current = true; setAddressInput(e.target.value); }}
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; }}
              onKeyDown={(e) => { if (e.key === "Enter") go(); }}
              placeholder={t("browser.addressPlaceholder")}
              className="app-region-no-drag h-6 w-full rounded-md border border-input bg-background pl-6 pr-2 text-[11px] outline-hidden transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={togglePrivateMode}
            className={`h-6 w-6 ${privateMode ? "text-primary" : "text-muted-foreground"}`}
            title={privateMode ? t("browser.privateModeOn") : t("browser.privateModeOff")}
            aria-label={privateMode ? t("browser.privateModeOn") : t("browser.privateModeOff")}>
            <VenetianMask className="h-3.5 w-3.5" />
          </Button>
          <BrowserHistoryMenu compact onOpen={(u) => void openUrl(u)} />
        </div>

        {error && (
          <div className="shrink-0 truncate border-b border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
            {error}
          </div>
        )}

        <div ref={setContainer} className="relative min-h-0 flex-1 overflow-hidden bg-muted/30">
          {!opened && !active?.preview && (
            <div className="absolute inset-0 overflow-auto">
              <BrowserEmptyState onOpen={(u) => void openUrl(u)} />
            </div>
          )}
        </div>

        <div className="flex h-4 shrink-0 items-center justify-center bg-neutral-900">
          <div className="h-1 w-16 rounded-full bg-neutral-600" />
        </div>
      </div>

      {/* Rendered AFTER the bezel so it paints on top — see the docked
        * widget's identical note for why order matters here. */}
      <FloatingBrowserResizeHandles
        onResizePointerDown={onResizePointerDown}
        onResizePointerMove={onResizePointerMove}
        onResizePointerUp={onResizePointerUp}
      />

      {confirmClose && (
        <>
          <BrowserPanelBlocker />
          <ConfirmModal
            open={confirmClose}
            title={t("floatingBrowser.closeConfirmTitle")}
            message={t("floatingBrowser.closeConfirmMessage")}
            confirmLabel={t("floatingBrowser.close")}
            onConfirm={confirmDestroy}
            onCancel={() => setConfirmClose(false)}
          />
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Globe, Home, RotateCw, VenetianMask } from "lucide-react";
import { useT } from "@/hooks/useT";
import { invoke } from "@/ipc/backend";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { BrowserPanelBlocker, useBrowserPanelBlockStore } from "@/store/browserPanelStore";
import { useFloatingBrowserStore } from "@/store/floatingBrowserStore";
import { useNavStore } from "@/store/navStore";
import { usePrivateBrowsingStore } from "@/store/privateBrowsingStore";
import { useFloatingBrowserPanel } from "@/hooks/useFloatingBrowserPanel";
import { BrowserTabStrip } from "@/components/Browser/BrowserTabStrip";
import { BrowserEmptyState } from "@/components/Browser/BrowserEmptyState";
import { BrowserHistoryMenu } from "@/components/Browser/BrowserHistoryMenu";
import { FloatingBrowserTitleBar } from "./FloatingBrowserTitleBar";
import { FloatingBrowserResizeHandles, type ResizeEdges } from "./FloatingBrowserResizeHandle";

const MIN_W = 260;
const MIN_H = 480;
const DRAG_THRESHOLD = 5;
/** Gap the widget keeps from the viewport edges while dragging/resizing. */
const EDGE_MARGIN = 8;
/** How far past the main window's edge the title bar has to be dragged
 *  before it detaches into its own window — a little slack so brushing the
 *  very edge while repositioning near the border doesn't detach by accident. */
const DETACH_MARGIN = 24;

function clampPos(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  return {
    x: Math.max(EDGE_MARGIN, Math.min(x, vw - Math.min(w, vw - EDGE_MARGIN * 2))),
    y: Math.max(EDGE_MARGIN, Math.min(y, vh - Math.min(h, vh - EDGE_MARGIN * 2))),
  };
}

function clampSize(w: number, h: number, vw: number, vh: number): { width: number; height: number } {
  return {
    width: Math.max(MIN_W, Math.min(w, vw - EDGE_MARGIN * 2)),
    height: Math.max(MIN_H, Math.min(h, vh - EDGE_MARGIN * 2)),
  };
}

/** Applies a resize delta for whichever edges are being dragged. Dragging the
 *  left/top edge keeps the *opposite* edge fixed — the resize grows/shrinks
 *  away from wherever the user grabbed, not from the origin corner — so `x`/
 *  `y` are recomputed from the clamped final size rather than the raw delta,
 *  otherwise hitting the minimum size while still dragging left/up would
 *  make the box jump. */
function resizeFromEdges(
  edges: ResizeEdges,
  orig: { x: number; y: number; width: number; height: number },
  dx: number, dy: number,
  vw: number, vh: number,
): { x: number; y: number; width: number; height: number } {
  let width = orig.width;
  let height = orig.height;
  if (edges.right) width = orig.width + dx;
  if (edges.left) width = orig.width - dx;
  if (edges.bottom) height = orig.height + dy;
  if (edges.top) height = orig.height - dy;
  const size = clampSize(width, height, vw, vh);
  let x = edges.left ? orig.x + orig.width - size.width : orig.x;
  let y = edges.top ? orig.y + orig.height - size.height : orig.y;
  x = Math.max(EDGE_MARGIN, Math.min(x, vw - EDGE_MARGIN - size.width));
  y = Math.max(EDGE_MARGIN, Math.min(y, vh - EDGE_MARGIN - size.height));
  return { x, y, width: size.width, height: size.height };
}

/** Phone-sized floating overlay that can hover over any page (e.g. the
 *  Terminal) without stealing focus from it: the embedded page is a native
 *  `WebContentsView` (see useFloatingBrowserPanel/floating_browser_* IPC),
 *  which composites above all DOM content — including whatever page is
 *  behind this widget — by construction. Only this bezel's own chrome (drag
 *  handle, address bar, tab strip) is DOM, and it has to stay outside the
 *  "screen" placeholder's bounds or the native view would draw over it.
 *
 *  Only mounted (rendered) while status is "open" — minimizing or closing
 *  unmounts it, which is safe: the native tabs live in the main process
 *  regardless, and remounting re-adopts them via floating_browser_get_state
 *  (see useFloatingBrowserPanel). Closing additionally destroys those tabs
 *  first (destroyAll), so a reopen after a confirmed close starts fresh. */
export function FloatingBrowserWidget() {
  const status = useFloatingBrowserStore((s) => s.status);
  const pos = useFloatingBrowserStore((s) => s.pos);
  const size = useFloatingBrowserStore((s) => s.size);
  const setPos = useFloatingBrowserStore((s) => s.setPos);
  const setSize = useFloatingBrowserStore((s) => s.setSize);
  const minimize = useFloatingBrowserStore((s) => s.minimize);
  const close = useFloatingBrowserStore((s) => s.close);
  const privateMode = usePrivateBrowsingStore((s) => s.enabled);
  const togglePrivateMode = usePrivateBrowsingStore((s) => s.toggle);
  // useFloatingBrowserPanel already hides the native "screen" content while
  // DSH is active (see its own doc) — but that leaves this bezel's own DOM
  // chrome (drag handle, address bar, tab strip) still drawn wherever it
  // isn't covered by DSH's native view, showing an empty frame. Unmount the
  // whole widget instead, same as the existing minimize/close paths — safe
  // per this component's own doc: the native tabs live in the main process
  // and get re-adopted via floating_browser_get_state on remount.
  const dshActive = useNavStore((s) => s.page === "dsh");

  const {
    setContainer, tabs, active, error,
    open: openUrl, reload, goBack, goForward, goHome,
    newTab, selectTab, closeTab, destroyAll,
  } = useFloatingBrowserPanel();

  const t = useT();
  const [confirmClose, setConfirmClose] = useState(false);

  // Minimizing needs the native view hidden explicitly — unlike closing
  // (destroyAll already tears the tabs down) or detaching (reparentTo moves
  // the view instead of hiding it), it's the one unmount reason with nothing
  // else that hides anything. Explicit rather than an unmount-effect
  // side-hide: that would fire for the detach unmount too and race
  // reparentTo, possibly detaching the view from the window it was just
  // moved *into* — see useFloatingBrowserPanel's hideOnUnmount doc.
  const handleMinimize = () => {
    void invoke("floating_browser_hide", { withSnapshot: false }).catch(() => {});
    minimize();
  };

  const opened = !!active && !active.atHome && !!active.panelId;
  const loading = !!active?.loading;
  const url = active?.url ?? "";
  const [addressInput, setAddressInput] = useState(url);
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setAddressInput(url);
  }, [url, active?.key]);

  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  // Fetched fresh at the start of every title-bar drag (not cached across
  // opens) — the main window can move/resize between them. Async, but a
  // local IPC round trip lands well before the drag threshold does.
  const mainBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{
    startX: number; startY: number;
    orig: { x: number; y: number; width: number; height: number };
    edges: ResizeEdges;
  } | null>(null);

  // A drag/resize that crosses over the native "screen" area loses its DOM
  // pointer events entirely — WebContentsView is a separate native surface,
  // so the OS routes the mouse to the loaded page instead of this document
  // the instant the cursor is over it, `setPointerCapture` notwithstanding.
  // Without this, a resize starting near that corner (the handle sits right
  // at it) would stop receiving pointermove/pointerup after one frame,
  // leaving `resizeRef` engaged so a later, unrelated click far away (e.g. in
  // the loaded page) gets read as a giant resize delta. Hiding the native
  // view for the duration — same registry ToolsModal uses — keeps the whole
  // drag/resize on native-free ground so events never drop.
  const blockedForDragRef = useRef(false);
  const beginNativeBlock = () => {
    if (blockedForDragRef.current) return;
    blockedForDragRef.current = true;
    useBrowserPanelBlockStore.getState().block();
  };
  const endNativeBlock = () => {
    if (!blockedForDragRef.current) return;
    blockedForDragRef.current = false;
    useBrowserPanelBlockStore.getState().unblock();
  };

  const onTitlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    mainBoundsRef.current = null;
    void invoke<{ x: number; y: number; width: number; height: number }>("window_get_bounds")
      .then((b) => { mainBoundsRef.current = b; })
      .catch(() => {});
    beginNativeBlock();
  };
  /** Drag past the main window's edge detaches the widget into its own
   *  independent OS window instead of continuing the in-app drag — see
   *  floatingBrowserWindow.ts. The popout is created asynchronously in main;
   *  the docked widget disappears immediately regardless (status flips to
   *  "detached" here), since its content no longer belongs in this window
   *  the instant the detach is triggered. */
  const detachAt = (rawX: number, rawY: number) => {
    const mb = mainBoundsRef.current;
    if (!mb) return;
    dragRef.current = null;
    setDragging(false);
    endNativeBlock();
    void invoke("floating_browser_detach", {
      x: mb.x + rawX, y: mb.y + rawY, width: size.width, height: size.height,
    }).catch(() => {});
    useFloatingBrowserStore.getState().detach();
  };
  const onTitlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    setDragging(true);
    const rawX = d.origX + dx;
    const rawY = d.origY + dy;
    const mb = mainBoundsRef.current;
    if (mb) {
      const outside =
        e.screenX < mb.x - DETACH_MARGIN || e.screenX > mb.x + mb.width + DETACH_MARGIN ||
        e.screenY < mb.y - DETACH_MARGIN || e.screenY > mb.y + mb.height + DETACH_MARGIN;
      if (outside) {
        detachAt(rawX, rawY);
        return;
      }
    }
    setPos(clampPos(rawX, rawY, size.width, size.height, window.innerWidth, window.innerHeight), false);
  };
  const onTitlePointerUp = () => {
    dragRef.current = null;
    setDragging(false);
    setPos(useFloatingBrowserStore.getState().pos);
    endNativeBlock();
  };

  const onResizePointerDown = (edges: ResizeEdges, e: React.PointerEvent) => {
    resizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      orig: { x: pos.x, y: pos.y, width: size.width, height: size.height },
      edges,
    };
    beginNativeBlock();
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setResizing(true);
    const next = resizeFromEdges(r.edges, r.orig, e.clientX - r.startX, e.clientY - r.startY, window.innerWidth, window.innerHeight);
    setPos({ x: next.x, y: next.y }, false);
    setSize({ width: next.width, height: next.height }, false);
  };
  const onResizePointerUp = () => {
    resizeRef.current = null;
    setResizing(false);
    const state = useFloatingBrowserStore.getState();
    setPos(state.pos);
    setSize(state.size);
    endNativeBlock();
  };

  if (status !== "open" || dshActive) return null;

  const go = () => { editingRef.current = false; void openUrl(addressInput); };
  const confirmDestroy = () => {
    destroyAll();
    setConfirmClose(false);
    close();
  };

  return (
    <div
      className="fixed z-40"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        transition: dragging || resizing ? "none" : "left 0.15s ease, top 0.15s ease, width 0.15s ease, height 0.15s ease",
      }}
    >
      <div
        className={`app-region-no-drag relative flex h-full w-full flex-col overflow-hidden rounded-[2rem] border-[6px] border-neutral-900 bg-background shadow-2xl ${resizing ? "select-none" : ""}`}
      >
        <FloatingBrowserTitleBar
          dragging={dragging}
          onMinimize={handleMinimize}
          onRequestClose={() => setConfirmClose(true)}
          onTitlePointerDown={onTitlePointerDown}
          onTitlePointerMove={onTitlePointerMove}
          onTitlePointerUp={onTitlePointerUp}
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
              className="h-6 w-full rounded-md border border-input bg-background pl-6 pr-2 text-[11px] outline-hidden transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
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

        {/* The "screen": a native WebContentsView is positioned under this div
          * by useFloatingBrowserPanel when a tab has navigated somewhere. Home
          * (not-yet-navigated) tabs render the same empty state as the
          * full-page Browser's home screen instead, for visual/behavioral
          * consistency — the native view is hidden in that state, so DOM
          * content isn't fighting it for the same pixels. */}
        <div ref={setContainer} className="relative min-h-0 flex-1 overflow-hidden bg-muted/30">
          {!opened && !active?.preview && (
            <div className="absolute inset-0 overflow-auto">
              <BrowserEmptyState onOpen={(u) => void openUrl(u)} />
            </div>
          )}
        </div>

        {/* Bottom safe area: reserves real layout height below the "screen" so
          * the native view's bounds stop short of the border — without this
          * margin the native content draws over (and swallows pointer events
          * meant for) this whole corner, per FloatingBrowserResizeHandles'
          * doc. Purely decorative otherwise; the actual resize hit-areas are
          * the unclipped overlay above. */}
        <div className="flex h-4 shrink-0 items-center justify-center rounded-b-[2rem] bg-neutral-900">
          <div className="h-1 w-16 rounded-full bg-neutral-600" />
        </div>
      </div>

      {/* Unclipped resize hit-areas straddle this box's border — rendered
        * AFTER (so painted on top of) the visual bezel above: plain DOM
        * siblings with no z-index paint in document order, and with the
        * handles first the bezel used to cover most of each handle's hit
        * area wherever they overlapped, leaving only a sliver actually
        * clickable. app-region-no-drag on the visual bezel guarantees the OS
        * never treats any of this as the app's own title bar, no matter what
        * it happens to be sitting on top of (the CommandBar's
        * app-drag-region, for one). */}
      <FloatingBrowserResizeHandles
        onResizePointerDown={onResizePointerDown}
        onResizePointerMove={onResizePointerMove}
        onResizePointerUp={onResizePointerUp}
      />

      {confirmClose && (
        <>
          {/* The native panel can't lose a z-index fight against this dialog
            * — hide it while the dialog is up, same as ToolsModal does. */}
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

import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Copy, Droplets, ExternalLink, Loader2, RefreshCw, RotateCcw, TerminalSquare } from "lucide-react";
import { invoke } from "@/ipc/backend";
import { subscribeAll } from "@/ipc/events";
import { openExternal } from "@/ipc/shell";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { useDshPanelBlockStore } from "@/store/dshPanelBlockStore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";

/** Status of the supervised `dsh --profile web` host, mirrored from the
 *  `dsh:status` events the main-process supervisor emits (see
 *  dshSupervisor.ts). */
type DshStatus = "starting" | "ready" | "failed";

/** Why the host failed — drives different renderer guidance.
 *  - `notInstalled`: `dsh` not on PATH → install/upgrade guidance panel.
 *  - `portInUse`: chosen port already bound → port-fix modal (Retry + port input).
 *  - `systemError`: host crashed for an OS reason a port change can't fix
 *    (EMFILE/inotify exhaustion, OOM, EACCES, died-after-ready) → inline panel
 *    showing the real error + Retry. Never the port-fix modal.
 *  - `other`: unclassified → port-fix modal (preserves prior behavior). */
type DshFailKind = "notInstalled" | "portInUse" | "systemError" | "other";

interface DshStatusEvent {
  status: DshStatus;
  url?: string;
  reason?: string;
  kind?: DshFailKind;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** NOTE ON COORDINATES: `WebContentsView.setBounds` takes DIPs relative to the
 *  host window's *content area*, which is exactly what this document's viewport
 *  is — so `getBoundingClientRect()` values go through unmodified, with no
 *  vertical offset (same property the browser panel relies on — see
 *  useBrowserPanel.ts). Do not add a y-offset here. */

/** The DeepSeek Harness page. The DSH Web UI is served by a supervised
 *  `dsh --profile web` host in the Electron main process and embedded as a
 *  native `WebContentsView` positioned under this placeholder — the same
 *  pattern the Browser page uses, but with a single persistent view rather
 *  than a tab strip.
 *
 *  Like the Terminal page, the host is *retained*: once the user has visited,
 *  this component stays mounted (hidden) across ordinary navigation so DSH's
 *  in-memory session state survives, and `visible` toggles the native view.
 *
 *  When the host fails to start (port in use, `dsh` not installed, …) a modal
 *  opens with the error and a port input, so the user can fix the port inline
 *  and restart without leaving the page. */
export function DshPage({ visible }: { visible: boolean }) {
  const t = useT();
  // The configured DSH host port (0 = standard/reusable 3080). Read from the settings store so a
  // change in Settings is picked up on the next `dsh_show`; a running host
  // keeps its old port until the Restart button re-applies it.
  const dshPort = useSettingsStore((s) => s.dshPort);
  const setDshPort = useSettingsStore((s) => s.setDshPort);
  const dshBackgroundOpacity = useSettingsStore((s) => s.dshBackgroundOpacity);
  const setDshBackgroundOpacity = useSettingsStore((s) => s.setDshBackgroundOpacity);
  const dshBackgroundBlur = useSettingsStore((s) => s.dshBackgroundBlur);
  const setDshBackgroundBlur = useSettingsStore((s) => s.setDshBackgroundBlur);
  // Toolbar-local: lets the appearance row be toggled open per-visit without
  // persisting anything — mirrors TerminalTool's glass/transparency controls.
  const [appearanceControlsOpen, setAppearanceControlsOpen] = useState(false);
  // Whether the DSH page shows its own toolbar (DSH label, Restart, Reload,
  // Open-external). Hidden by default so the embedded agent UI gets the full
  // height; the user can re-enable it in Settings. Read live so a Settings
  // change reflects immediately without a page reload.
  const dshToolbarVisible = useSettingsStore((s) => s.dshToolbarVisible);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  containerRef.current = container;

  // The host takes a few seconds to come up on first launch; reflect that in
  // the UI instead of leaving an empty rectangle where the view will appear.
  const [status, setStatus] = useState<DshStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  // Failure category: `notInstalled` → install/upgrade guidance panel;
  // `other` → port-fix modal. Reset on any non-failed transition.
  const [failKind, setFailKind] = useState<DshFailKind>("other");
  const urlRef = useRef<string | null>(null);

  // The failed-to-start modal. Auto-opens when the host fails so the user can
  // read the error and fix the port without leaving the page. Dismissable; a
  // small "Configure" button reopens it.
  const [failedModalOpen, setFailedModalOpen] = useState(false);

  // True while the native view's renderer is reloading after crashing on its
  // own (the `dsh` host — and any task it's mid-way through — is unaffected;
  // only the display needs to reconnect). See dshPanel.ts's
  // `render-process-gone` handler.
  const [viewReconnecting, setViewReconnecting] = useState(false);

  // Any app-wide Dialog opening over this page increments this; the native DSH
  // view is composited above all HTML, so it has to step aside for the modal.
  const blocked = useDshPanelBlockStore((s) => s.blockers > 0);

  // Queued work outlives this hook: `show` waits two animation frames before
  // measuring, and those frames keep firing after visibility toggles. Without
  // this flag a show in flight when the page is hidden would land *after* the
  // hide and re-attach the view over the next page.
  const unmountedRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueue = (fn: () => Promise<void>) => {
    const next = queueRef.current.then(fn, fn);
    queueRef.current = next;
    return next;
  };

  const currentBounds = () => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };

  /** Classify a failed-start error string and route the failure UI. The
   *  supervisor is authoritative: its `dsh:status` events carry a `kind`
   *  (portInUse / systemError / notInstalled / other) classified from the real
   *  error text. A `dsh_show`/`dsh_restart` *rejection* carries no `kind` (it's
   *  just the error string), so when no kind is supplied we sniff the message
   *  for the `notInstalled` fingerprint as a fallback. Only `portInUse` and
   *  unclassified `other` open the port-fix modal — `notInstalled` shows its
   *  guidance panel and `systemError` shows an inline error + Retry, so an
   *  EMFILE/inotify exhaustion or "host stopped" never misleads the user with a
   *  "change the port" modal. */
  const failFromError = (message: string, kind?: DshFailKind) => {
    const resolved: DshFailKind = kind ?? (
      /not found on PATH|was not found/i.test(message) ? "notInstalled" : "other"
    );
    setFailKind(resolved);
    setError(message);
    setStatus("failed");
    // Only a genuine port problem (or an unclassified failure we can't place)
    // opens the port-fix modal. notInstalled → inline guidance; systemError →
    // inline error + Retry. Both keep the page usable and never freeze.
    setFailedModalOpen(resolved === "portInUse" || resolved === "other");
  };

  /** Show (and on first use start) the DSH host, positioning the native view
   *  under the placeholder. Settles for two frames before measuring, then
   *  re-measures and corrects once more after the call completes — the same
   *  cheap double-measure that makes the browser panel's initial placement
   *  reliable. */
  const show = () =>
    enqueue(async () => {
      await nextFrame();
      await nextFrame();
      if (unmountedRef.current) return;
      const rect = await currentBounds();
      if (!rect) return;
      try {
        const url = await invoke<string>("dsh_show", {
          ...rect,
          port: dshPort,
          backgroundOpacity: dshBackgroundOpacity,
        });
        urlRef.current = url;
        setStatus("ready");
        setError(null);
      } catch (e) {
        failFromError(String(e));
        return;
      }
      await nextFrame();
      const settled = await currentBounds();
      if (settled) await invoke("dsh_set_bounds", settled).catch(() => {});
    });

  // Mount: mark ourselves live. Unmount (only on real teardown, since the
  // retained-host pattern keeps this mounted across navigation): hide the view.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      invoke("dsh_hide").catch(() => {});
    };
  }, []);

  // Visibility + blocker drive the native view: show when this page is active
  // AND nothing is blocking it (a modal), hide otherwise so the view never
  // renders over the next page or over a dialog. Like the browser panel, a
  // re-show after a blocker clears is just `setHidden(false)` natively, so the
  // page keeps its scroll position and in-page state. A failed host is the one
  // exception: dismissing its modal clears the blocker, but must not immediately
  // call `dsh_show` again and reopen the same modal in an unclosable loop. Retry
  // and Apply & Restart invoke the start path explicitly.
  //
  // `status` MUST be a dependency. A host that prints its ready line and then
  // crashes (e.g. EMFILE exhausting inotify watchers) leaves `dsh_show`
  // already-resolved with a native view attached to the now-dead host. When
  // the `dsh:status` subscriber flips `status` to "failed", this effect must
  // re-run so the `else` branch hides that dead view — otherwise it stays
  // composited above the failure modal and swallows clicks, freezing the UI.
  useEffect(() => {
    if (visible && !blocked && status !== "failed") {
      void show();
    } else {
      invoke("dsh_hide").catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, blocked, status]);

  // This is a visual-only preference: apply it immediately to the retained
  // native view without restarting DSH or losing the open conversation.
  useEffect(() => {
    invoke("dsh_set_background_opacity", {
      opacity: dshBackgroundOpacity,
    }).catch(() => {});
  }, [dshBackgroundOpacity]);

  // Keep the native view sized to the placeholder as the window resizes.
  useEffect(() => {
    if (!container) return;
    const reposition = () => {
      const rect = currentBounds();
      if (rect) invoke("dsh_set_bounds", rect).catch(() => {});
    };
    const observer = new ResizeObserver(() => reposition());
    observer.observe(container);
    window.addEventListener("resize", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  // The supervisor emits `dsh:status` as it starts, becomes ready, or fails
  // (e.g. the host dies after it was ready). Mirror it into the UI so the
  // "starting / failed" state stays accurate even when the change didn't
  // originate from this page's own `dsh_show` call. "not installed" shows the
  // inline guidance panel (no modal — there's nothing to configure yet);
  // any other failure opens the port-fix modal so the user can fix the port.
  useEffect(() => {
    return subscribeAll({
      "dsh:status": (e: DshStatusEvent) => {
        setStatus(e.status);
        if (e.status === "ready" && e.url) urlRef.current = e.url;
        if (e.reason) setError(e.reason);
        else if (e.status !== "failed") setError(null);
        if (e.status === "failed") {
          const kind = e.kind ?? "other";
          // `failFromError` is authoritative here: it sets failKind, status,
          // error, and the modal-open flag consistently with the rejection
          // path. Only portInUse/other open the modal; notInstalled and
          // systemError stay inline so an EMFILE/"host stopped" never shows
          // a misleading port-fix modal.
          failFromError(e.reason ?? "", kind);
        }
      },
      // The native view's renderer can die on its own (OOM, GPU fault) without
      // the `dsh` host process going down — the main process reloads the view
      // against the same host and fires this so the UI explains the blank
      // flash instead of looking broken. `dsh://loading` (already emitted
      // around every navigation) clears it once the reload lands.
      "dsh://crashed": () => setViewReconnecting(true),
      "dsh://loading": (loading: boolean) => { if (!loading) setViewReconnecting(false); },
    });
  }, []);

  const retry = () => {
    setStatus("starting");
    setError(null);
    setFailedModalOpen(false);
    void show();
  };

  const reload = () => {
    void invoke("dsh_reload", urlRef.current ? { url: urlRef.current } : {}).catch(() => {});
  };

  /** Stop and respawn the DSH host, applying the configured port. Use this to
   *  make a Settings port change take effect on a running host — `dsh_show`
   *  alone keeps a live host on its old port. The view navigates to the new
   *  host's URL once it is ready. */
  const restart = () =>
    void enqueue(async () => {
      setStatus("starting");
      setError(null);
      setFailedModalOpen(false);
      try {
        await invoke("dsh_restart", { port: dshPort });
        // start() is now running on the new port; re-attach the view, which
        // navigates the existing WebContentsView to the new URL.
        await nextFrame();
        if (unmountedRef.current) return;
        const rect = await currentBounds();
        if (!rect) return;
        const url = await invoke<string>("dsh_show", {
          ...rect,
          port: dshPort,
          backgroundOpacity: dshBackgroundOpacity,
        });
        urlRef.current = url;
        setStatus("ready");
      } catch (e) {
        failFromError(String(e));
      }
    });

  const starting = status === "starting";
  const failed = status === "failed";
  // The starting spinner is an inline overlay (no modal needed). The failed
  // state is a modal; while it's dismissed, the complete error stays inline
  // with Retry and Configure actions so the page remains useful.
  const showStartingOverlay = starting && !failedModalOpen;

  return (
    <div
      aria-hidden={!visible}
      className={visible ? "flex h-full flex-col" : "hidden"}
    >
      {dshToolbarVisible && (
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <TerminalSquare className="h-4 w-4 text-muted-foreground" />
          {t("nav.dsh")}
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          {urlRef.current ?? ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={restart}
            disabled={starting}
            className="h-8 w-8 text-muted-foreground"
            title={t("dsh.restart")}
            aria-label={t("dsh.restart")}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={reload}
            disabled={status !== "ready"}
            className="h-8 w-8 text-muted-foreground"
            title={t("dsh.reload")}
            aria-label={t("dsh.reload")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {urlRef.current && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void openExternal(urlRef.current!)}
              className="h-8 w-8 text-muted-foreground"
              title={t("dsh.openExternal")}
              aria-label={t("dsh.openExternal")}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAppearanceControlsOpen((open) => !open)}
            title={t("dsh.appearance")}
            aria-label={t("dsh.appearance")}
            aria-pressed={appearanceControlsOpen}
            className={`h-8 w-8 ${
              appearanceControlsOpen
                ? "bg-primary/15 text-primary"
                : dshBackgroundOpacity < 100
                  ? "text-primary"
                  : "text-muted-foreground"
            }`}
          >
            <Droplets className="h-4 w-4" />
          </Button>
        </div>
      </div>
      )}

      {/* Kept on its own row (like Terminal's appearance controls) so it
       *  doesn't compete with the toolbar's other actions for space. Live —
       *  dragging updates the native view immediately via DshPage's opacity
       *  effect and the CSS blur overlay below, so you can see the result
       *  instead of tuning blind from the Settings page. */}
      {dshToolbarVisible && appearanceControlsOpen && (
        <div
          role="group"
          aria-label={t("dsh.appearance")}
          className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-border/70 px-4 py-2"
        >
          <label className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{t("dsh.blurLabel")}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={dshBackgroundBlur}
              onChange={(e) => setDshBackgroundBlur(Number(e.currentTarget.value))}
              aria-label={t("dsh.blurLabel")}
              className="h-6 w-24 cursor-pointer accent-primary"
            />
            <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
              {dshBackgroundBlur}%
            </span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{t("dsh.opacityLabel")}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={dshBackgroundOpacity}
              onChange={(e) => setDshBackgroundOpacity(Number(e.currentTarget.value))}
              aria-label={t("dsh.opacityLabel")}
              className="h-6 w-24 cursor-pointer accent-primary"
            />
            <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
              {dshBackgroundOpacity}%
            </span>
          </label>
        </div>
      )}

      <div ref={setContainer} className="relative min-h-0 flex-1">
        {dshBackgroundOpacity < 100 && dshBackgroundBlur > 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backdropFilter: `blur(${dshBackgroundBlur * 0.4}px)`,
              WebkitBackdropFilter: `blur(${dshBackgroundBlur * 0.4}px)`,
            }}
          />
        )}
        {showStartingOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 p-6 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium">{t("dsh.starting")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("dsh.startingHint")}</p>
            </div>
          </div>
        )}
        {status === "ready" && viewReconnecting && (
          <div className="absolute inset-x-0 top-2 z-10 flex justify-center">
            <div className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              {t("dsh.viewReconnecting")}
            </div>
          </div>
        )}
        {failed && failKind === "notInstalled" && (
          <DshNotInstalledGuide onRetry={retry} />
        )}
        {failed && failKind === "systemError" && (
          // A system-level failure (EMFILE/inotify exhaustion, OOM, EACCES, or
          // a host that came up then died) that changing the port cannot fix.
          // Show the real error verbatim so the user knows what is wrong, with
          // a Retry button. No "Configure" button and no port-fix modal —
          // those would mislead the user into "fixing" a port that isn't the
          // problem. Inline (not a modal) so it is always closeable/dismissable
          // by simply navigating away; never freezes.
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 p-6 text-center"
          >
            <div className="w-full max-w-xl space-y-4 rounded-xl border border-border bg-background/95 p-5 shadow-sm">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-destructive">{t("dsh.failed")}</p>
                {error && (
                  <p className="break-words whitespace-pre-wrap text-left text-xs leading-relaxed text-muted-foreground">
                    {error}
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                  {t("dsh.systemErrorHint")}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={retry}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  {t("dsh.retry")}
                </Button>
              </div>
            </div>
          </div>
        )}
        {failed && failKind === "other" && !failedModalOpen && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 p-6 text-center"
          >
            <div className="w-full max-w-xl space-y-4 rounded-xl border border-border bg-background/95 p-5 shadow-sm">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-destructive">{t("dsh.failed")}</p>
                {error && (
                  <p className="break-words text-xs leading-relaxed text-muted-foreground">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={retry}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  {t("dsh.retry")}
                </Button>
                <Button size="sm" onClick={() => setFailedModalOpen(true)}>
                  <TerminalSquare className="mr-1.5 h-3.5 w-3.5" />
                  {t("dsh.configure")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <DshFailedModal
        open={failedModalOpen}
        error={error}
        currentPort={dshPort}
        onApplyPort={(port) => {
          setDshPort(port);
          // restart() reads dshPort from the store, but the store update is
          // async — pass the new port explicitly so the restart uses it
          // immediately rather than the stale value.
          void restartWithPort(port);
        }}
        onRetry={retry}
        onDismiss={() => setFailedModalOpen(false)}
      />
    </div>
  );

  /** Restart with an explicit port (used by the modal's apply button, which
   *  has the new port before the store has flushed it). */
  function restartWithPort(port: number) {
    void enqueue(async () => {
      setStatus("starting");
      setError(null);
      setFailedModalOpen(false);
      try {
        await invoke("dsh_restart", { port });
        await nextFrame();
        if (unmountedRef.current) return;
        const rect = await currentBounds();
        if (!rect) return;
        const url = await invoke<string>("dsh_show", {
          ...rect,
          port,
          backgroundOpacity: dshBackgroundOpacity,
        });
        urlRef.current = url;
        setStatus("ready");
      } catch (e) {
        failFromError(String(e));
      }
    });
  }
}

/** The modal shown when the DSH host fails to start. Shows the error, a port
 *  input (so the user can fix a bad/in-use port inline), and Retry / Apply &
 *  Restart actions. Built on the shared `Dialog`, which mounts
 *  `DshPanelBlocker` so the native DSH view steps aside for the modal. */
function DshFailedModal({
  open, error, currentPort, onApplyPort, onRetry, onDismiss,
}: {
  open: boolean;
  error: string | null;
  currentPort: number;
  onApplyPort: (port: number) => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  // Local draft of the port. Pre-fill with the current setting; 0 renders as
  // empty so the "Auto" placeholder shows (mirrors DshPortSetting in Settings).
  const [draft, setDraft] = useState(currentPort === 0 ? "" : String(currentPort));
  useEffect(() => {
    setDraft(currentPort === 0 ? "" : String(currentPort));
  }, [currentPort]);

  const apply = () => {
    const n = Number(draft);
    onApplyPort(Number.isFinite(n) && n > 0 ? Math.min(65535, Math.floor(n)) : 0);
  };

  return (
    <Dialog open={open} onClose={onDismiss} maxWidth="max-w-md">
      <div className="p-5 space-y-4">
        <DialogTitle className="text-sm font-semibold text-destructive">
          {t("dsh.failed")}
        </DialogTitle>
        {error && (
          <p className="text-xs text-muted-foreground leading-relaxed break-words">
            {error}
          </p>
        )}
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="dsh-port-input">
            {t("settings.dshPort")}
          </label>
          <input
            id="dsh-port-input"
            type="number"
            min={0}
            max={65535}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            placeholder={t("settings.dshPortAuto")}
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
          <p className="text-xs text-muted-foreground">{t("dsh.portHint")}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
        <Button
          variant="ghost"
          onClick={onDismiss}
          className="h-8 px-4 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          {t("dsh.dismiss")}
        </Button>
        <Button
          variant="ghost"
          onClick={onRetry}
          className="h-8 px-4 rounded-lg text-xs font-semibold bg-muted text-foreground hover:bg-muted/80 transition-colors"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t("dsh.retry")}
        </Button>
        <Button
          variant="ghost"
          onClick={apply}
          className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t("dsh.applyAndRestart")}
        </Button>
      </div>
    </Dialog>
  );
}

const DSH_GITHUB_URL = "https://github.com/deepseek-ai/deepseek-harness";
const DSH_INSTALL_CMD = "npm i -g @deepseek-ai/dsh";
const DSH_UPGRADE_CMD = "npm update -g @deepseek-ai/dsh";
const DSH_VERIFY_CMD = "dsh --version";

/** A small clipboard-copy button with transient "Copied" feedback. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // clipboard may be unavailable (no user gesture / insecure context) —
          // the command is still visible to type by hand.
        }
      }}
      className="absolute right-1.5 top-1.5 flex h-6 items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title={label}
      aria-label={label}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? t("dsh.notInstalledCopied") : label}</span>
    </button>
  );
}

/** A single labeled command block with a copy button. */
function CommandBlock({ text, copyLabel }: { text: string; copyLabel: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 pr-16 font-mono text-xs leading-relaxed text-foreground">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label={copyLabel} />
    </div>
  );
}

/** Inline guidance shown when the supervised `dsh` host can't start because the
 *  `dsh` CLI isn't installed. This is a setup guide, not an error: the user
 *  hasn't installed DSH yet, so we point them at the official source and the
 *  install/upgrade commands, then offer a retry once they've installed it.
 *  Rendered in place of (not as a modal over) the DSH view, so it doesn't need
 *  the DshPanelBlocker — no native view is attached when `dsh` is missing. */
function DshNotInstalledGuide({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const copyLabel = t("dsh.notInstalledCopy");
  return (
    <div className="absolute inset-0 overflow-y-auto bg-background p-6">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <BookOpen className="h-4.5 w-4.5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">{t("dsh.notInstalledTitle")}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("dsh.notInstalledLead")}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dsh.notInstalledPrereq")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("dsh.notInstalledPrereqText")}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dsh.notInstalledSteps")}
          </h3>
          <ol className="space-y-3">
            <li className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("dsh.notInstalledStep1")}</p>
              <CommandBlock text={DSH_INSTALL_CMD} copyLabel={copyLabel} />
            </li>
            <li className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("dsh.notInstalledStep2")}</p>
              <CommandBlock text={DSH_VERIFY_CMD} copyLabel={copyLabel} />
            </li>
            <li className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("dsh.notInstalledStep3")}</p>
            </li>
          </ol>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dsh.notInstalledUpgrade")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("dsh.notInstalledUpgradeText")}</p>
          <CommandBlock text={DSH_UPGRADE_CMD} copyLabel={copyLabel} />
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dsh.notInstalledOfficial")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("dsh.notInstalledOfficialText")}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openExternal(DSH_GITHUB_URL)}
              className="h-8"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              {t("dsh.notInstalledOpenGitHub")}
            </Button>
            <Button size="sm" onClick={onRetry} className="h-8">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("dsh.notInstalledRetry")}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            {t("dsh.notInstalledPathHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

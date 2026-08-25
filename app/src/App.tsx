import React, { useEffect } from "react";
import { Toaster, toast } from "sonner";
import { MainLayout } from "@/components/Layout/Sidebar";
import { AppBackground } from "@/components/Layout/AppBackground";
import { AuthGate } from "@/components/Layout/AuthGate";
import { useSettingsStore } from "@/store/settingsStore";
import { useUpdaterStore } from "@/store/updaterStore";
import { useNavStore } from "@/store/navStore";
import { useWordModalStore } from "@/store/wordModalStore";
import { useToolsBallStore } from "@/store/toolsBallStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { usePageHostUiStore } from "@/store/pageHostUiStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { PageHost } from "@/pages/PageHost";
import { StartupReadySignal } from "@/pages/StartupReadySignal";
import { WorkspaceScreen } from "@/components/Workspaces/WorkspaceScreen";
import { DragLayer } from "@/components/Workspaces/DragLayer";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useMcpSync } from "@/hooks/useMcpSync";
import { useTraySync } from "@/hooks/useTraySync";
import { useAutoLock } from "@/hooks/useAutoLock";
import { initProviders } from "@/lib/initProviders";
import { invoke } from "@/ipc/backend";
import { ENRICHED_SEED_WORDS, BASIC_SEED_WORDS } from "@/data/seedWords";
import { LOCAL_DOCS_ROOT_KEY, localDocsRootExists } from "@/lib/localDocs";
import { isDesktopHost, isWebHost, hostCapabilities } from "@/platform";
import * as auth from "@/platform/auth";
import { resolveShellActiveNav } from "@/components/Layout/shellNavigation";
import { findPane } from "@/workspaces/normalization";
import { isWorkspacesEnabled } from "@/pages/workspaceFeature";
import { resolveStartupDestination } from "@/lib/startupDestination";

/** Every page is code-split and reached through the central page catalog +
 *  `PageHost`. Only the landing page's chunk is needed to paint; the rest —
 *  the editor stack behind Documents, the chat providers, the charts on
 *  Dashboard — stay out of the startup parse. They load on first navigation
 *  through their catalog entry's `load`; there is no idle prefetch, so unused
 *  routes do not keep their parser/runtime costs resident.
 *
 *  The overlays below are still mounted by the shell directly because they are
 *  application-global (modals, the floating browser, the podcast bar) rather
 *  than page destinations. */
import { LockScreen } from "@/components/Layout/LockScreen";
import { useAppLockStore } from "@/store/appLockStore";
import { useServerCapabilitiesStore, useVoiceAssistantAvailable } from "@/store/serverCapabilitiesStore";

const WordDetailModal = React.lazy(() =>
  import("@/components/WordDetailModal").then((m) => ({ default: m.WordDetailModal })));
const ToolsModal = React.lazy(() =>
  import("@/components/ui/ToolsModal").then((m) => ({ default: m.ToolsModal })));
const FloatingBrowserWidget = React.lazy(() =>
  import("@/components/FloatingBrowser/FloatingBrowserWidget").then((m) => ({ default: m.FloatingBrowserWidget })));
const PodcastPlayerBar = React.lazy(() =>
  import("@/components/ui/PodcastPlayerBar").then((m) => ({ default: m.PodcastPlayerBar })));
const SelectionAsk = React.lazy(() =>
  import("@/components/shared/SelectionAsk").then((m) => ({ default: m.SelectionAsk })));
const VoiceOverlay = React.lazy(() =>
  import("@/components/VoiceAssistant/VoiceOverlay").then((m) => ({ default: m.VoiceOverlay })));
const SettingsModal = React.lazy(() =>
  import("@/components/Settings/SettingsModal").then((m) => ({ default: m.SettingsModal })));

// Web notifications belong above mobile browser chrome and the floating dock;
// the desktop shell keeps its established lower-right placement.
const APP_TOAST_POSITION = isWebHost ? "top-center" : "bottom-right";

function AppToaster() {
  return <Toaster position={APP_TOAST_POSITION} richColors closeButton />;
}

type AuthState = "checking" | "ready" | "login";

function App() {
  const loadFromDB = useSettingsStore((s) => s.loadFromDB);
  const settingsLoaded = useSettingsStore((s) => s.isLoaded);
  const startupDestination = useSettingsStore((s) => s.startupDestination);
  const db = useDB();
  const t = useT();
  const { currentPage, navigate } = useNavStore();
  const wordModalWord = useWordModalStore((s) => s.word);
  const toolsModalOpen = useToolsBallStore((s) => s.isOpen);
  const podcastVisible = usePodcastPlayerStore((s) => s.status !== "idle" && !!s.track);
  const voiceAssistantAvailable = useVoiceAssistantAvailable();
  // Workspace shell hooks. These must run on every render (not after the
  // auth/lock early returns below) — calling hooks only on the authenticated
  // path changes the hook count between renders and trips React's
  // rules-of-hooks check ("Rendered more hooks than during the previous
  // render"). `activeWorkspaceId` decides whether the workspace screen or the
  // full-page host is visible; the host itself stays mounted so retained
  // Terminal and DSH sessions keep running. `terminalMaximized` drives
  // immersive mode.
  const activeWorkspaceId = useNavStore((s) => s.activeWorkspaceId);
  const workspaceTerminalFocused = useWorkspaceStore((s) => {
    if (!s.activeWorkspaceId || !s.focusedPaneId) return false;
    const workspace = s.workspaces.find((candidate) => candidate.id === s.activeWorkspaceId);
    const pane = workspace ? findPane(workspace.root, s.focusedPaneId) : null;
    return pane?.kind === "pane" && pane.content?.pageId === "terminal";
  });
  const settingsOpen = useNavStore((s) => s.settingsOpen);
  const terminalMaximized = usePageHostUiStore((s) => s.terminalMaximized);
  const workspacesLoaded = useWorkspaceStore((s) => s.loaded);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [authState, setAuthState] = React.useState<AuthState>(isWebHost ? "checking" : "ready");
  const [wordCount, setWordCount] = React.useState(0);
  const [selectionToolsReady, setSelectionToolsReady] = React.useState(false);
  const [startupDestinationApplied, setStartupDestinationApplied] = React.useState(false);
  const startupDestinationAppliedRef = React.useRef(false);

  // Selection/Ask pulls in gesture handling, AI actions and its answer panel,
  // but renders nothing until the user selects text. Keep it out of the first
  // parse/commit and load it during the first idle slice, normally while the
  // splash is still covering startup. It has no layout box, so mounting later
  // cannot move the visible page.
  useEffect(() => {
    const idle = window.requestIdleCallback?.(() => setSelectionToolsReady(true), { timeout: 1500 })
      ?? window.setTimeout(() => setSelectionToolsReady(true), 750);
    return () => {
      if (window.cancelIdleCallback && typeof idle !== "number") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle as number);
    };
  }, []);

  if (hostCapabilities.mcp) useMcpSync();
  if (hostCapabilities.tray) useTraySync();
  useAutoLock();

  // Session gate for the web host. api/client-style auth events land here
  // regardless of which component started the transition.
  React.useEffect(() => {
    if (!isWebHost) return;
    let cancelled = false;
    const loadSession = () => void auth.bootstrap().then((session) => {
      if (cancelled) return;
      useAppLockStore.setState({
        enabled: session?.appLockEnabled ?? false,
        // A configured lock must cover the very first private paint. This is
        // the same gate refresh() previously raised in a second request.
        locked: session?.appLockEnabled ?? false,
      });
      useServerCapabilitiesStore.getState().setVoiceAssistant(session?.voiceAssistant ?? false);
      setAuthState(session ? "ready" : "login");
    });
    loadSession();
    const onUnauthorized = () => {
      useAppLockStore.setState({ enabled: false, locked: false });
      setAuthState("login");
    };
    const onAuthorized = () => {
      // Keep the gate closed until bootstrap returns this account's own lock
      // status; otherwise a configured account briefly flashes open.
      useAppLockStore.setState({ enabled: null, locked: false });
      loadSession();
    };
    window.addEventListener("tanwords:unauthorized", onUnauthorized);
    window.addEventListener("tanwords:authorized", onAuthorized);
    return () => {
      cancelled = true;
      window.removeEventListener("tanwords:unauthorized", onUnauthorized);
      window.removeEventListener("tanwords:authorized", onAuthorized);
    };
  }, []);

  // Initialize providers from keychain (with localStorage fallback/migration) on startup.
  // Deferred past first paint so the OS keychain prompt (macOS asks the first
  // time an unauthorized app reads/writes an entry) doesn't fire before the
  // user has even seen the app window.
  useEffect(() => {
    if (authState !== "ready") return;
    const idle = window.requestIdleCallback?.(() => initProviders())
      ?? window.setTimeout(() => initProviders(), 500);
    loadFromDB();
    return () => {
      if (window.cancelIdleCallback && typeof idle !== "number") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle as number);
    };
  }, [authState, loadFromDB]);

  // Load the durable workspace collection and reconcile it with the
  // synchronous cache, so custom workspaces survive restart. Runs once the
  // session is ready, alongside the settings load. Harmless when the feature
  // flag is off (the collection may be empty); the sidebar only renders the
  // workspace section when the flag is on.
  useEffect(() => {
    if (!isDesktopHost || authState !== "ready") return;
    void useWorkspaceStore.getState().init();
  }, [authState]);

  // Resolve the requested first screen only after both asynchronous preference
  // and workspace hydration have settled. Until then the splash remains above
  // an uncommitted shell, so Dashboard cannot flash before the chosen target.
  useEffect(() => {
    if (startupDestinationAppliedRef.current) return;
    if (authState !== "ready" || !settingsLoaded) return;
    if (isDesktopHost && !workspacesLoaded) return;

    const destination = resolveStartupDestination(
      startupDestination,
      new Set(workspaces.map((workspace) => workspace.id)),
      hostCapabilities,
      isWorkspacesEnabled(),
    );
    startupDestinationAppliedRef.current = true;
    if (destination.kind === "workspace") {
      useWorkspaceStore.getState().selectWorkspace(destination.workspaceId);
      useNavStore.getState().openWorkspace(destination.workspaceId);
    } else {
      useWorkspaceStore.getState().selectWorkspace(null);
      useNavStore.getState().navigate(destination.page);
    }
    setStartupDestinationApplied(true);
  }, [authState, settingsLoaded, startupDestination, workspacesLoaded, workspaces]);

  // The local Documents folder is a device path, while settings may live in a
  // database shared by Linux, macOS, and other machines. Silently discard a
  // binding that is invalid on this device before the Documents view can try
  // to scan or reopen files from it.
  useEffect(() => {
    if (!isDesktopHost || authState !== "ready") return;
    void (async () => {
      try {
        const root = await db.getSetting(LOCAL_DOCS_ROOT_KEY);
        if (!root || await localDocsRootExists(root)) return;
        await db.setSetting(LOCAL_DOCS_ROOT_KEY, "");
        localStorage.removeItem("tanwords_doc_last_local_path");
      } catch {
        // Startup validation is best-effort; it must never block app launch.
      }
    })();
  }, [authState]);

  // If a previously-saved custom DB path failed to open this launch (drive
  // unplugged, file moved), the backend silently fell back to the default
  // DB rather than deleting anything — surface that instead of leaving the
  // user staring at a mysteriously empty vocabulary.
  useEffect(() => {
    if (authState !== "ready") return;
    invoke<string | null>("db_get_startup_warning")
      .then((path) => {
        if (path) toast.warning(t("settings.dbFallbackWarning", { path }), { duration: 15000 });
      })
      .catch(() => {});
  }, [authState, t]);

  // A saved Postgres profile can open successfully but read-only — the primary
  // was unreachable and the app fell back to serving the local replica as-is
  // (see `open_degraded` in the backend). That connection looks completely
  // normal otherwise, so without this the first sign of trouble is a
  // mysterious "failed to save" on the next write. Warn up front instead.
  useEffect(() => {
    if (authState !== "ready") return;
    db.getConnection()
      .then((connection) => {
        if (connection?.offline) toast.warning(t("settings.remoteDBOfflineNote"), { duration: 15000 });
      })
      .catch(() => {});
  }, [authState, db, t]);

  // Silent update check, delayed past the startup rush (DB load, TTS
  // preload). Failures stay invisible; a hit only lights the sidebar dot.
  useEffect(() => {
    if (!isDesktopHost || !hostCapabilities.updater || authState !== "ready") return;
    const timer = setTimeout(() => {
      useUpdaterStore.getState().checkForUpdate({ silent: true });
    }, 5000);
    return () => clearTimeout(timer);
  }, [authState]);

  // NOTE: the on-device TTS model is deliberately NOT preloaded here.
  // A loaded sherpa-onnx session is 60-120MB resident for the whole session,
  // and preloading charged that to every launch — including the majority of
  // launches where nobody ever presses "Listen". `lib/ttsBackend.ts` already
  // loads the persisted model on demand (it treats "model-not-loaded" as a
  // self-heal, not an error), and SpeakButton/useArticlePlayer hold their
  // "loading" state across that call, so the cost lands as a slower first
  // click for users who actually use TTS instead of as idle memory for
  // everyone. Do not reintroduce an eager load without that tradeoff in mind.

  // Desktop keeps its original starter vocabulary. Web accounts must begin
  // empty: automatically writing sample rows into a newly registered user's
  // private database is surprising, and an interrupted seed used to leave a
  // seemingly random partial set behind on the login screen.
  useEffect(() => {
    if (!isDesktopHost || authState !== "ready") return;
    if (localStorage.getItem("tanwords_seeded_v1")) return;
    void (async () => {
      try {
        for (const w of ENRICHED_SEED_WORDS) {
          await db.addWordEnriched(w.word, w.zh, w.word_type, w.enrichment);
        }
        for (const w of BASIC_SEED_WORDS) {
          await db.addWord(w.word, w.zh, w.word_type, w.level);
        }
        localStorage.setItem("tanwords_seeded_v1", "1");
        window.dispatchEvent(new CustomEvent("vocab-updated"));
      } catch {
        localStorage.setItem("tanwords_seeded_v1", "1");
      }
    })();
  }, [authState, db]);

  useEffect(() => {
    if (authState !== "ready") return;
    db.getWordCount().then(setWordCount).catch(() => {});
  }, [authState, db]);

  // Refresh sidebar stats when vocabulary changes
  useEffect(() => {
    if (authState !== "ready") return;
    const handler = () => {
      db.getWordCount().then(setWordCount).catch(() => {});
    };
    window.addEventListener("vocab-updated", handler);
    return () => window.removeEventListener("vocab-updated", handler);
  }, [authState, db]);

  // Checked once at startup. `enabled === null` means the answer has not come
  // back yet — render nothing rather than a frame of unlocked content.
  const lockEnabled = useAppLockStore((s) => s.enabled);
  const locked = useAppLockStore((s) => s.locked);
  // True while the lock screen is playing its exit animation after a
  // successful unlock — see appLockStore. During this window the app
  // underneath mounts and gets its first paint done while still hidden
  // behind the (still on top, still opaque) animating-out lock screen,
  // instead of only starting to mount once it's gone.
  const unlocking = useAppLockStore((s) => s.unlocking);
  React.useEffect(() => {
    // Web bootstrap already resolved the lock in the same authenticated
    // request. Desktop still asks its sidecar once at startup.
    if (isWebHost) return;
    void useAppLockStore.getState().refresh();
  }, [authState]);

  if (lockEnabled === null) {
    return (
      <>
        {/* Mount the destination underneath the one global startup cover. The
          * same LockScreen survives when status resolves; SplashScreen alone
          * owns the reveal animation, avoiding two overlapping fade timers. */}
        <LockScreen pending />
        <AppToaster />
      </>
    );
  }

  if (locked && !unlocking) {
    return (
      <>
        <LockScreen />
        {/* Lock wallpaper, blur and theme arrive through settings. Keep the
          * startup cover until those values are committed too; otherwise the
          * default specimen can paint for one frame before the wallpaper. */}
        {settingsLoaded && <StartupReadySignal />}
        <AppToaster />
      </>
    );
  }

  if (authState === "checking") {
    return (
      <>
        <div className="app-viewport-height flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
        <AppToaster />
      </>
    );
  }

  if (authState === "login") {
    return (
      <>
        <AppBackground />
        <AuthGate />
        <StartupReadySignal />
        <AppToaster />
      </>
    );
  }

  if (!startupDestinationApplied) {
    return <AppToaster />;
  }

  const page = currentPage();
  const isTerminalRoute = page === "terminal" && hostCapabilities.terminal;
  const isDshRoute = page === "dsh" && hostCapabilities.dsh;
  const workspaceActive = isDesktopHost && !!activeWorkspaceId;
  // Terminal's embedded "maximize" removes app chrome without invoking the
  // fragile browser fullscreen API or unmounting the live PTY. The state lives
  // in `pageHostUiStore` (written by the Terminal adapter, read above with the
  // other unconditional hooks) so the shell can compute `immersive`/
  // `disableBlur` without a prop threaded back up through `PageHost`.
  const immersive = terminalMaximized && (isTerminalRoute || (workspaceActive && workspaceTerminalFocused));

  return (
    <>
    <AppBackground disableBlur={immersive || (!workspaceActive && (isTerminalRoute || isDshRoute))} />
    {isDesktopHost && <DragLayer />}
    <MainLayout
      activeNav={resolveShellActiveNav(page, workspaceActive, settingsOpen) ?? ""}
      onNavigate={(id) => navigate(id as any)}
      wordCount={wordCount}
      immersive={immersive}
    >
      <PageHost activePage={page} visible={!workspaceActive} />
      {workspaceActive && <WorkspaceScreen />}
    </MainLayout>
    {wordModalWord && (
      <React.Suspense fallback={null}>
        <WordDetailModal />
      </React.Suspense>
    )}
    {selectionToolsReady && (
      <React.Suspense fallback={null}>
        <SelectionAsk />
      </React.Suspense>
    )}
    {toolsModalOpen && (
      <React.Suspense fallback={null}>
        <ToolsModal />
      </React.Suspense>
    )}
    {podcastVisible && !immersive && (
      <React.Suspense fallback={null}>
        <PodcastPlayerBar />
      </React.Suspense>
    )}
    {hostCapabilities.browser && (
      <React.Suspense fallback={null}>
        <FloatingBrowserWidget />
      </React.Suspense>
    )}
    {voiceAssistantAvailable && (
      <React.Suspense fallback={null}>
        <VoiceOverlay />
      </React.Suspense>
    )}
    {settingsOpen && (
      <React.Suspense fallback={null}>
        <SettingsModal />
      </React.Suspense>
    )}
    {/* Still mounted during `unlocking`: the app underneath has now had a
      * frame to do its first paint, and this plays its own exit animation
      * on top before calling `setLocked(false)` — a real cross-fade instead
      * of the destination page's first paint happening the instant the lock
      * screen disappears. */}
    {locked && <LockScreen />}
    <AppToaster />
    </>
  );
}

export default App;

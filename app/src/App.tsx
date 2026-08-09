import React, { useEffect, useLayoutEffect } from "react";
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

/** Every page is code-split.
 *
 *  Only the landing page's chunk is needed to paint, so the rest — the editor
 *  stack behind Documents, the chat providers, the charts on Dashboard — stay
 *  out of the startup parse instead of riding along in the main chunk. The
 *  named exports are re-shaped to the default export React.lazy wants.
 *
 *  They load on first navigation; there is no idle prefetch, so unused routes
 *  do not keep their parser/runtime costs resident for the whole session. */
import { LockScreen } from "@/components/Layout/LockScreen";
import { useAppLockStore } from "@/store/appLockStore";

const DashboardPage = React.lazy(() =>
  import("@/components/Dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const VocabularyPage = React.lazy(() =>
  import("@/components/Vocabulary/VocabularyPage").then((m) => ({ default: m.VocabularyPage })));
const SettingsPage = React.lazy(() =>
  import("@/components/Settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const DocumentsPage = React.lazy(() =>
  import("@/components/Documents/DocumentsPage").then((m) => ({ default: m.DocumentsPage })));
const FeedsPage = React.lazy(() =>
  import("@/components/Feeds/FeedsPage").then((m) => ({ default: m.FeedsPage })));
const AiChatPage = React.lazy(() =>
  import("@/components/AiChat/AiChatPage").then((m) => ({ default: m.AiChatPage })));
const ReadingPage = React.lazy(() =>
  import("@/components/Reader/ReadingPage").then((m) => ({ default: m.ReadingPage })));
const MusicPage = React.lazy(() => import("@/components/Music/MusicPage"));
const BrowserPage = React.lazy(() => import("@/components/Browser/BrowserPage"));
const ToolsPage = React.lazy(() =>
  import("@/components/Tools/ToolsPage").then((m) => ({ default: m.ToolsPage })));
const WordDetailModal = React.lazy(() =>
  import("@/components/WordDetailModal").then((m) => ({ default: m.WordDetailModal })));
const ToolsModal = React.lazy(() =>
  import("@/components/ui/ToolsModal").then((m) => ({ default: m.ToolsModal })));
const PodcastPlayerBar = React.lazy(() =>
  import("@/components/ui/PodcastPlayerBar").then((m) => ({ default: m.PodcastPlayerBar })));
const SelectionAsk = React.lazy(() =>
  import("@/components/shared/SelectionAsk").then((m) => ({ default: m.SelectionAsk })));

const PageFallback = () => (
  <div className="h-full flex items-center justify-center">
    <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

/** Mounted only inside a fully committed startup destination. The splash reads
 * both the durable dataset flag and this event, so it cannot miss readiness if
 * this layout effect runs before its passive listener is attached. Keeping the
 * signal inside Suspense means a lazy route's loading spinner is never mistaken
 * for the real first screen. */
function StartupReadySignal() {
  useLayoutEffect(() => {
    document.documentElement.dataset.tanwordsShellReady = "1";
    window.dispatchEvent(new CustomEvent("tanwords:shell-ready"));
  }, []);
  return null;
}

type AuthState = "checking" | "ready" | "login";

function App() {
  const { loadFromDB } = useSettingsStore();
  const db = useDB();
  const t = useT();
  const { currentPage, currentWordId, navigate } = useNavStore();
  const chatSessionId = useNavStore((s) => s.chatSessionId);
  const sentenceId = useNavStore((s) => s.sentenceId);
  const wordModalWord = useWordModalStore((s) => s.word);
  const toolsModalOpen = useToolsBallStore((s) => s.isOpen);
  const podcastVisible = usePodcastPlayerStore((s) => s.status !== "idle" && !!s.track);

  const [authState, setAuthState] = React.useState<AuthState>(isWebHost ? "checking" : "ready");
  const [wordCount, setWordCount] = React.useState(0);
  const [selectionToolsReady, setSelectionToolsReady] = React.useState(false);

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
    void auth.me().then((ok) => {
      if (cancelled) return;
      useAppLockStore.setState({ enabled: ok ? null : false, locked: false });
      setAuthState(ok ? "ready" : "login");
    });
    const onUnauthorized = () => {
      useAppLockStore.setState({ enabled: false, locked: false });
      setAuthState("login");
    };
    const onAuthorized = () => {
      // Hold the first authenticated paint until this account's own lock
      // status is known; otherwise a configured account briefly flashes open.
      useAppLockStore.setState({ enabled: null, locked: false });
      setAuthState("ready");
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

  // A saved Turso profile can open successfully but read-only — the primary
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
  }, [authState, currentPage()]);

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
  React.useEffect(() => {
    if (isWebHost && authState !== "ready") return;
    void useAppLockStore.getState().refresh();
  }, [authState]);

  if (lockEnabled === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  if (locked) {
    return (
      <>
        <LockScreen />
        <StartupReadySignal />
        <Toaster position="bottom-right" richColors closeButton />
      </>
    );
  }

  if (authState === "checking") {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  if (authState === "login") {
    return (
      <>
        <AppBackground />
        <AuthGate />
        <StartupReadySignal />
        <Toaster position="bottom-right" richColors closeButton />
      </>
    );
  }

  const page = currentPage();
  const wordId = currentWordId();

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <DashboardPage />;
      case "reading":
        return <ReadingPage />;
      case "music":
        return isDesktopHost ? <MusicPage /> : <DashboardPage />;
      case "browser":
        return isDesktopHost ? <BrowserPage /> : <DashboardPage />;
      case "vocabulary":
        return <VocabularyPage initialWordId={wordId} initialSentenceId={sentenceId} />;
      case "documents":
        return <DocumentsPage />;
      case "chat":
        return <AiChatPage initialSessionId={chatSessionId} />;
      case "settings":
        return <SettingsPage />;
      case "tools":
        return <ToolsPage />;
      case "feeds":
      default:
        return <FeedsPage />;
    }
  };

  return (
    <>
    <AppBackground />
    <MainLayout
      activeNav={page}
      onNavigate={(id) => navigate(id as any)}
      wordCount={wordCount}
    >
      {/* Keyed on the page so switching pages shows the spinner rather than
          holding the previous page mounted while the next chunk loads. */}
      <React.Suspense key={page} fallback={<PageFallback />}>
        {renderPage()}
        <StartupReadySignal />
      </React.Suspense>
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
    {podcastVisible && (
      <React.Suspense fallback={null}>
        <PodcastPlayerBar />
      </React.Suspense>
    )}
    <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}

export default App;

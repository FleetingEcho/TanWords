import React, { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { MainLayout } from "@/components/Layout/Sidebar";
import { SelectionAsk } from "@/components/shared/SelectionAsk";
import { AppBackground } from "@/components/Layout/AppBackground";
import { AuthGate } from "@/components/Layout/AuthGate";
import { useSettingsStore } from "@/store/settingsStore";
import { useNavStore } from "@/store/navStore";
import { useWordModalStore } from "@/store/wordModalStore";
import { useToolsBallStore } from "@/store/toolsBallStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useMcpSync } from "@/hooks/useMcpSync";
import { initProviders } from "@/lib/initProviders";
import { invoke } from "@/api/client";
import * as auth from "@/api/auth";
import { ENRICHED_SEED_WORDS, BASIC_SEED_WORDS } from "@/data/seedWords";

/** Every page is code-split.
 *
 *  Only the landing page's chunk is needed to paint, so the rest — the editor
 *  stack behind Documents, the chat providers, the charts on Dashboard — stay
 *  out of the startup parse instead of riding along in the main chunk. The
 *  named exports are re-shaped to the default export React.lazy wants.
 *
 *  They load on first navigation; there is no idle prefetch, so unused routes
 *  do not keep their parser/runtime costs resident for the whole session. */
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
const WordDetailModal = React.lazy(() =>
  import("@/components/WordDetailModal").then((m) => ({ default: m.WordDetailModal })));
const ToolsModal = React.lazy(() =>
  import("@/components/ui/ToolsModal").then((m) => ({ default: m.ToolsModal })));
const PodcastPlayerBar = React.lazy(() =>
  import("@/components/ui/PodcastPlayerBar").then((m) => ({ default: m.PodcastPlayerBar })));

const PageFallback = () => (
  <div className="h-full flex items-center justify-center">
    <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

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

  const [authState, setAuthState] = useState<AuthState>("checking");
  const [wordCount, setWordCount] = React.useState(0);

  useMcpSync();

  // Session gate. api/client.ts dispatches 'tanwords:unauthorized' whenever any
  // request 401s (and clears the stored token), 'tanwords:authorized' on a
  // successful login from the Login screen — both land here regardless of which
  // component started the transition.
  useEffect(() => {
    let cancelled = false;
    void auth.me().then((ok) => { if (!cancelled) setAuthState(ok ? "ready" : "login"); });
    const onUnauthorized = () => setAuthState("login");
    const onAuthorized = () => setAuthState("ready");
    window.addEventListener("tanwords:unauthorized", onUnauthorized);
    window.addEventListener("tanwords:authorized", onAuthorized);
    return () => {
      cancelled = true;
      window.removeEventListener("tanwords:unauthorized", onUnauthorized);
      window.removeEventListener("tanwords:authorized", onAuthorized);
    };
  }, []);

  // Initialize providers and persisted settings once authenticated. Deferred
  // past first paint so the shell renders before provider bootstrap work starts.
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

  // If the configured database failed to open this launch, the backend fell back
  // to the default file rather than deleting anything — surface that instead of
  // leaving the user staring at a mysteriously empty vocabulary.
  useEffect(() => {
    if (authState !== "ready") return;
    invoke<string | null>("db_get_startup_warning")
      .then((path) => {
        if (path) toast.warning(t("settings.dbFallbackWarning", { path }), { duration: 15000 });
      })
      .catch(() => {});
  }, [authState, t]);

  // A saved Turso profile can open successfully but read-only — the primary was
  // unreachable, so the app serves the local replica as-is. That connection
  // looks completely normal otherwise, so warn up front instead of letting the
  // first "failed to save" be the surprise.
  useEffect(() => {
    if (authState !== "ready") return;
    db.getConnection()
      .then((connection) => {
        if (connection?.offline) toast.warning(t("settings.remoteDBOfflineNote"), { duration: 15000 });
      })
      .catch(() => {});
  }, [authState, db, t]);

  // Seed vocabulary once per install (localStorage flag prevents re-seeding)
  useEffect(() => {
    if (authState !== "ready") return;
    if (localStorage.getItem("tanwords_seeded_v1")) return;
    (async () => {
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
        // Backend unreachable — still mark as done to avoid retry loops.
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
        <Toaster position="bottom-right" richColors closeButton />
      </>
    );
  }

  const page = currentPage();
  const wordId = currentWordId();

  const renderPage = () => {
    switch (page) {
      case "vocabulary":
        return <VocabularyPage initialWordId={wordId} initialSentenceId={sentenceId} />;
      case "documents":
        return <DocumentsPage />;
      case "chat":
        return <AiChatPage initialSessionId={chatSessionId} />;
      case "settings":
        return <SettingsPage />;
      case "reading":
        return <ReadingPage />;
      case "feeds":
        return <FeedsPage />;
      case "dashboard":
      default:
        return <DashboardPage />;
    }
  };

  return (
    <>
    <AppBackground />
    <MainLayout
      activeNav={page}
      onNavigate={(id) => navigate(id as never)}
      wordCount={wordCount}
    >
      {/* Keyed on the page so switching pages shows the spinner rather than
          holding the previous page mounted while the next chunk loads. */}
      <React.Suspense key={page} fallback={<PageFallback />}>
        {renderPage()}
      </React.Suspense>
    </MainLayout>
    {wordModalWord && (
      <React.Suspense fallback={null}>
        <WordDetailModal />
      </React.Suspense>
    )}
    <SelectionAsk />
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

import React, { useEffect } from "react";
import { Toaster, toast } from "sonner";
import { MainLayout } from "@/components/Layout/Sidebar";
import { WordDetailModal } from "@/components/WordDetailModal";
import { SelectionAsk } from "@/components/shared/SelectionAsk";
import { PodcastPlayerBar } from "@/components/ui/PodcastPlayerBar";
import { ToolsModal } from "@/components/ui/ToolsModal";
import { AppBackground } from "@/components/Layout/AppBackground";
import { useSettingsStore } from "@/store/settingsStore";
import { useUpdaterStore } from "@/store/updaterStore";
import { useNavStore } from "@/store/navStore";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useMcpSync } from "@/hooks/useMcpSync";
import { useTraySync } from "@/hooks/useTraySync";
import { initProviders } from "@/lib/initProviders";
import { invoke } from "@/ipc/backend";
import { ENRICHED_SEED_WORDS, BASIC_SEED_WORDS } from "@/data/seedWords";
import { LOCAL_DOCS_ROOT_KEY, localDocsRootExists } from "@/lib/localDocs";

/** Every page is code-split.
 *
 *  Only the landing page's chunk is needed to paint, so the rest — the editor
 *  stack behind Documents, the chat providers, the charts on Dashboard — stay
 *  out of the startup parse instead of riding along in the main chunk. The
 *  named exports are re-shaped to the default export React.lazy wants.
 *
 *  Pages are prefetched shortly after mount (see the effect in App), so a
 *  sidebar click still lands on an already-loaded chunk — the split costs
 *  startup work, not navigation latency. */
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

/** Warm the chunks the user hasn't asked for yet, once the app is idle. */
const PREFETCH_PAGES = [
  () => import("@/components/Feeds/FeedsPage"),
  () => import("@/components/Reader/ReadingPage"),
  () => import("@/components/Dashboard/DashboardPage"),
  () => import("@/components/Vocabulary/VocabularyPage"),
  () => import("@/components/Documents/DocumentsPage"),
  () => import("@/components/AiChat/AiChatPage"),
  () => import("@/components/Settings/SettingsPage"),
];

const PageFallback = () => (
  <div className="h-full flex items-center justify-center">
    <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

function App() {
  const { loadFromDB } = useSettingsStore();
  const db = useDB();
  const t = useT();
  const { currentPage, currentWordId, navigate } = useNavStore();
  const chatSessionId = useNavStore((s) => s.chatSessionId);
  const sentenceId = useNavStore((s) => s.sentenceId);

  const [wordCount, setWordCount] = React.useState(0);

  useMcpSync();
  useTraySync();

  // Initialize providers from keychain (with localStorage fallback/migration) on startup.
  // Deferred past first paint so the OS keychain prompt (macOS asks the first
  // time an unauthorized app reads/writes an entry) doesn't fire before the
  // user has even seen the app window.
  useEffect(() => {
    const idle = window.requestIdleCallback?.(() => initProviders())
      ?? window.setTimeout(() => initProviders(), 500);
    loadFromDB();
    return () => {
      if (window.cancelIdleCallback && typeof idle !== "number") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle as number);
    };
  }, []);

  // Pull the other page chunks in once the app is idle. Code-splitting the
  // routes is what keeps them out of the startup parse; this is what keeps the
  // first click on each of them from paying a load. Sequential on purpose —
  // seven parallel chunk loads would compete with the startup DB reads.
  useEffect(() => {
    let cancelled = false;
    const warm = async () => {
      for (const load of PREFETCH_PAGES) {
        if (cancelled) return;
        try {
          await load();
        } catch {
          // A prefetch miss is invisible: React.lazy will just load it on demand.
        }
      }
    };
    const idle = window.requestIdleCallback?.(() => void warm())
      ?? window.setTimeout(() => void warm(), 1500);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback && typeof idle !== "number") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle as number);
    };
  }, []);

  // The local Documents folder is a device path, while settings may live in a
  // database shared by Linux, macOS, and other machines. Silently discard a
  // binding that is invalid on this device before the Documents view can try
  // to scan or reopen files from it.
  useEffect(() => {
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
  }, []);

  // If a previously-saved custom DB path failed to open this launch (drive
  // unplugged, file moved), the backend silently fell back to the default
  // DB rather than deleting anything — surface that instead of leaving the
  // user staring at a mysteriously empty vocabulary.
  useEffect(() => {
    invoke<string | null>("db_get_startup_warning")
      .then((path) => {
        if (path) toast.warning(t("settings.dbFallbackWarning", { path }), { duration: 15000 });
      })
      .catch(() => {});
  }, []);

  // A saved Turso profile can open successfully but read-only — the primary
  // was unreachable and the app fell back to serving the local replica as-is
  // (see `open_degraded` in the backend). That connection looks completely
  // normal otherwise, so without this the first sign of trouble is a
  // mysterious "failed to save" on the next write. Warn up front instead.
  useEffect(() => {
    db.getConnection()
      .then((connection) => {
        if (connection?.offline) toast.warning(t("settings.remoteDBOfflineNote"), { duration: 15000 });
      })
      .catch(() => {});
  }, []);

  // Silent update check, delayed past the startup rush (DB load, TTS
  // preload). Failures stay invisible; a hit only lights the sidebar dot.
  useEffect(() => {
    const timer = setTimeout(() => {
      useUpdaterStore.getState().checkForUpdate({ silent: true });
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // NOTE: the on-device TTS model is deliberately NOT preloaded here.
  // A loaded sherpa-onnx session is 60-120MB resident for the whole session,
  // and preloading charged that to every launch — including the majority of
  // launches where nobody ever presses "Listen". `lib/ttsBackend.ts` already
  // loads the persisted model on demand (it treats "model-not-loaded" as a
  // self-heal, not an error), and SpeakButton/useArticlePlayer hold their
  // "loading" state across that call, so the cost lands as a slower first
  // click for users who actually use TTS instead of as idle memory for
  // everyone. Do not reintroduce an eager load without that tradeoff in mind.

  // Seed vocabulary once per install (localStorage flag prevents re-seeding)
  useEffect(() => {
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
        // Tauri not available (web mode) — still mark as done to avoid retry loops
        localStorage.setItem("tanwords_seeded_v1", "1");
      }
    })();
  }, []);

  useEffect(() => {
    db.getWordCount().then(setWordCount).catch(() => {});
  }, [currentPage()]);

  // Refresh sidebar stats when vocabulary changes
  useEffect(() => {
    const handler = () => {
      db.getWordCount().then(setWordCount).catch(() => {});
    };
    window.addEventListener("vocab-updated", handler);
    return () => window.removeEventListener("vocab-updated", handler);
  }, []);

  const page = currentPage();
  const wordId = currentWordId();

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <DashboardPage />;
      case "reading":
        return <ReadingPage />;
      case "music":
        return <MusicPage />;
      case "browser":
        return <BrowserPage />;
      case "vocabulary":
        return <VocabularyPage initialWordId={wordId} initialSentenceId={sentenceId} />;
      case "documents":
        return <DocumentsPage />;
      case "chat":
        return <AiChatPage initialSessionId={chatSessionId} />;
      case "settings":
        return <SettingsPage />;
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
      </React.Suspense>
    </MainLayout>
    <WordDetailModal />
    <SelectionAsk />
    <ToolsModal />
    <PodcastPlayerBar />
    <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}

export default App;

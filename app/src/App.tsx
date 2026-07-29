import React, { useEffect } from "react";
import { Toaster, toast } from "sonner";
import { MainLayout } from "@/components/Layout/Sidebar";
import { DashboardPage } from "@/components/Dashboard/DashboardPage";
import { VocabularyPage } from "@/components/Vocabulary/VocabularyPage";
import { SettingsPage } from "@/components/Settings/SettingsPage";
import { DocumentsPage } from "@/components/Documents/DocumentsPage";
import { FeedsPage } from "@/components/Feeds/FeedsPage";
import { AiChatPage } from "@/components/AiChat/AiChatPage";
import { WordDetailModal } from "@/components/WordDetailModal";
import { ReadingPage } from "@/components/Reader/ReadingPage";
import { SelectionAsk } from "@/components/shared/SelectionAsk";
import { PlayerBar } from "@/components/ui/PlayerBar";
import { PodcastPlayerBar } from "@/components/ui/PodcastPlayerBar";
import { ToolsModal } from "@/components/ui/ToolsModal";
import { AppBackground } from "@/components/Layout/AppBackground";
import { useSettingsStore } from "@/store/settingsStore";
import { useUpdaterStore } from "@/store/updaterStore";
import { useNavStore } from "@/store/navStore";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useTraySync } from "@/hooks/useTraySync";
import { useMcpSync } from "@/hooks/useMcpSync";
import { initProviders } from "@/lib/initProviders";
import { invoke } from "@tauri-apps/api/core";
import { ENRICHED_SEED_WORDS, BASIC_SEED_WORDS } from "@/data/seedWords";

const MusicPage = React.lazy(() => import("@/components/Music/MusicPage"));

function App() {
  const { loadFromDB, isLoaded, ttsModelPath } = useSettingsStore();
  const db = useDB();
  const t = useT();
  const { currentPage, currentWordId, navigate } = useNavStore();
  const chatSessionId = useNavStore((s) => s.chatSessionId);

  const [wordCount, setWordCount] = React.useState(0);

  useTraySync();
  useMcpSync();

  // Initialize providers from keychain (with localStorage fallback/migration) on startup
  useEffect(() => {
    initProviders();
    loadFromDB();
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

  // Preload the on-device TTS model at startup instead of on the first
  // "Listen to article" click — sherpa-onnx session build + its own warm-up
  // synth take a few seconds, and paying that cost eagerly here keeps the
  // click-to-first-sentence latency down to just one real synth call.
  useEffect(() => {
    if (!isLoaded || !ttsModelPath) return;
    // Let the first paint, settings hydration and initial DB reads settle
    // before starting CPU-heavy ONNX session construction in the background.
    const timer = window.setTimeout(() => {
      invoke("tts_load_model", { path: ttsModelPath }).catch(() => {});
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [isLoaded, ttsModelPath]);

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
      case "feeds":
        return <FeedsPage />;
      case "reading":
        return <ReadingPage />;
      case "music":
        return (
          <React.Suspense
            fallback={
              <div className="h-full flex items-center justify-center">
                <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              </div>
            }
          >
            <MusicPage />
          </React.Suspense>
        );
      case "vocabulary":
        return <VocabularyPage initialWordId={wordId} />;
      case "documents":
        return <DocumentsPage />;
      case "chat":
        return <AiChatPage initialSessionId={chatSessionId} />;
      case "settings":
        return <SettingsPage />;
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
      {renderPage()}
    </MainLayout>
    <WordDetailModal />
    <SelectionAsk />
    <ToolsModal />
    <PlayerBar />
    <PodcastPlayerBar />
    <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}

export default App;

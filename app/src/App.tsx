import React, { useEffect } from "react";
import { Toaster } from "sonner";
import { MainLayout } from "@/components/Layout/Sidebar";
import { DashboardPage } from "@/components/Dashboard/DashboardPage";
import { VocabularyPage } from "@/components/Vocabulary/VocabularyPage";
import { SettingsPage } from "@/components/Settings/SettingsPage";
import { DocumentsPage } from "@/components/Documents/DocumentsPage";
import { FeedsPage } from "@/components/Feeds/FeedsPage";
import { ReadingPage } from "@/components/Reading/ReadingPage";
import { AiChatPage } from "@/components/AiChat/AiChatPage";
import { WordDetailModal } from "@/components/WordDetailModal";
import { PlayerBar } from "@/components/ui/PlayerBar";
import { PodcastPlayerBar } from "@/components/ui/PodcastPlayerBar";
import { ToolsBall } from "@/components/ui/ToolsBall";
import { ToolsModal } from "@/components/ui/ToolsModal";
import { useSettingsStore } from "@/store/settingsStore";
import { useNavStore } from "@/store/navStore";
import { useDB } from "@/hooks/useDB";
import { initProviders } from "@/lib/initProviders";
import { invoke } from "@tauri-apps/api/core";
import { ENRICHED_SEED_WORDS, BASIC_SEED_WORDS } from "@/data/seedWords";

function App() {
  const { loadFromDB, isLoaded, ttsModelPath } = useSettingsStore();
  const db = useDB();
  const { currentPage, currentWordId, navigate } = useNavStore();

  const [wordCount, setWordCount] = React.useState(0);

  // Initialize providers from keychain (with localStorage fallback/migration) on startup
  useEffect(() => {
    initProviders();
    loadFromDB();
  }, []);

  // Preload the on-device TTS model at startup instead of on the first
  // "Listen to article" click — sherpa-onnx session build + its own warm-up
  // synth take a few seconds, and paying that cost eagerly here keeps the
  // click-to-first-sentence latency down to just one real synth call.
  useEffect(() => {
    if (!isLoaded || !ttsModelPath) return;
    invoke("tts_load_model", { path: ttsModelPath }).catch(() => {});
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
      case "vocabulary":
        return <VocabularyPage initialWordId={wordId} />;
      case "documents":
        return <DocumentsPage />;
      case "chat":
        return <AiChatPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <FeedsPage />;
    }
  };

  return (
    <>
    <MainLayout
      activeNav={page}
      onNavigate={(id) => navigate(id as any)}
      wordCount={wordCount}
    >
      {renderPage()}
    </MainLayout>
    <WordDetailModal />
    <ToolsModal />
    <PlayerBar />
    <PodcastPlayerBar />
    <ToolsBall />
    <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}

export default App;

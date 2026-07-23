import { create } from "zustand";
import { useNavStore } from "@/store/navStore";
import { useReadingStore } from "@/store/readingStore";
import { useFeedsNavStore } from "@/store/feedsNavStore";

export type PlayerOrigin =
  | { kind: "lesson"; articleId: number }
  | { kind: "reader"; url: string; title: string; domain: string; audioUrl: string | null; feedTitle: string; hnItemId: number | null }
  | { kind: "music" };

interface PlayerOriginState {
  origin: PlayerOrigin | null;
  setOrigin: (origin: PlayerOrigin) => void;
  /** Navigate to (and restore) whichever page/view started the currently playing audio. */
  goToOrigin: () => void;
}

export const usePlayerOriginStore = create<PlayerOriginState>((set, get) => ({
  origin: null,
  setOrigin: (origin) => set({ origin }),

  goToOrigin: () => {
    const origin = get().origin;
    if (!origin) return;
    const { navigate } = useNavStore.getState();

    switch (origin.kind) {
      case "lesson":
        navigate("reading");
        useReadingStore.getState().setPendingArticleId(origin.articleId);
        break;
      case "reader":
        navigate("feeds");
        useFeedsNavStore.getState().setPendingBrowse({
          url: origin.url,
          title: origin.title,
          domain: origin.domain,
          audioUrl: origin.audioUrl,
          feedTitle: origin.feedTitle,
          hnItemId: origin.hnItemId,
        });
        break;
      case "music":
        navigate("music");
        break;
    }
  },
}));

import { create } from "zustand";
import { useNavStore } from "@/store/navStore";
import { useFeedsNavStore } from "@/store/feedsNavStore";
import { useReadingPageStore } from "@/store/readingPageStore";

export type PlayerOrigin =
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
      case "reader": {
        // Feeds merged into the Reading page on web — land on the panel that
        // matches the content (a podcast episode's origin is the podcasts tab).
        const tab = origin.audioUrl ? "podcasts" : "feeds";
        useReadingPageStore.getState().setTab(tab);
        navigate("reading");
        useFeedsNavStore.getState().setBrowse({
          url: origin.url,
          title: origin.title,
          domain: origin.domain,
          audioUrl: origin.audioUrl,
          feedTitle: origin.feedTitle,
          hnItemId: origin.hnItemId,
          kind: origin.audioUrl ? "podcast" : "article",
        });
        break;
      }
      case "music":
        // No music page on web — the origin can't have been set to one.
        break;
    }
  },
}));

import { create } from "zustand";
import { fetchHnComments, type HnComment } from "@/lib/hnComments";

interface HnCommentsState {
  byStoryId: Record<number, HnComment[]>;
  pending: Record<number, Promise<HnComment[]>>;
  /** Fetches a story's comment tree once and caches it, keyed by story id — shared
   *  between the comments panel (HnComments), Learn/background-analyze (which fold
   *  the flattened text into the AI notes), and Translate (which needs the same
   *  text again later, possibly well after HnComments already fetched it). A
   *  second caller for the same id gets the in-flight promise instead of firing
   *  a duplicate request. */
  fetch: (storyId: number) => Promise<HnComment[]>;
}

export const useHnCommentsStore = create<HnCommentsState>((set, get) => ({
  byStoryId: {},
  pending: {},
  fetch: (storyId) => {
    const cached = get().byStoryId[storyId];
    if (cached) return Promise.resolve(cached);
    const inFlight = get().pending[storyId];
    if (inFlight) return inFlight;

    const promise = fetchHnComments(storyId)
      .then((comments) => {
        set((s) => {
          const { [storyId]: _drop, ...pending } = s.pending;
          return { byStoryId: { ...s.byStoryId, [storyId]: comments }, pending };
        });
        return comments;
      })
      .catch((e) => {
        set((s) => {
          const { [storyId]: _drop, ...pending } = s.pending;
          return { pending };
        });
        throw e;
      });

    set((s) => ({ pending: { ...s.pending, [storyId]: promise } }));
    return promise;
  },
}));

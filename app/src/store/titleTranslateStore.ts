import { create } from "zustand";
import { findBestProvider } from "@/providers/select";
import { serializeMarkedBatch, parseMarkedBatch } from "@/lib/markerBatch";

interface TitleTranslateState {
  byKey: Record<string, string>;
  pending: Set<string>;
  noProvider: boolean;
  /** Translates whichever of the given {key, title} pairs aren't already cached
   *  or in flight, in ONE AI call (via @@key@@ markers) rather than one request
   *  per title — meant to be called with "every title currently on screen" and
   *  re-called (idempotently) whenever that list changes, e.g. on tab switch,
   *  pagination, or a background refresh. */
  translateBatch: (items: { key: string; title: string }[]) => Promise<void>;
}

export const useTitleTranslateStore = create<TitleTranslateState>((set, get) => ({
  byKey: {},
  pending: new Set(),
  noProvider: false,
  translateBatch: async (items) => {
    const { byKey, pending } = get();
    const todo = items.filter((i) => !byKey[i.key] && !pending.has(i.key));
    if (todo.length === 0) return;

    set((s) => ({ pending: new Set([...s.pending, ...todo.map((i) => i.key)]) }));

    const clearPending = () =>
      set((s) => {
        const pending = new Set(s.pending);
        todo.forEach((i) => pending.delete(i.key));
        return { pending };
      });

    const provider = findBestProvider();
    if (!provider) {
      clearPending();
      set({ noProvider: true });
      return;
    }
    set({ noProvider: false });

    const text = serializeMarkedBatch(todo.map((i) => ({ key: i.key, text: i.title })));
    try {
      let acc = "";
      for await (const chunk of provider.translate({ text, targetLang: "Chinese", mode: "translate", preserveMarkers: true })) {
        acc += chunk;
      }
      const parsed = parseMarkedBatch(acc);
      set((s) => {
        const byKey = { ...s.byKey };
        for (const i of todo) {
          const translated = parsed.get(i.key);
          if (translated) byKey[i.key] = translated;
        }
        return { byKey };
      });
    } catch {
      // Best-effort — a failed batch just leaves those titles untranslated;
      // the toggle can be flipped off/on again to retry.
    } finally {
      clearPending();
    }
  },
}));

import { create } from "zustand";
import { findBestProvider } from "@/providers/select";

// NOTE(mobile port): desktop imports these two helpers from "@/lib/markerBatch";
// that module has not been ported to mobile yet and is outside this port's file
// allowance, so the functions are copied here VERBATIM (logic + comments). Swap
// back to `import { serializeMarkedBatch, parseMarkedBatch } from "@/lib/markerBatch"`
// once src/lib/markerBatch.ts exists.

/** Serializes a batch of texts into one prompt-ready block, each preceded by a
 *  @@key@@ marker, so a single AI call can translate the whole batch and the
 *  response can be split back apart into per-item results afterwards — instead
 *  of firing one request per item (e.g. one per comment, or one per HN title). */
function serializeMarkedBatch(items: { key: string; text: string }[]): string {
  return items.map((i) => `@@${i.key}@@\n${i.text}`).join("\n\n");
}

/** Reverses serializeMarkedBatch. Tolerant of stray content before the first
 *  marker or extra whitespace; an item whose marker didn't survive translation
 *  just won't appear in the map (callers fall back to the original text for it). */
function parseMarkedBatch(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = raw.split(/@@([\w:-]+)@@/).slice(1);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    map.set(parts[i], parts[i + 1].trim());
  }
  return map;
}

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

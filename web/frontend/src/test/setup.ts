import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { __resetForTests } from "@/api/events";

// Node 22's experimental webstorage exposes a `localStorage` global only when
// `--localstorage-file` is passed. jsdom supplies its own Storage normally,
// but with that flag absent the global can still be undefined and tests that
// clear persisted UI state fail before React mounts.
if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== "function") {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, String(value)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

// The web app talks to same-origin endpoints through @/api/*; suites mock those
// modules themselves, so there is no global preload object to stub here anymore.

// jsdom has no EventSource, and the event bus opens one lazily on first
// subscribe. Drop subscriptions between tests so they don't leak across suites.
afterEach(() => {
  __resetForTests();
});

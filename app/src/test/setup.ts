import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { __resetForTests } from "@/ipc/events";

// The harness shell exports NODE_ENV=production, which makes React load its
// production build — and the production build does not export `act`. That
// breaks every @testing-library/react render with "React.act is not a
// function". Tests need React's development build (which exports `act`), so
// force the dev build here, before any test file imports React. setup.ts runs
// first (it is in vitest's setupFiles), so react/index.js sees this value when
// it is first required and selects react.development.js.
if (process.env.NODE_ENV === "production") {
  process.env.NODE_ENV = "test";
}

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

// jsdom does not implement matchMedia. settingsStore subscribes to the
// colour-scheme media query at module load, so any suite that transitively
// imports it (via settingsStore, or a component that imports it like
// LocalDocsView / DocumentsPage) throws on import without a stub. Install a
// minimal no-op MediaQueryList matching the shape settingsStore uses
// (.addEventListener/.removeEventListener).
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Every src/ipc/* module talks through this preload global. In jsdom there is
// no preload and no sidecar, so stub it: suites mock the `@/ipc/*` modules they
// actually exercise, and anything that slips through gets a rejected promise
// instead of a TypeError on undefined.
const backend = Promise.reject(new Error("no backend in tests"));
// Pre-attach a handler so an unawaited `backend` is not reported as an
// unhandled rejection by every test file; awaiting it still rejects.
backend.catch(() => {});

window.tanwords = {
  backend,
  refreshBackend: () => backend,
  call: () => Promise.reject(new Error("no main process in tests")),
  on: () => () => {},
};

// jsdom has no EventSource, and the event bus opens one lazily on first
// subscribe. Drop subscriptions between tests so they don't leak across suites.
afterEach(() => {
  __resetForTests();
});

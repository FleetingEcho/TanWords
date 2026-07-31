import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { __resetForTests } from "@/ipc/events";

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
  call: () => Promise.reject(new Error("no main process in tests")),
  on: () => () => {},
};

// jsdom has no EventSource, and the event bus opens one lazily on first
// subscribe. Drop subscriptions between tests so they don't leak across suites.
afterEach(() => {
  __resetForTests();
});

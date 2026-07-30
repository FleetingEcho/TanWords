import "@testing-library/jest-dom/vitest";

// The bridge modules (src/bridge/*) all talk through this preload global. In
// jsdom there is no preload and no sidecar, so stub it: existing suites keep
// mocking the `@tauri-apps/*` specifiers exactly as before, and anything that
// slips through gets a rejected promise instead of a TypeError on undefined.
const backend = Promise.reject(new Error("no backend in tests"));
// Pre-attach a handler so an unawaited `backend` is not reported as an
// unhandled rejection by every test file; awaiting it still rejects.
backend.catch(() => {});

window.tanwords = {
  backend,
  call: () => Promise.reject(new Error("no main process in tests")),
  on: () => () => {},
};

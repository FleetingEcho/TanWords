export const STARTUP_READY_EVENT = "tanwords:shell-ready";

const STARTUP_READY_DATASET_KEY = "tanwordsShellReady";

/**
 * Mark the initial destination as safe to reveal.
 *
 * The dataset makes this durable across the layout-effect/passive-effect race:
 * SplashScreen may subscribe after a lazy page has already become ready. The
 * signal is deliberately one-shot because the splash only exists at startup.
 */
export function markStartupReady() {
  if (document.documentElement.dataset[STARTUP_READY_DATASET_KEY] === "1") return;
  document.documentElement.dataset[STARTUP_READY_DATASET_KEY] = "1";
  window.dispatchEvent(new CustomEvent(STARTUP_READY_EVENT));
}

export function isStartupReady() {
  return document.documentElement.dataset[STARTUP_READY_DATASET_KEY] === "1";
}

/** App-wide event bus.
 *
 *  Events arrive from two places and the UI must not care which:
 *    - the Rust sidecar, over SSE      (tts-download-progress, mcp:*)
 *    - the Electron main process, over preload (browser://*, updater:*)
 *  Both are merged into one subscription table keyed by event name.
 *
 *  `subscribe` is synchronous and returns the unsubscribe function directly —
 *  the underlying transports are started lazily in the background, so there is
 *  nothing for a caller to await. */

import { backendOrigin, backendToken } from "./backend";
import { host } from "./host";

export type Unsubscribe = () => void;

const handlers = new Map<string, Set<(payload: any) => void>>();
let streamStarted = false;
let mainUnsubscribe: Unsubscribe | null = null;

function deliver(name: string, payload: unknown) {
  const set = handlers.get(name);
  if (!set) return;
  for (const handler of [...set]) handler(payload);
}

/** Opens the SSE stream once, and reopens it if the sidecar restarts. The
 *  supervisor in main restarts a dead sidecar on a new port, so re-resolve the
 *  origin on every attempt rather than caching the URL. */
async function startStream() {
  if (streamStarted) return;
  streamStarted = true;

  mainUnsubscribe = host().on("event", ({ name, payload }) => deliver(name, payload));

  for (;;) {
    try {
      const origin = await backendOrigin();
      const token = await backendToken();
      const source = new EventSource(`${origin}/events?token=${encodeURIComponent(token)}`);
      await new Promise<void>((resolve) => {
        source.onmessage = (message) => {
          const { name, payload } = JSON.parse(message.data);
          deliver(name, payload);
        };
        source.onerror = () => {
          source.close();
          resolve();
        };
      });
    } catch {
      // fall through to the backoff below
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function subscribe<T = unknown>(name: string, handler: (payload: T) => void): Unsubscribe {
  // Fire-and-forget: transports come up in the background, and any event that
  // arrives before they do would not have been delivered to a late subscriber
  // anyway.
  void startStream().catch(() => {});

  let set = handlers.get(name);
  if (!set) handlers.set(name, (set = new Set()));
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) handlers.delete(name);
  };
}

/** Subscribe to several events at once; returns one function that drops them
 *  all. Most call sites listen to a related group inside a single useEffect. */
export function subscribeAll(entries: Record<string, (payload: any) => void>): Unsubscribe {
  const offs = Object.entries(entries).map(([name, handler]) => subscribe(name, handler));
  return () => offs.forEach((off) => off());
}

/** Emit locally *and* to every other window, so an event raised in the
 *  renderer reaches the same subscribers a sidecar-raised one would. */
export function emit(name: string, payload?: unknown): void {
  deliver(name, payload);
  void host().call("event:emit", { name, payload }).catch(() => {});
}

/** Test/no-Electron escape hatch — `src/test/setup.ts` calls this between
 *  suites so subscriptions do not leak across tests. */
export function __resetForTests() {
  handlers.clear();
  streamStarted = false;
  mainUnsubscribe?.();
  mainUnsubscribe = null;
}

/** App-wide event bus — port of the desktop's `src/ipc/events.ts`.
 *
 *  One transport instead of two: the server emits named events over SSE at
 *  `/events?token=` (EventSource can't set headers, so the bearer goes in the
 *  query). There is no Electron main channel to merge in on the web.
 *
 *  `subscribe` is synchronous and returns the unsubscribe function directly —
 *  the underlying stream is started lazily in the background, so there is
 *  nothing for a caller to await. While logged out the stream simply idles
 *  until the next login dispatches `tanwords:authorized`. */

import { backendOrigin, backendToken } from "./client";

export type Unsubscribe = () => void;

const handlers = new Map<string, Set<(payload: any) => void>>();
let streamStarted = false;

function deliver(name: string, payload: unknown) {
  const set = handlers.get(name);
  if (!set) return;
  for (const handler of [...set]) handler(payload);
}

function waitForLogin(): Promise<void> {
  return new Promise((resolve) => {
    const onLogin = () => {
      window.removeEventListener("tanwords:authorized", onLogin);
      resolve();
    };
    window.addEventListener("tanwords:authorized", onLogin);
  });
}

/** Opens the SSE stream once and keeps reopening it on failure. There is no
 *  sidecar restart-with-new-port to discover (server restart keeps the same
 *  origin), but a restart does invalidate sessions — the next attempt then
 *  sits in backendToken() until the user logs back in. */
async function startStream() {
  if (streamStarted) return;
  streamStarted = true;

  for (;;) {
    try {
      const token = await backendToken();
      const origin = await backendOrigin();
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
      // Logged out (or backend briefly unreachable). If there is no token,
      // park until login rather than hammering once a second.
      try {
        await backendToken();
      } catch {
        await waitForLogin();
        continue;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function subscribe<T = unknown>(name: string, handler: (payload: T) => void): Unsubscribe {
  // Fire-and-forget: the transport comes up in the background, and any event
  // that arrives before it does would not have been delivered to a late
  // subscriber anyway.
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

/** Emit locally. The desktop build also relays to other windows through the
 *  main process; a browser tab has no sibling windows, so local delivery is
 *  the whole job here. */
export function emit(name: string, payload?: unknown): void {
  deliver(name, payload);
}

/** Test escape hatch — `src/test/setup.ts` calls this between suites so
 *  subscriptions do not leak across tests. */
export function __resetForTests() {
  handlers.clear();
  streamStarted = false;
}

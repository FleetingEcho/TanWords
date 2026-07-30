/** Replaces `@tauri-apps/api/event`. See ./README.md.
 *
 *  Events arrive from two places and the UI must not care which:
 *    - the sidecar, over SSE   (tts-download-progress, mcp:*)
 *    - the main process, over preload (browser://*)
 *  Both are merged into one subscription table keyed by event name. */

import { backendOrigin, backendToken } from "./core";

export type Event<T> = { event: string; id: number; payload: T };
export type UnlistenFn = () => void;

const handlers = new Map<string, Set<(event: Event<any>) => void>>();
let nextId = 1;
let streamStarted = false;
let mainUnsubscribe: UnlistenFn | null = null;

function deliver(name: string, payload: unknown) {
  const set = handlers.get(name);
  if (!set) return;
  const event = { event: name, id: nextId++, payload };
  for (const handler of set) handler(event);
}

/** Opens the SSE stream once, and reopens it if the sidecar restarts. The
 *  supervisor in main restarts a dead sidecar on a new port, so re-resolve the
 *  origin on every attempt rather than caching the URL. */
async function startStream() {
  if (streamStarted) return;
  streamStarted = true;

  mainUnsubscribe = window.tanwords?.on("event", ({ name, payload }) => deliver(name, payload)) ?? null;

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

export async function listen<T>(name: string, handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  void startStream();
  let set = handlers.get(name);
  if (!set) handlers.set(name, (set = new Set()));
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) handlers.delete(name);
  };
}

export async function once<T>(name: string, handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  const unlisten = await listen<T>(name, (event) => {
    unlisten();
    handler(event);
  });
  return unlisten;
}

export async function emit(name: string, payload?: unknown): Promise<void> {
  deliver(name, payload);
  await window.tanwords?.call("event:emit", { name, payload });
}

export async function emitTo(_target: unknown, name: string, payload?: unknown): Promise<void> {
  return emit(name, payload);
}

/** Test/no-backend escape hatch — `src/test/setup.ts` calls this so the existing
 *  vitest suites keep passing without a sidecar or an EventSource in jsdom. */
export function __resetForTests() {
  handlers.clear();
  streamStarted = false;
  mainUnsubscribe?.();
  mainUnsubscribe = null;
}

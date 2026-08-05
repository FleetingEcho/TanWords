import type { Block } from "@/components/Documents/tiptap/blocks";
import { blocksToMarkdown, blocksToStorage, blocksToText, contentToBlocks, markdownToBlocks } from "./docFormat";

type Operation = "markdownToBlocks" | "contentToBlocks" | "contentToMarkdown" | "blocksToMarkdown" | "blocksToMarkdownWithStats" | "blocksToStorage" | "htmlToMarkdown";
export type MarkdownWithStats = { markdown: string; wordCount: number };
type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 1;
const pending = new Map<number, Pending>();

/** The worker is cheap now that parsing is a pure remark pipeline rather than a
 *  headless editor, but it still holds a module graph and a thread. Documents
 *  are edited in bursts, so past this much idle time that is worth more than
 *  the respawn cost on the next parse. */
const WORKER_IDLE_TIMEOUT_MS = 30_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function stopWorker() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  worker?.terminate();
  worker = null;
}

/** Arm the idle shutdown, but only once nothing is in flight. */
function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending.size === 0) stopWorker();
  }, WORKER_IDLE_TIMEOUT_MS);
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("../workers/documentWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timeout);
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
      if (pending.size === 0) scheduleIdleShutdown();
    };
    worker.onerror = () => {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error("document worker failed"));
      }
      pending.clear();
      stopWorker();
      workerUnavailable = true;
    };
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function run<T>(operation: Operation, payload: string | readonly unknown[]): Promise<T> | null {
  const target = getWorker();
  if (!target) return null;
  // Work is starting — don't let a shutdown armed by the previous batch fire
  // underneath it.
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      request.reject(new Error("document worker timed out"));
      for (const other of pending.values()) {
        clearTimeout(other.timeout);
        other.reject(new Error("document worker restarted after a timeout"));
      }
      pending.clear();
      stopWorker();
    // Large Markdown documents can legitimately take several seconds to parse
    // or serialize. A short timeout is counterproductive here: the catch path
    // repeats the same expensive work on the UI thread. Keep the work isolated
    // in the worker and reserve restart/fallback for a genuinely stuck worker.
    }, 60_000);
    pending.set(id, { resolve, reject, timeout });
    target.postMessage({ id, operation, payload });
  });
}

function abortError(): DOMException {
  return new DOMException("Document parsing aborted", "AbortError");
}

/** Navigation parses get an isolated worker. Superseding a document can then
 * terminate its expensive parse immediately instead of leaving it at the head
 * of the shared worker queue, where the next document would wait behind work
 * whose result nobody can use. */
function runAbortable<T>(
  operation: Operation,
  payload: string | readonly unknown[],
  signal: AbortSignal,
): Promise<T> | null {
  if (signal.aborted) return Promise.reject(abortError());
  if (typeof Worker === "undefined") return null;
  let target: Worker;
  try {
    target = new Worker(new URL("../workers/documentWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      target.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error("document worker timed out"))),
      60_000,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    target.onmessage = ({ data }: MessageEvent<{ result?: unknown; error?: string }>) => {
      finish(() => data.error ? reject(new Error(data.error)) : resolve(data.result as T));
    };
    target.onerror = () => finish(() => reject(new Error("document worker failed")));
    target.postMessage({ id: 1, operation, payload });
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function markdownToBlocksOffThread(markdown: string, signal?: AbortSignal): Promise<Block[]> {
  try {
    return await ((signal ? runAbortable<Block[]>("markdownToBlocks", markdown, signal) : run<Block[]>("markdownToBlocks", markdown))
      ?? markdownToBlocks(markdown));
  } catch (error) {
    if (isAbort(error)) throw error;
    return markdownToBlocks(markdown);
  }
}

export async function contentToBlocksOffThread(content: string, signal?: AbortSignal): Promise<Block[]> {
  if (!content || content === "{}" || content === "[]") return [];
  try {
    return await ((signal ? runAbortable<Block[]>("contentToBlocks", content, signal) : run<Block[]>("contentToBlocks", content))
      ?? contentToBlocks(content));
  } catch (error) {
    if (isAbort(error)) throw error;
    return contentToBlocks(content);
  }
}

export async function contentToMarkdownOffThread(content: string, signal?: AbortSignal): Promise<string> {
  if (!content || content === "{}" || content === "[]") return "";
  try {
    return await ((signal ? runAbortable<string>("contentToMarkdown", content, signal) : run<string>("contentToMarkdown", content))
      ?? blocksToMarkdown(await contentToBlocks(content)));
  } catch (error) {
    if (isAbort(error)) throw error;
    return blocksToMarkdown(await contentToBlocks(content));
  }
}

export async function blocksToMarkdownOffThread(blocks: readonly unknown[], signal?: AbortSignal): Promise<string> {
  try {
    return await ((signal ? runAbortable<string>("blocksToMarkdown", blocks, signal) : run<string>("blocksToMarkdown", blocks))
      ?? blocksToMarkdown(blocks));
  } catch (error) {
    if (isAbort(error)) throw error;
    return blocksToMarkdown(blocks);
  }
}

export async function blocksToMarkdownWithStatsOffThread(
  blocks: readonly unknown[],
): Promise<MarkdownWithStats> {
  try {
    return await (run<MarkdownWithStats>("blocksToMarkdownWithStats", blocks)
      ?? Promise.all([blocksToMarkdown(blocks), Promise.resolve(blocksToText(blocks))]).then(
        ([markdown, text]) => ({
          markdown,
          wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
        }),
      ));
  } catch {
    const [markdown, text] = await Promise.all([
      blocksToMarkdown(blocks),
      Promise.resolve(blocksToText(blocks)),
    ]);
    return {
      markdown,
      wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
    };
  }
}

export async function blocksToStorageOffThread(blocks: readonly unknown[]) {
  try { return await (run<ReturnType<typeof blocksToStorage>>("blocksToStorage", blocks) ?? Promise.resolve(blocksToStorage(blocks))); }
  catch { return blocksToStorage(blocks); }
}

export async function htmlToMarkdownOffThread(html: string): Promise<string> {
  const result = await run<string>("htmlToMarkdown", html);
  if (!result) throw new Error("document worker unavailable");
  return result;
}

export async function blocksToHtmlOffThread(blocks: readonly unknown[]): Promise<string> {
  // HTML serialization needs a DOM, so this runs on the renderer. Kept behind
  // a named function so callers do not have to care.
  const { blocksToHtml } = await import("@/components/Documents/tiptap/blocksToHtml");
  return blocksToHtml(blocks as readonly Block[]);
}

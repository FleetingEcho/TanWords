import type { PartialBlock } from "@blocknote/core";
import { blocksToMarkdown, blocksToStorage, contentToBlocks, markdownToBlocks } from "./docFormat";

type Operation = "markdownToBlocks" | "contentToBlocks" | "blocksToMarkdown" | "blocksToStorage";
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("../workers/documentWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
    };
    worker.onerror = () => {
      for (const request of pending.values()) request.reject(new Error("document worker failed"));
      pending.clear();
      worker?.terminate();
      worker = null;
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
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, operation, payload });
  });
}

export async function markdownToBlocksOffThread(markdown: string): Promise<PartialBlock[]> {
  try { return await (run<PartialBlock[]>("markdownToBlocks", markdown) ?? markdownToBlocks(markdown)); }
  catch { return markdownToBlocks(markdown); }
}

export async function contentToBlocksOffThread(content: string): Promise<PartialBlock[]> {
  if (!content || content === "{}" || content === "[]") return [];
  try { return await (run<PartialBlock[]>("contentToBlocks", content) ?? contentToBlocks(content)); }
  catch { return contentToBlocks(content); }
}

export async function blocksToMarkdownOffThread(blocks: readonly unknown[]): Promise<string> {
  try { return await (run<string>("blocksToMarkdown", blocks) ?? blocksToMarkdown(blocks)); }
  catch { return blocksToMarkdown(blocks); }
}

export async function blocksToStorageOffThread(blocks: readonly unknown[]) {
  try { return await (run<ReturnType<typeof blocksToStorage>>("blocksToStorage", blocks) ?? Promise.resolve(blocksToStorage(blocks))); }
  catch { return blocksToStorage(blocks); }
}

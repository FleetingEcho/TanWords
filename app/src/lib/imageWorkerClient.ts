/** Off-loads PNG color-quantize to a Web Worker.
 *
 *  Mirrors the `documentWorkerClient` shape: spawn one module worker lazily,
 *  remember if it ever fails so we stop paying the spawn cost, and fall back
 *  to the main thread when `Worker` is undefined. The pixel buffer is
 *  *transferred* (not copied) both ways — `getImageData` on the main thread
 *  hands its buffer over, the worker mutates it in place, and hands it back —
 *  so the dominant cost (the O(pixels) LUT loop) leaves the main thread without
 *  a per-pixel clone crossing the boundary.
 *
 *  One consequence of the transfer: on a worker error the main side's buffer
 *  is detached (length 0) by the time we get it back. Rather than try to
 *  recover a half-quantized image we mark the worker unavailable and reject,
 *  so the caller surfaces a single failed item and subsequent images fall
 *  back to the main-thread path instead of stalling on a dead worker. */
import type { QuantizeResponse } from "../workers/imageWorker";

let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 0;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("../workers/imageWorker.ts", import.meta.url), { type: "module" });
    worker.onerror = () => {
      // A load error or uncaught throw — stop using this worker for the rest of
      // the session and let the main-thread fallback take over.
      workerUnavailable = true;
      worker = null;
    };
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/** Main-thread fallback, used when `Worker` is unavailable. Identical to the
 *  worker's `quantize` — keep the two in sync. Mutates `data` in place and
 *  returns it so the caller's code path matches the worker path. */
function quantizeOnMain(data: Uint8ClampedArray<ArrayBuffer>, levels: number): Uint8ClampedArray<ArrayBuffer> {
  const step = 255 / (levels - 1);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round(v / step) * step);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  return data;
}

/** Quantize an RGBA buffer to `levels` per channel. Returns a Uint8ClampedArray
 *  (the same length as the input) suitable for `new ImageData(...)`. When a
 *  worker is available the work happens off the main thread and the buffer is
 *  transferred; otherwise it runs synchronously here. */
export function quantizeOffThread(
  data: Uint8ClampedArray<ArrayBuffer>,
  levels: number,
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const target = getWorker();
  if (!target) {
    return Promise.resolve(quantizeOnMain(data, levels));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<QuantizeResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      target.removeEventListener("message", onMessage);
      if (response.error) {
        // The worker is now considered dead — fall back to the main thread for
        // everything after this so a broken worker can't fail a whole batch.
        workerUnavailable = true;
        if (worker === target) worker = null;
        reject(new Error(response.error));
      } else {
        resolve(response.data);
      }
    };
    target.addEventListener("message", onMessage);
    // Transfer the underlying buffer — the main side's `data` is detached
    // after this call and must not be read until the response comes back.
    target.postMessage({ id, data, levels }, [data.buffer]);
  });
}

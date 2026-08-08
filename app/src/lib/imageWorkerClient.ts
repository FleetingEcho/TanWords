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
import type { QuantizeResponse, SsimResponse } from "../workers/imageWorker";

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

/** Main-thread fallback for SSIM. Mirrors the worker's `ssim` — keep in sync. */
function ssimOnMain(
  a: Uint8ClampedArray<ArrayBuffer>,
  b: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): number {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const BLOCK = 8;
  let total = 0;
  let blocks = 0;
  for (let by = 0; by + BLOCK <= height; by += BLOCK) {
    for (let bx = 0; bx + BLOCK <= width; bx += BLOCK) {
      let sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0;
      for (let y = 0; y < BLOCK; y++) {
        let i = ((by + y) * width + bx) * 4;
        for (let x = 0; x < BLOCK; x++, i += 4) {
          const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
          const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
          sumA += la; sumB += lb; sumAA += la * la; sumBB += lb * lb; sumAB += la * lb;
        }
      }
      const n = BLOCK * BLOCK;
      const muA = sumA / n;
      const muB = sumB / n;
      const varA = sumAA / n - muA * muA;
      const varB = sumBB / n - muB * muB;
      const covAB = sumAB / n - muA * muB;
      const numerator = (2 * muA * muB + C1) * (2 * covAB + C2);
      const denominator = (muA * muA + muB * muB + C1) * (varA + varB + C2);
      total += denominator === 0 ? 1 : numerator / denominator;
      blocks++;
    }
  }
  return blocks === 0 ? 1 : Math.max(0, Math.min(1, total / blocks));
}

/** Structural similarity of two same-sized RGBA buffers, in [0, 1]. Both
 *  buffers are transferred to the worker and are detached afterwards — this is
 *  called on throwaway probe pixels, never on anything the caller still needs.
 *  Unlike `quantizeOffThread` a worker failure is not fatal here: the score is
 *  recomputed on the main thread so a dead worker degrades to slower, not
 *  broken. */
export function ssimOffThread(
  a: Uint8ClampedArray<ArrayBuffer>,
  b: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<number> {
  const target = getWorker();
  if (!target) return Promise.resolve(ssimOnMain(a, b, width, height));
  const id = nextId++;
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<SsimResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      target.removeEventListener("message", onMessage);
      if (response.error) {
        workerUnavailable = true;
        if (worker === target) worker = null;
        // The buffers are gone with the transfer, so there is nothing to
        // recompute from — treat a scoring failure as "cannot vouch for this
        // candidate", which makes the encoder keep the safer, larger one.
        resolve(0);
      } else {
        resolve(response.ssim);
      }
    };
    target.addEventListener("message", onMessage);
    target.postMessage({ id, op: "ssim", a, b, width, height }, [a.buffer, b.buffer]);
  });
}

/// <reference lib="webworker" />
// The image reducer's two O(pixels) loops, off the main thread.
//
// `quantize` snaps each RGB channel to `levels` evenly-spaced values (PNG has
// no quality dial, so its reduction is lossy color quantization). `ssim`
// scores a candidate encode against the original, which is what lets the
// encoder search for the *smallest* file that still clears a quality bar
// instead of guessing at a fixed quality number. Everything else in the
// pipeline is already off-thread — `createImageBitmap` (async decode) and
// `canvas.toBlob` (the browser's own off-thread encode).
//
// Quantize transfers its pixel buffer both ways — handed over, mutated in
// place, handed back — so no per-pixel clone crosses the boundary. SSIM's two
// buffers are transferred in and never come back; the caller has no use for
// them afterwards.

type QuantizeRequest = {
  id: number;
  op?: "quantize";
  /** RGBA pixel buffer, transferred from the main thread. Mutated in place. */
  data: Uint8ClampedArray<ArrayBuffer>;
  levels: number;
};

type SsimRequest = {
  id: number;
  op: "ssim";
  /** Two RGBA buffers of identical dimensions, both transferred in. */
  a: Uint8ClampedArray<ArrayBuffer>;
  b: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
};

export type QuantizeResponse = {
  id: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  error?: string;
};

export type SsimResponse = {
  id: number;
  ssim: number;
  error?: string;
};

self.onmessage = (event: MessageEvent<QuantizeRequest | SsimRequest>) => {
  const msg = event.data;
  if (msg.op === "ssim") {
    try {
      const value = ssim(msg.a, msg.b, msg.width, msg.height);
      (self as unknown as Worker).postMessage({ id: msg.id, ssim: value } satisfies SsimResponse);
    } catch (err) {
      (self as unknown as Worker).postMessage({
        id: msg.id,
        ssim: 0,
        error: err instanceof Error ? err.message : String(err),
      } satisfies SsimResponse);
    }
    return;
  }

  const { id, data, levels } = msg;
  try {
    quantize(data, levels);
    const response: QuantizeResponse = { id, data };
    (self as unknown as Worker).postMessage(response, [data.buffer]);
  } catch (err) {
    // Send the buffer back too so the main side can recover it if it wants to
    // retry; the quantize loop never partially mutated because the LUT build
    // and the per-pixel pass are separate and the pass only writes via the LUT.
    const response: QuantizeResponse = {
      id,
      data,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response, [data.buffer]);
  }
};

/** Snaps each RGB channel to `levels` evenly-spaced values via a 256-entry
 *  LUT, so the per-pixel work is a flat array index. Alpha is left untouched
 *  so transparent PNGs stay transparent. Mirrors the main-thread fallback in
 *  imageWorkerClient.ts — keep the two in sync. */
function quantize(data: Uint8ClampedArray<ArrayBuffer>, levels: number): void {
  const step = 255 / (levels - 1);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round(v / step) * step);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

/** Mean structural similarity over 8×8 luma blocks, in [0, 1].
 *
 *  SSIM rather than a plain pixel difference because the question being asked
 *  is "would a person notice", and RMSE answers a different one: it punishes a
 *  uniform brightness shift nobody can see and shrugs at the blocking and
 *  ringing that everybody can. Luma only — chroma error at these quality
 *  levels is well below what the luma term already catches, and dropping it
 *  makes the loop three times cheaper.
 *
 *  Mirrors ssimOnMain in imageWorkerClient.ts — keep the two in sync. */
function ssim(
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
          // Rec. 601 luma, integer-friendly weights.
          const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
          const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
          sumA += la;
          sumB += lb;
          sumAA += la * la;
          sumBB += lb * lb;
          sumAB += la * lb;
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

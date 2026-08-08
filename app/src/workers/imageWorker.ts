/// <reference lib="webworker" />
// PNG color-quantize off the main thread.
//
// The image reducer's only main-thread-blocking step is the O(pixels) LUT
// loop that snaps each RGB channel to `levels` evenly-spaced values (PNG has
// no quality dial, so reduction is lossy color quantization). Everything else
// in the pipeline is already off-thread — `createImageBitmap` (async decode)
// and `canvas.toBlob` (the browser's own off-thread encode). Moving this loop
// here keeps a batch of large PNGs from stuttering the UI.
//
// The pixel buffer is transferred (not copied) both ways — the main thread's
// `getImageData` result is handed over, mutated in place, and handed back, so
// no per-pixel clone cost crosses the boundary.

type QuantizeRequest = {
  id: number;
  /** RGBA pixel buffer, transferred from the main thread. Mutated in place. */
  data: Uint8ClampedArray<ArrayBuffer>;
  levels: number;
};
export type QuantizeResponse = {
  id: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  error?: string;
};

self.onmessage = (event: MessageEvent<QuantizeRequest>) => {
  const { id, data, levels } = event.data;
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

import { saveDialog, pickSaveDirectory, writeBinaryFile } from "@/ipc/dialog";
import { quantizeOffThread, ssimOffThread } from "@/lib/imageWorkerClient";

// ── configuration ───────────────────────────────────────────────────────────
// The two options are quality *floors*, not quality settings. Rather than
// encoding at a fixed quality number and hoping, each variant searches for the
// smallest file whose SSIM against the original still clears its floor — so
// the reduction is as strong as each individual image allows, and no stronger.
// A flat screenshot compresses far past what a noisy photo can take, and a
// fixed 0.5 quality dial had to be conservative enough for the worst case.
//
// Floors are structural-similarity scores in [0,1]:
//   medium  — 0.99  is "diff it and you still won't find it".
//   highest — 0.965 is the accepted "visually lossless" region for photos.
// `highest` is never gentler than `medium`, so its "% smaller" never reads
// lower — the option labelled "highest" is the one that reduces the most.
const SSIM_FLOOR = { highest: 0.965, medium: 0.99 };
// Qualities probed when searching. Coarse on purpose: the SSIM/quality curve is
// flat between neighbours here, and each probe costs an encode plus a decode.
const QUALITY_LADDER = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
// The search runs on a downscaled proxy — quality *ranking* holds at this size
// and a probe costs a millisecond instead of a second. The winning quality is
// then applied to one full-size encode.
const PROXY_MAX_EDGE = 640;
// The full-size encode gets a nudge above what the proxy chose: artifacts the
// proxy's downscale averaged away are visible at 1:1, and half a ladder step
// costs a few percent of file size to buy back the margin.
const FULL_SIZE_QUALITY_BUMP = 0.05;
// Colour levels for the quantized-PNG path, used only where WebP is
// unavailable. 16³ = 4096 colours; below that the banding is visible.
const PNG_FALLBACK_LEVELS = { highest: 12, medium: 16 };
// Browsers can throttle simultaneous downloads from a single gesture; a short
// gap between them lets a "download all" fire each one instead of dropping
// the later ones silently.
export const DOWNLOAD_GAP_MS = 250;

const ACCEPTED_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp",
]);

// ── types ───────────────────────────────────────────────────────────────────
export interface Variant {
  blob: Blob;
  size: number;
  /** What this variant is encoded as — chosen per image, so a PNG can come
   *  back as WebP when that is smaller at the same measured quality. */
  mime: string;
  /** Measured structural similarity against the original, in [0,1]. 1 means a
   *  lossless encode. Surfaced in the UI: the claim is checkable. */
  ssim: number;
  /** True when nothing beat the original, so the original bytes are handed
   *  back untouched rather than a re-encode that made the file bigger. */
  passthrough?: boolean;
}
export type ItemStatus = "pending" | "done" | "error";
export interface ResultItem {
  id: string;
  file: File;
  name: string;
  type: string;
  originalSize: number;
  /** Object URL for the original — used only for the thumbnail preview. */
  originalUrl: string;
  status: ItemStatus;
  highest?: Variant;
  medium?: Variant;
  error?: string;
}
export type VariantKey = "highest" | "medium";

// ── pure helpers (module scope) ─────────────────────────────────────────────
export function isSupported(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type);
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function outputExtFor(mime: string): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  return "jpg";
}

export function makeItem(file: File): ResultItem {
  return {
    id: makeId(),
    file,
    name: file.name,
    type: file.type,
    originalSize: file.size,
    originalUrl: URL.createObjectURL(file),
    status: "pending",
  };
}

export function variantFilename(name: string, variant: VariantKey, mime: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-${variant}.${outputExtFor(mime)}`;
}

/** Strips path separators, control chars, and reserved characters so a
 *  drag-dropped filename can't escape a picked save folder or confuse the OS
 *  save dialog. Keeps the extension intact. */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^[.\\s]+/, "").trim();
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  const base = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const trimmedBase = base.length > 90 ? base.slice(0, 90) : base;
  return (trimmedBase + ext).slice(0, 200);
}

/** Joins a directory and a filename without a Node `path` in the renderer.
 *  `file:writeBinary` normalizes the result in main, so a mixed separator like
 *  `C:\Users\x/photo.png` is accepted. */
function joinPath(dir: string, name: string): string {
  const sep = dir.endsWith("/") || dir.endsWith("\\") ? "" : "/";
  return `${dir}${sep}${name}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function reductionPct(original: number, reduced: number): number {
  if (original <= 0) return 0;
  return Math.round(((original - reduced) / original) * 100);
}

function blobFromCanvas(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
      type,
      quality,
    );
  });
}

/** Whether this browser can *encode* WebP from a canvas. Chromium (so every
 *  Electron build) and current Safari can; the check is a one-pixel encode
 *  because `toDataURL` silently falls back to PNG where it can't. */
let webpEncodable: boolean | null = null;
function supportsWebp(): boolean {
  if (webpEncodable === null) {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    webpEncodable = probe.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpEncodable;
}

function canvasOf(width: number, height: number, readback: boolean): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: readback });
  if (!ctx) throw new Error("canvas unavailable");
  return { canvas, ctx };
}

/** Decodes an encoded blob back to pixels at a known size, so it can be scored
 *  against the original. */
async function pixelsOfBlob(blob: Blob, width: number, height: number): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { ctx } = canvasOf(width, height, true);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data as Uint8ClampedArray<ArrayBuffer>;
  } finally {
    bitmap.close?.();
  }
}

/** JPEG cannot carry transparency, so an image with any translucent pixel must
 *  not be offered a JPEG candidate — it would come back with a black or white
 *  background, which is a correctness failure, not a quality one. */
function hasTransparency(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true;
  }
  return false;
}

interface Probe {
  quality: number;
  size: number;
  ssim: number;
}

/** Encodes the proxy at every quality on the ladder and scores each one. One
 *  sweep serves both variants: the curve is the same, only the floor differs,
 *  so this costs six probes per image rather than six per variant. */
async function probeLadder(
  proxyCanvas: HTMLCanvasElement,
  reference: Uint8ClampedArray<ArrayBuffer>,
  mime: string,
): Promise<Probe[]> {
  const { width, height } = proxyCanvas;
  const probes: Probe[] = [];
  for (const quality of QUALITY_LADDER) {
    try {
      const blob = await blobFromCanvas(proxyCanvas, mime, quality);
      const pixels = await pixelsOfBlob(blob, width, height);
      // Both buffers are transferred to the worker, so the reference has to be
      // copied per probe — it is a 640px proxy, not the full image.
      const score = await ssimOffThread(
        pixels,
        new Uint8ClampedArray(reference) as Uint8ClampedArray<ArrayBuffer>,
        width,
        height,
      );
      probes.push({ quality, size: blob.size, ssim: score });
    } catch {
      // A codec that refuses one quality is not usable; leave it out of the
      // ladder and let the caller fall back to another candidate.
    }
  }
  return probes;
}

/** The lowest quality on the ladder that still clears the floor. Falls back to
 *  the top of the ladder when nothing does — an image too noisy to hit 0.99 at
 *  0.9 quality gets the gentlest encode we have, never a silent quality drop. */
function qualityForFloor(probes: Probe[], floor: number): { quality: number; ssim: number } | null {
  if (!probes.length) return null;
  const pass = probes.find((p) => p.ssim >= floor);
  if (pass) return { quality: pass.quality, ssim: pass.ssim };
  const best = probes[probes.length - 1];
  return { quality: Math.min(0.95, best.quality + FULL_SIZE_QUALITY_BUMP), ssim: best.ssim };
}

/** The quantized-PNG path, kept for browsers with no WebP encoder. Snaps each
 *  channel to `levels` values in a worker, then lets PNG's deflate merge the
 *  now-identical neighbours. */
async function encodeQuantizedPng(bitmap: ImageBitmap, levels: number): Promise<Blob> {
  const { canvas, ctx } = canvasOf(bitmap.width, bitmap.height, true);
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const quantized = await quantizeOffThread(img.data as Uint8ClampedArray<ArrayBuffer>, levels);
  ctx.putImageData(new ImageData(quantized, canvas.width, canvas.height), 0, 0);
  return blobFromCanvas(canvas, "image/png");
}

export async function reduceImage(file: File): Promise<{ highest: Variant; medium: Variant }> {
  // `imageOrientation: "from-image"` applies the EXIF orientation flag so a
  // phone photo isn't re-encoded sideways — the output keeps the orientation
  // the user sees in the preview.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    // The proxy: same picture, small enough that a probe is free.
    const scale = Math.min(1, PROXY_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const proxyW = Math.max(8, Math.round(bitmap.width * scale));
    const proxyH = Math.max(8, Math.round(bitmap.height * scale));
    const { canvas: proxy, ctx: proxyCtx } = canvasOf(proxyW, proxyH, true);
    proxyCtx.drawImage(bitmap, 0, 0, proxyW, proxyH);
    const reference = proxyCtx.getImageData(0, 0, proxyW, proxyH).data as Uint8ClampedArray<ArrayBuffer>;

    const transparent = hasTransparency(reference);
    const webp = supportsWebp();
    // WebP beats JPEG at equal measured quality and, unlike JPEG, keeps alpha —
    // so where it exists it is the only lossy candidate worth probing. JPEG is
    // the fallback, and only for opaque images.
    const lossyMime = webp ? "image/webp" : transparent ? null : "image/jpeg";
    const graphicSource = file.type === "image/png" || file.type === "image/bmp";

    const probes = lossyMime ? await probeLadder(proxy, reference, lossyMime) : [];

    // A lossless candidate for flat artwork — screenshots and diagrams often
    // encode smaller losslessly than any lossy setting that still clears 0.99,
    // and lossless needs no quality argument at all.
    let lossless: Blob | null = null;
    if (graphicSource && webp) {
      try {
        // Chromium encodes WebP losslessly at quality 1.
        lossless = await blobFromCanvas(await fullCanvas(bitmap), "image/webp", 1);
      } catch {
        lossless = null;
      }
    }

    const build = async (key: VariantKey): Promise<Variant> => {
      const floor = SSIM_FLOOR[key];
      const candidates: Variant[] = [];

      const pick = lossyMime ? qualityForFloor(probes, floor) : null;
      if (lossyMime && pick) {
        const quality = Math.min(0.98, pick.quality + FULL_SIZE_QUALITY_BUMP);
        const full = await fullCanvas(bitmap);
        const blob = await blobFromCanvas(full, lossyMime, quality);
        candidates.push({ blob, size: blob.size, mime: lossyMime, ssim: pick.ssim });
      }
      if (lossless) {
        candidates.push({ blob: lossless, size: lossless.size, mime: "image/webp", ssim: 1 });
      }
      if (!lossyMime && !lossless) {
        // No WebP encoder and a transparent source: the old quantized-PNG path.
        const blob = await encodeQuantizedPng(bitmap, PNG_FALLBACK_LEVELS[key]);
        const pixels = await pixelsOfBlob(blob, proxyW, proxyH);
        const score = await ssimOffThread(
          pixels,
          new Uint8ClampedArray(reference) as Uint8ClampedArray<ArrayBuffer>,
          proxyW,
          proxyH,
        );
        candidates.push({ blob, size: blob.size, mime: "image/png", ssim: score });
      }

      const best = candidates
        .filter((c) => c.size > 0)
        .sort((a, b) => a.size - b.size)[0];
      // Nothing beat the source: hand the original bytes back rather than a
      // "reduced" file that is larger. The card then reads "no savings", which
      // is the truth about this image.
      if (!best || best.size >= file.size) {
        return { blob: file, size: file.size, mime: file.type, ssim: 1, passthrough: true };
      }
      return best;
    };

    const medium = await build("medium");
    const highest = await build("highest");
    // Guarantee the labelling: "highest" must never be the larger of the two.
    return highest.size <= medium.size
      ? { highest, medium }
      : { highest: medium, medium: highest };
  } finally {
    bitmap.close?.();
  }
}

/** A full-resolution canvas with the bitmap drawn into it. Made fresh per
 *  encode: `toBlob` is async and two encodes sharing one canvas would race. */
async function fullCanvas(bitmap: ImageBitmap): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = canvasOf(bitmap.width, bitmap.height, false);
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

// ── saving ─────────────────────────────────────────────────────────────────
// On desktop a save is completion-aware: the user picks a destination in a
// real OS dialog and the main process flushes the bytes to disk before the
// promise resolves, so a success toast is a true claim. On the web there is
// no such signal — `<a download>` only dispatches the download and the
// browser's own success/failure is invisible to JS — so we say "started",
// never "downloaded", and only surface a failure we can actually detect
// (an empty blob or a blocked opener).

export type SaveOutcome = "ok" | "fail" | "cancelled";

/** Web fallback: trigger an anchor-click download. Returns true if the click
 *  dispatched, false for a detectable failure (empty blob or a thrown
 *  opener). The browser's actual completion is not observable. */
export function triggerWebDownload(blob: Blob, filename: string): boolean {
  try {
    if (!blob || blob.size === 0) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch {
    return false;
  }
}

/** Desktop single: Save-As dialog → write bytes → resolves on disk flush. */
export async function saveOneDesktop(blob: Blob, filename: string, ext: string): Promise<SaveOutcome> {
  let dest: string | null;
  try {
    dest = await saveDialog({
      defaultPath: sanitizeFilename(filename),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
  } catch {
    return "fail";
  }
  if (!dest) return "cancelled";
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeBinaryFile(dest, bytes);
    return "ok";
  } catch {
    return "fail";
  }
}

/** Desktop bulk: pick a folder once, write every file into it. Names are
 *  de-duplicated so two `photo.jpg` entries don't clobber each other. */
export async function saveAllDesktop(
  entries: { blob: Blob; filename: string }[],
): Promise<{ ok: number; fail: number } | "cancelled"> {
  let dir: string | null;
  try {
    dir = await pickSaveDirectory();
  } catch {
    return { ok: 0, fail: entries.length };
  }
  if (!dir) return "cancelled";
  let ok = 0;
  let fail = 0;
  const used = new Set<string>();
  for (const entry of entries) {
    let name = sanitizeFilename(entry.filename);
    // Disambiguate collisions inside the picked folder.
    if (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${base}-${n}${ext}`.toLowerCase())) n++;
      name = `${base}-${n}${ext}`;
    }
    used.add(name.toLowerCase());
    try {
      const bytes = new Uint8Array(await entry.blob.arrayBuffer());
      await writeBinaryFile(joinPath(dir, name), bytes);
      ok++;
    } catch {
      fail++;
    }
  }
  return { ok, fail };
}

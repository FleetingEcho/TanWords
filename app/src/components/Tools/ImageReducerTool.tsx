import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Download, ImageMinus, Loader2, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { isDesktopHost } from "@/platform";
import { saveDialog, pickSaveDirectory, writeBinaryFile } from "@/ipc/dialog";
import { quantizeOffThread, ssimOffThread } from "@/lib/imageWorkerClient";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { AssetPicker } from "./AssetPicker";

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
const DOWNLOAD_GAP_MS = 250;

const ACCEPTED_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp",
]);

// ── types ───────────────────────────────────────────────────────────────────
interface Variant {
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
type ItemStatus = "pending" | "done" | "error";
interface ResultItem {
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
type VariantKey = "highest" | "medium";

// ── pure helpers (module scope) ─────────────────────────────────────────────
function isSupported(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type);
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function outputExtFor(mime: string): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  return "jpg";
}

function makeItem(file: File): ResultItem {
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

function variantFilename(name: string, variant: VariantKey, mime: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-${variant}.${outputExtFor(mime)}`;
}

/** Strips path separators, control chars, and reserved characters so a
 *  drag-dropped filename can't escape a picked save folder or confuse the OS
 *  save dialog. Keeps the extension intact. */
function sanitizeFilename(name: string): string {
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function reductionPct(original: number, reduced: number): number {
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

async function reduceImage(file: File): Promise<{ highest: Variant; medium: Variant }> {
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

type SaveOutcome = "ok" | "fail" | "cancelled";

/** Web fallback: trigger an anchor-click download. Returns true if the click
 *  dispatched, false for a detectable failure (empty blob or a thrown
 *  opener). The browser's actual completion is not observable. */
function triggerWebDownload(blob: Blob, filename: string): boolean {
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
async function saveOneDesktop(blob: Blob, filename: string, ext: string): Promise<SaveOutcome> {
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
async function saveAllDesktop(
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

// ── small presentational pieces ─────────────────────────────────────────────

/** Rolls a byte figure up to its new value instead of swapping it. The number
 *  is the whole point of the tool, so it gets to move when it changes. */
function useCountUp(value: number, ms = 600): number {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    if (typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** The batch readout. One track the width of everything you fed in, with both
 *  reductions drawn on it — the tool's whole claim in one line, rather than a
 *  number you'd have to add up across the cards yourself. */
function SummaryPanel({ items }: { items: ResultItem[] }) {
  const t = useT();
  const done = items.filter((i) => i.status === "done" && i.highest && i.medium);
  const original = done.reduce((n, i) => n + i.originalSize, 0);
  const highest = done.reduce((n, i) => n + i.highest!.size, 0);
  const medium = done.reduce((n, i) => n + i.medium!.size, 0);
  const saved = useCountUp(Math.max(0, original - highest));
  if (!done.length || original <= 0) return null;

  const highPct = Math.min(100, (highest / original) * 100);
  const medPct = Math.min(100, (medium / original) * 100);

  return (
    <div className="animate-fade-in rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="font-serif text-4xl font-bold leading-none tracking-tight tabular-nums">
            {formatBytes(Math.round(saved))}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("toolsPage.imageReducer.savedTotal")} ·{" "}
            {t("toolsPage.imageReducer.fromTotal", { size: formatBytes(original) })}
          </p>
        </div>
        <div className="flex gap-5 text-right">
          {([["highest", highest, highPct], ["medium", medium, medPct]] as const).map(
            ([key, bytes, pct]) => (
              <div key={key}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(`toolsPage.imageReducer.${key}`)}
                </p>
                <p className="mt-0.5 text-sm font-medium tabular-nums">{formatBytes(bytes)}</p>
                <p className={`text-[11px] font-semibold tabular-nums ${key === "highest" ? "text-primary" : "text-primary/70"}`}>
                  −{Math.round(100 - pct)}%
                </p>
              </div>
            ),
          )}
        </div>
      </div>

      {/* The track is the original; the two fills are what is left of it. The
        * empty stretch to the right is the part that went away, which is the
        * only quantity anyone actually wants to look at. */}
      <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary/25 transition-[width] duration-700 ease-out"
          style={{ width: `${medPct}%` }}
        />
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${highPct}%` }}
        />
      </div>
    </div>
  );
}

/** A variant, as a bar you can click. The fill is the reduced file drawn to
 *  scale inside the original, so the shorter bar is plainly the smaller file —
 *  no reading of two numbers required to see which is which. */
function VariantBar({
  label,
  variant,
  originalSize,
  strong,
  onDownload,
}: {
  label: string;
  variant: Variant;
  originalSize: number;
  strong: boolean;
  onDownload: () => void;
}) {
  const t = useT();
  const pct = reductionPct(originalSize, variant.size);
  const remaining = originalSize > 0 ? Math.min(100, (variant.size / originalSize) * 100) : 100;
  return (
    <button
      type="button"
      onClick={onDownload}
      title={t("toolsPage.imageReducer.download")}
      className="group/v relative w-full overflow-hidden rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/60"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out ${
          strong ? "bg-primary/15" : "bg-primary/8"
        }`}
        style={{ width: `${remaining}%` }}
      />
      <span className="relative flex items-center gap-2">
        <span className="text-xs font-medium">{label}</span>
        {/* The format is per-variant now, so it is named where it is chosen —
          * a PNG that came back as WebP says so on the row you download. */}
        <span className="rounded bg-muted px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
          {outputExtFor(variant.mime)}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {t("toolsPage.imageReducer.quality", { pct: Math.round(variant.ssim * 100) })}
        </span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {formatBytes(variant.size)}
        </span>
        <span
          className={`w-12 text-right text-[11px] font-semibold tabular-nums ${
            pct > 0 ? (strong ? "text-primary" : "text-primary/70") : "text-muted-foreground"
          }`}
        >
          {pct > 0 ? `−${pct}%` : t("toolsPage.imageReducer.noSavings")}
        </span>
        <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity duration-150 sm:opacity-0 sm:group-hover/v:opacity-100" />
      </span>
    </button>
  );
}

function ResultCard({
  item,
  onRemove,
  onDownload,
}: {
  item: ResultItem;
  onRemove: () => void;
  onDownload: (variant: VariantKey) => void;
}) {
  const t = useT();
  return (
    <article className="group animate-fade-in overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/30">
      {/* The picture leads. A 64px thumbnail beside two grey rows makes the
        * file look like a database record; at this size you can see what you
        * are about to compress. */}
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        <img
          src={item.originalUrl}
          alt={item.name}
          loading="lazy"
          className={`h-full w-full object-cover transition-[transform,filter] duration-500 ease-out group-hover:scale-[1.03] ${
            item.status === "pending" ? "scale-105 blur-[2px] saturate-50" : ""
          }`}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white drop-shadow">{item.name}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-white/70">
              {formatBytes(item.originalSize)}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          title={t("toolsPage.imageReducer.remove")}
          aria-label={t("toolsPage.imageReducer.remove")}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition-[opacity,background-color] duration-150 hover:bg-destructive hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {item.status === "pending" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/35 backdrop-blur-[1px]">
            <span className="flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-[11px] font-medium shadow-sm">
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
              {t("toolsPage.imageReducer.processing")}
            </span>
          </div>
        )}
        {item.status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-destructive/15 backdrop-blur-[1px]">
            <span className="rounded-full bg-background/85 px-3 py-1.5 text-[11px] font-medium text-destructive shadow-sm">
              {t("toolsPage.imageReducer.error")}
            </span>
          </div>
        )}
      </div>

      {item.status === "done" && item.highest && item.medium && (
        <div className="space-y-0.5 p-2">
          <VariantBar
            label={t("toolsPage.imageReducer.highest")}
            variant={item.highest}
            originalSize={item.originalSize}
            strong
            onDownload={() => onDownload("highest")}
          />
          <VariantBar
            label={t("toolsPage.imageReducer.medium")}
            variant={item.medium}
            originalSize={item.originalSize}
            strong={false}
            onDownload={() => onDownload("medium")}
          />
        </div>
      )}
    </article>
  );
}

// ── the tool ────────────────────────────────────────────────────────────────
export function ImageReducerTool({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [items, setItems] = useState<ResultItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A ref-backed queue + busy lock keeps processing serial even when files
  // arrive in several batches (drop, then drop again while the first batch is
  // still encoding). State alone can't gate this — addFiles would otherwise
  // start a second concurrent loop racing the first.
  const queueRef = useRef<ResultItem[]>([]);
  const busyRef = useRef(false);

  const doneCount = items.filter((i) => i.status === "done").length;
  // Items still encoding (not done, not errored). Drives the batch progress
  // chip — useful once a drop is large enough that the per-card spinners alone
  // don't convey how far along the whole batch is.
  const pendingCount = items.filter((i) => i.status === "pending").length;
  // What each variant would cost as a batch — shown in the download menu so the
  // pick is made against the numbers rather than against two adjectives.
  const totals = {
    highest: items.reduce((n, i) => n + (i.highest?.size ?? 0), 0),
    medium: items.reduce((n, i) => n + (i.medium?.size ?? 0), 0),
  };

  // Keep a live mirror of items for the unmount cleanup so the object URLs we
  // created for previews are actually released.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => {
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.originalUrl));
    },
    [],
  );

  async function runQueue() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      while (queueRef.current.length) {
        const item = queueRef.current.shift()!;
        try {
          const { highest, medium } = await reduceImage(item.file);
          setItems((prev) =>
            prev.map((x) =>
              x.id === item.id ? { ...x, status: "done", highest, medium } : x,
            ),
          );
        } catch (err) {
          setItems((prev) =>
            prev.map((x) =>
              x.id === item.id
                ? { ...x, status: "error", error: err instanceof Error ? err.message : String(err) }
                : x,
            ),
          );
        }
        // Yield so per-item spinners/results paint and the UI stays responsive
        // while a large batch encodes.
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      busyRef.current = false;
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(isSupported);
    if (!files.length) return;
    const newItems = files.map(makeItem);
    setItems((prev) => [...prev, ...newItems]);
    queueRef.current.push(...newItems);
    void runQueue();
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.originalUrl);
      // Also drop it from the queue if it hasn't started yet.
      queueRef.current = queueRef.current.filter((x) => x.id !== id);
      return prev.filter((x) => x.id !== id);
    });
  }

  function clearAll() {
    queueRef.current = [];
    setItems((prev) => {
      prev.forEach((it) => URL.revokeObjectURL(it.originalUrl));
      return [];
    });
  }

  async function downloadOne(item: ResultItem, variant: VariantKey) {
    if (downloading) return; // a bulk save is in flight — ignore the per-card click
    const v = item[variant];
    if (!v) return;
    const filename = variantFilename(item.name, variant, v.mime);
    const ext = outputExtFor(v.mime);
    if (isDesktopHost) {
      setDownloading(true);
      try {
        const outcome = await saveOneDesktop(v.blob, filename, ext);
        if (outcome === "ok") toast.success(t("toolsPage.imageReducer.downloadOk", { name: filename }));
        else if (outcome === "fail") toast.error(t("toolsPage.imageReducer.downloadFail", { name: filename }));
        // "cancelled" (user dismissed the Save-As dialog) stays silent.
      } finally {
        setDownloading(false);
      }
      return;
    }
    // Web: the browser's completion is not observable, so this is an honest
    // "started" notice, not a success claim.
    if (triggerWebDownload(v.blob, sanitizeFilename(filename))) {
      toast.info(t("toolsPage.imageReducer.downloadStarted", { name: filename }));
    } else {
      toast.error(t("toolsPage.imageReducer.downloadFail", { name: filename }));
    }
  }

  async function downloadAll(variant: VariantKey) {
    if (downloading) return;
    const targets = itemsRef.current.filter(
      (i) => i.status === "done" && i[variant],
    ) as ResultItem[];
    if (!targets.length) return;
    setDownloading(true);
    try {
      const entries = targets.map((item) => ({
        blob: item[variant]!.blob,
        filename: variantFilename(item.name, variant, item[variant]!.mime),
      }));
      if (isDesktopHost) {
        const result = await saveAllDesktop(entries);
        if (result === "cancelled") return; // dismissed the folder picker
        const { ok, fail } = result;
        if (ok === 0) toast.error(t("toolsPage.imageReducer.downloadAllFail"));
        else if (fail === 0) toast.success(t("toolsPage.imageReducer.downloadAllOk", { n: ok }));
        else toast.warning(t("toolsPage.imageReducer.downloadAllPartial", { ok, total: ok + fail }));
        return;
      }
      // Web: sequential anchor-click (browsers may prompt to allow multiple
      // downloads). We can only confirm they were *triggered*, not completed.
      let started = 0;
      let failedToStart = 0;
      for (const entry of entries) {
        if (triggerWebDownload(entry.blob, sanitizeFilename(entry.filename))) started++;
        else failedToStart++;
        await new Promise((r) => setTimeout(r, DOWNLOAD_GAP_MS));
      }
      if (started === 0) toast.error(t("toolsPage.imageReducer.downloadAllFail"));
      else if (failedToStart === 0)
        toast.info(t("toolsPage.imageReducer.downloadAllStarted", { n: started }));
      else
        toast.warning(
          t("toolsPage.imageReducer.downloadAllStartedWithFailed", { n: started, failed: failedToStart }),
        );
    } finally {
      setDownloading(false);
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length) addFiles(files);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length) addFiles(files);
    // Reset so selecting the same file again still fires onChange.
    e.target.value = "";
  };

  const empty = items.length === 0;

  return (
    <div
      // The whole page is a drop target — a user with a folder open isn't
      // aiming for the dashed box, they're aiming for the page.
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the container itself, not a child element.
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
      className="relative w-full animate-fade-in space-y-5 p-4 sm:p-6"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          title={t("toolsPage.back")}
          aria-label={t("toolsPage.back")}
          className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-2xl font-bold tracking-tight">
            {t("toolsPage.imageReducer.title")}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("toolsPage.imageReducer.description")}
          </p>
        </div>
        {/* The three-sentence explanation of quantization is worth having and
          * not worth reading twice, so it folds away after the first time. */}
        <button
          type="button"
          onClick={() => setHowOpen((v) => !v)}
          aria-expanded={howOpen}
          className="shrink-0 rounded-full border border-border px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {t("toolsPage.imageReducer.howLabel")}
        </button>
      </div>
      {howOpen && (
        <p className="animate-fade-in rounded-xl border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          {t("toolsPage.imageReducer.howItWorks")}
        </p>
      )}

      {/* Hidden input driven by the drop zone and the toolbar buttons */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/bmp"
        className="hidden"
        onChange={onInputChange}
      />

      {/* The invitation is large while there is nothing to show and gone once
        * there is — the results are what you came back to look at, and a
        * permanent dashed box would keep pushing them below the fold. */}
      {empty ? (
        <div
          onClick={() => inputRef.current?.click()}
          className={`relative cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed p-10 text-center transition-colors sm:p-16 ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-[hsl(var(--muted))]/50"
          }`}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_70%)]"
          />
          <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm">
            <ImageMinus className="h-7 w-7" />
          </span>
          <p className="relative mt-5 text-base font-semibold">{t("toolsPage.imageReducer.dropHint")}</p>
          <p className="relative mt-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("toolsPage.imageReducer.dropFormats")}
          </p>
          <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button
              className="h-9"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              {t("toolsPage.imageReducer.selectFiles")}
            </Button>
            <Button
              variant="ghost"
              className="h-9"
              onClick={(e) => {
                e.stopPropagation();
                setPickerOpen(true);
              }}
            >
              {t("toolsPage.imageReducer.pickFromLibrary")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <SummaryPanel items={items} />

          {/* Sticks to the top of the scroll area: with a long batch the
            * download controls are otherwise scrolled away exactly when
            * everything has finished and you want them.
            *
            * Three controls, not five. Five equally-weighted buttons wrapping
            * onto a second row make the reader rank them, and only one of them
            * is what anyone came here to press. Add stays out because it is the
            * common one; the variant choice folds into the download button
            * itself (it is a property of the download, not a separate errand);
            * library and clear go behind the overflow. */}
          <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-xl bg-background/85 px-1 py-2 backdrop-blur-md">
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground">
              {t("toolsPage.imageReducer.count", { n: items.length })}
            </span>
            {pendingCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium tabular-nums text-primary">
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                {t("toolsPage.imageReducer.progress", { done: doneCount, total: items.length })}
              </span>
            )}
            <div className="flex-1" />

            <Button variant="outline" size="sm" className="h-8" onClick={() => inputRef.current?.click()} disabled={downloading}>
              <Plus className="h-3.5 w-3.5" />
              <span className="ml-1.5 hidden sm:inline">{t("toolsPage.imageReducer.addMore")}</span>
            </Button>

            {doneCount > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="h-8" disabled={downloading}>
                    {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    <span className="ml-1.5">
                      {downloading ? t("toolsPage.imageReducer.downloading") : t("toolsPage.imageReducer.downloadAll")}
                    </span>
                    <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                {/* The menu carries the totals, so the choice between the two
                  * variants is made against the numbers it turns on. */}
                <DropdownMenuContent align="end" className="min-w-56">
                  {(["highest", "medium"] as const).map((key) => (
                    <DropdownMenuItem key={key} onSelect={() => void downloadAll(key)}>
                      <span className="font-medium">{t(`toolsPage.imageReducer.${key}`)}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {formatBytes(totals[key])}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground"
                  disabled={downloading}
                  aria-label={t("toolsPage.imageReducer.moreActions")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
                  <ImageMinus className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("toolsPage.imageReducer.pickFromLibrary")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={clearAll} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("toolsPage.imageReducer.clearAll")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <ResultCard
                key={item.id}
                item={item}
                onRemove={() => removeItem(item.id)}
                onDownload={(variant) => downloadOne(item, variant)}
              />
            ))}
          </div>
        </>
      )}

      {/* Drag feedback covers the page rather than tinting a box, because the
        * page is what accepts the drop. */}
      {dragging && !empty && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="rounded-3xl border-2 border-dashed border-primary bg-card/90 px-10 py-8 text-center shadow-2xl">
            <ImageMinus className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-3 text-sm font-semibold">{t("toolsPage.imageReducer.releaseToDrop")}</p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("toolsPage.imageReducer.dropFormats")}
            </p>
          </div>
        </div>
      )}

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(files) => {
          setPickerOpen(false);
          addFiles(files);
        }}
      />
    </div>
  );
}

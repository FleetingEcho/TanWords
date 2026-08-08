import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Download, ImageMinus, Loader2, Trash2, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { isDesktopHost } from "@/platform";
import { saveDialog, pickSaveDirectory, writeBinaryFile } from "@/ipc/dialog";
import { quantizeOffThread } from "@/lib/imageWorkerClient";
import { AssetPicker } from "./AssetPicker";

// ── configuration ───────────────────────────────────────────────────────────
// This is a *size reducer*, so the two options describe REDUCTION strength,
// not quality: "highest" is the strongest reduction (smallest file), "medium"
// is a moderate reduction (better quality, larger file). JPEG/WebP are reduced
// with a quality dial; PNG/BMP have no quality dial so reduction is done by
// lossy color quantization — each channel snapped to `levels` evenly-spaced
// values, which collapses near-duplicate colours PNG's deflate then merges.
//
// `highest` is always at least as strong as `medium`, so its "% smaller"
// never reads lower than medium's — the option labelled "highest" is the one
// that reduces the most.
const PNG_LEVELS = { highest: 6, medium: 16 }; // 6³ = 216 / 16³ = 4096 colours
const LOSSY_QUALITY = { highest: 0.5, medium: 0.72 }; // JPEG/WebP quality
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
  /** MIME type the variants are encoded as. Same as the input for
   *  png/jpeg/webp; BMP becomes PNG since browsers can't encode BMP, and the
   *  color-quantize path applies to it too. */
  outMime: string;
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

/** The format we re-encode into. PNG and BMP both target PNG (lossless →
 *  quantize helps); JPEG/JPG target JPEG; WebP targets WebP. */
function outputMimeFor(inputType: string): string {
  if (inputType === "image/webp") return "image/webp";
  if (inputType === "image/png" || inputType === "image/bmp") return "image/png";
  return "image/jpeg";
}

function outputExtFor(mime: string): string {
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  return "jpg";
}

/** True for output formats reduced by color quantization (PNG). JPEG/WebP use
 *  the quality dial instead. */
function isQuantizedTarget(mime: string): boolean {
  return mime === "image/png";
}

function makeItem(file: File): ResultItem {
  return {
    id: makeId(),
    file,
    name: file.name,
    type: file.type,
    originalSize: file.size,
    originalUrl: URL.createObjectURL(file),
    outMime: outputMimeFor(file.type),
    status: "pending",
  };
}

function variantFilename(name: string, variant: VariantKey, outMime: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-${variant}.${outputExtFor(outMime)}`;
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

async function encodeVariant(
  bitmap: ImageBitmap,
  outMime: string,
  levels: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const quantize = isQuantizedTarget(outMime);
  // `willReadFrequently` only matters for the quantize path (getImageData);
  // setting it for the lossy path is harmless and keeps one code path.
  const ctx = canvas.getContext("2d", { willReadFrequently: quantize });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  if (quantize) {
    // The only main-thread-blocking step in the whole pipeline: the O(pixels)
    // color-quantize LUT loop. It runs in a Web Worker (see
    // lib/imageWorkerClient.ts) and the pixel buffer is transferred both ways,
    // so a batch of large PNGs can't stutter the UI. Falls back to the main
    // thread where `Worker` is unavailable.
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const quantized = await quantizeOffThread(img.data, levels);
    const out = new ImageData(quantized, canvas.width, canvas.height);
    ctx.putImageData(out, 0, 0);
    return blobFromCanvas(canvas, "image/png");
  }
  return blobFromCanvas(canvas, outMime, quality);
}

async function reduceImage(file: File): Promise<{ highest: Variant; medium: Variant }> {
  const outMime = outputMimeFor(file.type);
  // `imageOrientation: "from-image"` applies the EXIF orientation flag so a
  // phone photo isn't re-encoded sideways — the output keeps the orientation
  // the user sees in the preview.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const [highestBlob, mediumBlob] = await Promise.all([
      encodeVariant(bitmap, outMime, PNG_LEVELS.highest, LOSSY_QUALITY.highest),
      encodeVariant(bitmap, outMime, PNG_LEVELS.medium, LOSSY_QUALITY.medium),
    ]);
    return {
      highest: { blob: highestBlob, size: highestBlob.size },
      medium: { blob: mediumBlob, size: mediumBlob.size },
    };
  } finally {
    bitmap.close?.();
  }
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
function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
      {label}
    </div>
  );
}

function VariantRow({
  label,
  variant,
  originalSize,
  onDownload,
}: {
  label: string;
  variant: Variant;
  originalSize: number;
  onDownload: () => void;
}) {
  const t = useT();
  const pct = reductionPct(originalSize, variant.size);
  const savings = pct > 0;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{label}</span>
          {savings ? (
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              {t("toolsPage.imageReducer.reduction", { percent: pct })}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              {t("toolsPage.imageReducer.noSavings")}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">{formatBytes(variant.size)}</p>
      </div>
      <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={onDownload}>
        <Download className="h-3.5 w-3.5" />
        <span className="ml-1.5 hidden sm:inline">{t("toolsPage.imageReducer.download")}</span>
      </Button>
    </div>
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
  // When the output format differs from the input (BMP -> PNG), call it out so
  // the changed extension on download isn't a surprise.
  const formatChanged =
    item.outMime !== "image/png" ? false : item.type !== "image/png" && item.type !== "image/bmp";
  return (
    <div className="relative bg-card border border-border rounded-2xl p-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        title={t("toolsPage.imageReducer.remove")}
        aria-label={t("toolsPage.imageReducer.remove")}
        className="absolute right-2 top-2 h-7 w-7 rounded-md text-muted-foreground hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </Button>
      <div className="flex gap-3 pr-6">
        <img
          src={item.originalUrl}
          alt={item.name}
          className="h-16 w-16 shrink-0 rounded-lg object-cover bg-muted"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate text-sm">{item.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("toolsPage.imageReducer.original")}:{" "}
            <span className="tabular-nums">{formatBytes(item.originalSize)}</span>
            {formatChanged && (
              <span className="ml-2 text-[10px] text-primary">
                → .{outputExtFor(item.outMime)}
              </span>
            )}
          </p>
        </div>
      </div>

      {item.status === "pending" && <Spinner label={t("toolsPage.imageReducer.processing")} />}
      {item.status === "error" && (
        <p className="mt-3 text-xs text-destructive">{t("toolsPage.imageReducer.error")}</p>
      )}
      {item.status === "done" && item.highest && item.medium && (
        <div className="mt-3 space-y-2">
          <VariantRow
            label={t("toolsPage.imageReducer.highest")}
            variant={item.highest}
            originalSize={item.originalSize}
            onDownload={() => onDownload("highest")}
          />
          <VariantRow
            label={t("toolsPage.imageReducer.medium")}
            variant={item.medium}
            originalSize={item.originalSize}
            onDownload={() => onDownload("medium")}
          />
        </div>
      )}
    </div>
  );
}

// ── the tool ────────────────────────────────────────────────────────────────
export function ImageReducerTool({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [items, setItems] = useState<ResultItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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
    const filename = variantFilename(item.name, variant, item.outMime);
    const ext = outputExtFor(item.outMime);
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
        filename: variantFilename(item.name, variant, item.outMime),
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
      className={`relative p-4 sm:p-6 space-y-4 animate-fade-in w-full rounded-2xl transition-colors ${
        dragging ? "ring-2 ring-primary ring-inset bg-primary/5" : ""
      }`}
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
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{t("toolsPage.imageReducer.title")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {t("toolsPage.imageReducer.howItWorks")}
          </p>
        </div>
      </div>

      {/* Hidden input driven by the drop zone and the toolbar buttons */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/bmp"
        className="hidden"
        onChange={onInputChange}
      />

      {/* Drop / select zone */}
      <div
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors ${
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-accent/30"
        }`}
      >
        <ImageMinus className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">{t("toolsPage.imageReducer.dropHint")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("toolsPage.imageReducer.dropFormats")}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="outline"
            className="h-9"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            {items.length
              ? t("toolsPage.imageReducer.addMore")
              : t("toolsPage.imageReducer.selectFiles")}
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

      {/* Toolbar — only once there is something to act on */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {t("toolsPage.imageReducer.count", { n: items.length })}
          </span>
          {pendingCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
              <span className="h-3 w-3 shrink-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              {t("toolsPage.imageReducer.progress", { done: doneCount, total: items.length })}
            </span>
          )}
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => inputRef.current?.click()}
            disabled={downloading}
          >
            {t("toolsPage.imageReducer.addMore")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setPickerOpen(true)}
            disabled={downloading}
          >
            {t("toolsPage.imageReducer.pickFromLibrary")}
          </Button>
          {doneCount > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void downloadAll("highest")}
                disabled={downloading}
              >
                {downloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">
                  {downloading
                    ? t("toolsPage.imageReducer.downloading")
                    : t("toolsPage.imageReducer.downloadAllHighest")}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void downloadAll("medium")}
                disabled={downloading}
              >
                <Download className="h-3.5 w-3.5" />
                <span className="ml-1.5">{t("toolsPage.imageReducer.downloadAllMedium")}</span>
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground hover:text-destructive"
            onClick={clearAll}
            disabled={downloading}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="ml-1.5">{t("toolsPage.imageReducer.clearAll")}</span>
          </Button>
        </div>
      )}

      {/* Results — responsive grid */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item) => (
            <ResultCard
              key={item.id}
              item={item}
              onRemove={() => removeItem(item.id)}
              onDownload={(variant) => downloadOne(item, variant)}
            />
          ))}
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

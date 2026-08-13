import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Download, ImageMinus, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { isDesktopHost } from "@/platform";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { AssetPicker } from "./AssetPicker";
import { SummaryPanel, ResultCard } from "./ImageReducerParts";
import type { ResultItem, VariantKey } from "./imageReducerEngine";
import {
  DOWNLOAD_GAP_MS,
  formatBytes,
  isSupported,
  makeItem,
  outputExtFor,
  reduceImage,
  sanitizeFilename,
  saveAllDesktop,
  saveOneDesktop,
  triggerWebDownload,
  variantFilename,
} from "./imageReducerEngine";

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

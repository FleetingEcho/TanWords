import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import type { ResultItem, Variant, VariantKey } from "./imageReducerEngine";
import { formatBytes, outputExtFor, reductionPct } from "./imageReducerEngine";

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
export function SummaryPanel({ items }: { items: ResultItem[] }) {
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

export function ResultCard({
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

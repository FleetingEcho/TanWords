import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";
import { BannerPosition, DEFAULT_BANNER_POSITION, BANNER_ZOOM_MIN, BANNER_ZOOM_MAX } from "@/store/settingsStore";
import { coverOverflow, dragToPosition, zoomedOverflow, Size } from "./bannerFraming";

/** The dashboard banner is a full-width strip 200px tall, which lands around 6:1 on a
 *  typical window. The frame below uses that shape so the band the user drags into view
 *  is the band the dashboard shows — exactness doesn't matter much, since the stored
 *  percentages are relative to whatever overflow the real banner ends up having. */
const BANNER_FRAME_ASPECT = 6;

/** Arrow-key nudge, in object-position percentage points (×5 with Shift). */
const KEY_STEP = 2;
/** Wheel-to-zoom step per notch; the slider uses the same granularity. */
const ZOOM_STEP = 0.05;

interface Props {
  open: boolean;
  /** The image being framed, as a data URL. */
  src: string;
  /** Framing to open with — the stored one when re-adjusting, centred for a new image. */
  initial: BannerPosition;
  onCancel: () => void;
  onConfirm: (position: BannerPosition) => void;
  /** Defaults to the Dashboard banner's wide frame; wallpapers use 16:9. */
  frameAspect?: number;
  title?: string;
  hint?: string;
  fitsHint?: string;
  /** Offers the zoom slider/wheel-zoom on top of the existing drag-to-pan.
   *  Off by default — the dashboard banner usage doesn't pass this, so its
   *  behavior (and every stored `BannerPosition` it already has, which
   *  predates `scale`) is completely unchanged. The app background wallpaper
   *  passes `true`. */
  allowZoom?: boolean;
}

/**
 * Drag-to-choose-the-visible-band dialog, optionally with zoom.
 *
 * The frame is rarely the same shape as the photo, so `object-fit: cover` has to throw
 * away part of the image — previously always the top and bottom, which is how you end up
 * with a banner of someone's forehead. This hands that decision to the user, and (when
 * `allowZoom`) lets them additionally zoom in past cover's minimum to pick a tighter crop.
 *
 * The preview is rendered with the very same `object-fit: cover` + `object-position` the
 * real surface uses, rather than by positioning a scaled image by hand: it is WYSIWYG by
 * construction, and — the reason it works this way — the picture still shows even if the
 * measuring below comes up empty. Measurements only decide how far a drag moves and
 * whether there is anything to drag at all. Zoom is layered on as a *second*, outer
 * `transform: scale()` anchored at the same `x%,y%` as the pan — see the render below —
 * so it composes with the existing WYSIWYG object-position approach instead of replacing
 * it, and stays lossless: nothing here ever re-encodes the image, only how much of it (and
 * how magnified) the frame currently shows.
 */
export function BannerPositionModal({
  open, src, initial, onCancel, onConfirm,
  frameAspect = BANNER_FRAME_ASPECT,
  title, hint, fitsHint,
  allowZoom = false,
}: Props) {
  const t = useT();
  const [pos, setPos] = useState(initial);
  const [frame, setFrame] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const drag = useRef<{ px: number; py: number; from: BannerPosition } | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  // Each opening starts from the stored framing, never from wherever the previous drag
  // was abandoned — and a different image starts over entirely.
  useEffect(() => {
    if (open) setPos(initial);
  }, [open, src, initial]);

  // The image's own size, from a probe rather than an `onLoad` on the rendered <img>: the
  // probe's listener is attached before its src, so there is no window in which the load
  // event can arrive before anything is listening, and no reset racing it.
  useEffect(() => {
    setNatural(null);
    if (!open || !src) return;
    let alive = true;
    const probe = new Image();
    probe.onload = () => {
      if (alive) setNatural({ w: probe.naturalWidth, h: probe.naturalHeight });
    };
    probe.src = src;
    return () => { alive = false; };
  }, [open, src]);

  // Measured from a callback ref rather than an effect, because the frame lives inside a
  // dialog that mounts and unmounts with `open` — this runs exactly when the node exists,
  // however that mounting is scheduled.
  const attachFrame = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setFrame({ w: rect.width, h: rect.height });
    };
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  const zoom = allowZoom ? pos.scale ?? BANNER_ZOOM_MIN : BANNER_ZOOM_MIN;
  const baseOverflow = coverOverflow(frame, natural);
  // Panning at the current zoom can reach further than the base cover overflow — the
  // magnified image has more of itself pushed past the frame's edges. Drag/nudge math
  // below uses this, not baseOverflow, so a screen-pixel drag tracks the cursor 1:1
  // regardless of zoom (see dragToPosition's doc).
  const overflow = zoomedOverflow(baseOverflow, zoom);
  // Sub-pixel overflow isn't worth a grab cursor and a "drag me" hint.
  const draggable = overflow.x > 1 || overflow.y > 1;
  const measured = !!(frame && natural);
  const canReset = draggable || zoom > BANNER_ZOOM_MIN;

  const setZoom = (next: number) => {
    setPos((p) => ({ ...p, scale: Math.min(BANNER_ZOOM_MAX, Math.max(BANNER_ZOOM_MIN, next)) }));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, from: pos };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setPos(dragToPosition(d.from, e.clientX - d.px, e.clientY - d.py, overflow));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!draggable) return;
    const step = (e.shiftKey ? KEY_STEP * 5 : KEY_STEP) / 100;
    const nudge = (dx: number, dy: number) => {
      e.preventDefault();
      setPos(dragToPosition(pos, dx * step * overflow.x, dy * step * overflow.y, overflow));
    };
    if (e.key === "ArrowUp") nudge(0, -1);
    else if (e.key === "ArrowDown") nudge(0, 1);
    else if (e.key === "ArrowLeft") nudge(-1, 0);
    else if (e.key === "ArrowRight") nudge(1, 0);
  };

  // Trackpad pinch reaches this as a wheel event with ctrlKey set (Chromium's
  // synthesis of the native gesture) — treated the same as a plain scroll so
  // pinch-to-zoom and mouse-wheel-to-zoom both just work, no separate gesture
  // handling needed.
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!allowZoom) return;
    e.preventDefault();
    setZoom(zoom - Math.sign(e.deltaY) * ZOOM_STEP);
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="max-w-3xl">
      <div className="space-y-3 p-5">
        <DialogTitle className="text-sm font-semibold">{title ?? t("settings.bannerPositionTitle")}</DialogTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {measured && !draggable
            ? fitsHint ?? t("settings.bannerPositionFits")
            : hint ?? t("settings.bannerPositionHint")}
        </p>

        <div
          ref={attachFrame}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={allowZoom ? handleWheel : undefined}
          style={{ aspectRatio: `${frameAspect} / 1` }}
          className={`relative w-full touch-none select-none overflow-hidden rounded-xl bg-muted ring-1 ring-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
            draggable ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          {/* Zoom is a second, outer transform anchored at the same x%,y% the pan
            * already uses — scaling from that point keeps whatever the user panned to
            * fixed on screen as they zoom in around it, rather than re-centering on
            * every zoom step. At zoom 1 this is a no-op wrapper. */}
          <div
            className="absolute inset-0"
            style={zoom > BANNER_ZOOM_MIN ? { transform: `scale(${zoom})`, transformOrigin: `${pos.x}% ${pos.y}%` } : undefined}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
            />
          </div>
        </div>

        {allowZoom && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{t("settings.bannerPositionZoomOut")}</span>
            <input
              type="range"
              min={BANNER_ZOOM_MIN}
              max={BANNER_ZOOM_MAX}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label={t("settings.bannerPositionZoom")}
            />
            <span className="text-xs text-muted-foreground">{t("settings.bannerPositionZoomIn")}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          onClick={() => setPos(DEFAULT_BANNER_POSITION)}
          disabled={!canReset}
          className="mr-auto h-8 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          {t("settings.bannerPositionCenter")}
        </Button>
        <Button
          variant="ghost"
          onClick={onCancel}
          className="h-8 rounded-lg px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          {t("common.cancel")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => onConfirm(pos)}
          className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("settings.save")}
        </Button>
      </div>
    </Dialog>
  );
}

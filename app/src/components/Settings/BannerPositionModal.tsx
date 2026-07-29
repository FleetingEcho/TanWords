import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";
import { BannerPosition, DEFAULT_BANNER_POSITION } from "@/store/settingsStore";
import { coverOverflow, dragToPosition, Size } from "./bannerFraming";

/** The dashboard banner is a full-width strip 200px tall, which lands around 6:1 on a
 *  typical window. The frame below uses that shape so the band the user drags into view
 *  is the band the dashboard shows — exactness doesn't matter much, since the stored
 *  percentages are relative to whatever overflow the real banner ends up having. */
const FRAME_ASPECT = 6;

/** Arrow-key nudge, in object-position percentage points (×5 with Shift). */
const KEY_STEP = 2;

interface Props {
  open: boolean;
  /** The image being framed, as a data URL. */
  src: string;
  /** Framing to open with — the stored one when re-adjusting, centred for a new image. */
  initial: BannerPosition;
  onCancel: () => void;
  onConfirm: (position: BannerPosition) => void;
}

/**
 * Drag-to-choose-the-visible-band dialog for the dashboard banner.
 *
 * The banner is a wide letterbox and photos rarely are, so `object-fit: cover` has to
 * throw away a lot of the image — previously always the top and bottom, which is how you
 * end up with a banner of someone's forehead. This hands that decision to the user.
 *
 * The preview is rendered with the very same `object-fit: cover` + `object-position` the
 * dashboard uses, rather than by positioning a scaled image by hand: it is WYSIWYG by
 * construction, and — the reason it works this way — the picture still shows even if the
 * measuring below comes up empty. Measurements only decide how far a drag moves and
 * whether there is anything to drag at all.
 */
export function BannerPositionModal({ open, src, initial, onCancel, onConfirm }: Props) {
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

  const overflow = coverOverflow(frame, natural);
  // Sub-pixel overflow isn't worth a grab cursor and a "drag me" hint.
  const draggable = overflow.x > 1 || overflow.y > 1;
  const measured = !!(frame && natural);

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

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="max-w-3xl">
      <div className="space-y-3 p-5">
        <DialogTitle className="text-sm font-semibold">{t("settings.bannerPositionTitle")}</DialogTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {measured && !draggable ? t("settings.bannerPositionFits") : t("settings.bannerPositionHint")}
        </p>

        <div
          ref={attachFrame}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ aspectRatio: `${FRAME_ASPECT} / 1` }}
          className={`relative w-full touch-none select-none overflow-hidden rounded-xl bg-muted ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            draggable ? "cursor-grab active:cursor-grabbing" : ""
          }`}
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

      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          onClick={() => setPos(DEFAULT_BANNER_POSITION)}
          disabled={!draggable}
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

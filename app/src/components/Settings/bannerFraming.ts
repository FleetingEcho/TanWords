import type { BannerPosition } from "@/store/settingsStore";

/** Frame or image dimensions in CSS pixels. */
export interface Size {
  w: number;
  h: number;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/**
 * How many pixels `object-fit: cover` hides on each axis — i.e. how far the image can
 * travel inside the frame, which is what turns a drag in pixels into a position in
 * percent. Zero on an axis means that axis is fully visible and can't be dragged.
 *
 * A missing or empty measurement yields no overflow, never NaN: the banner dialog stays
 * undraggable until it knows both sizes, rather than moving the image by a garbage amount.
 */
export function coverOverflow(frame: Size | null, natural: Size | null): { x: number; y: number } {
  if (!frame || !natural) return { x: 0, y: 0 };
  if (frame.w <= 0 || frame.h <= 0 || natural.w <= 0 || natural.h <= 0) return { x: 0, y: 0 };
  const scale = Math.max(frame.w / natural.w, frame.h / natural.h);
  return {
    x: Math.max(0, natural.w * scale - frame.w),
    y: Math.max(0, natural.h * scale - frame.h),
  };
}

/**
 * Applies a drag to a position. Dragging the image down reveals more of its top edge,
 * which is a *smaller* object-position percentage — hence the subtraction. An axis with
 * no overflow has nothing to choose, so it stays centred.
 *
 * `overflow` here should already be zoom-adjusted (see `zoomedOverflow`) when the image
 * is zoomed in past its base cover — otherwise a screen-pixel drag would move the
 * (visually magnified) image faster than the cursor, since the same `overflow.x` denominator
 * would represent a smaller fraction of what's actually now on screen.
 */
export function dragToPosition(
  from: BannerPosition,
  dx: number,
  dy: number,
  overflow: { x: number; y: number }
): BannerPosition {
  return {
    ...from,
    x: overflow.x > 0 ? clamp(from.x - (dx / overflow.x) * 100) : 50,
    y: overflow.y > 0 ? clamp(from.y - (dy / overflow.y) * 100) : 50,
  };
}

/**
 * `coverOverflow` scaled up by the current zoom level — the pannable range once the
 * image is magnified past its base `object-fit: cover` minimum. At `zoom === 1` (no
 * extra zoom) this is identical to `coverOverflow`'s own output; passing it through
 * `dragToPosition` either way keeps drag math correct at any zoom level, including 1.
 */
export function zoomedOverflow(overflow: { x: number; y: number }, zoom: number): { x: number; y: number } {
  return { x: overflow.x * zoom, y: overflow.y * zoom };
}

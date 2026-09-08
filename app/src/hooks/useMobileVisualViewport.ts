import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const NARROW_QUERY = "(max-width: 767px)";
const SM_QUERY = "(min-width: 640px)";
/** Gap between the layout viewport's bottom and the visible viewport's bottom
 *  above which an on-screen keyboard is assumed open. Rotation and mobile
 *  address-bar show/hide move *both* viewports together, so their gap stays
 *  near zero and never trips this. */
export const KEYBOARD_GAP_THRESHOLD = 120;

export interface MobileVisualViewportState {
  /** Visible (visual) viewport height in px, or `null` above `lg` or where
   *  `visualViewport` is missing — callers then use their ordinary `h-full`
   *  and desktop layout is untouched. */
  height: number | null;
  /** How far the visual viewport has been panned down within the layout one
   *  (non-zero while an open keyboard lets the page slide). */
  offsetTop: number;
  keyboardOpen: boolean;
}

/** One measurement point for everything that must track the *visible* viewport
 *  on a phone: the chat composer's height, the nav dock's band, the podcast
 *  bar's clearance. Measures only — no page logic lives here. */
export function useMobileVisualViewport(): MobileVisualViewportState {
  const [state, setState] = useState<MobileVisualViewportState>({
    height: null,
    offsetTop: 0,
    keyboardOpen: false,
  });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const narrowMq = window.matchMedia(NARROW_QUERY);
    const update = () => {
      if (!narrowMq.matches) {
        setState((prev) => prev.height === null ? prev : { height: null, offsetTop: 0, keyboardOpen: false });
        return;
      }
      // Height difference, not offsetTop: while the keyboard is up the user
      // can pan the visual viewport around (offsetTop wanders), but its
      // *height* stays shrunk by the keyboard for as long as it is open —
      // so the height delta is the stable signal. offsetTop is positioning
      // information, consumed by mobileVisualViewportStyle below.
      const gap = window.innerHeight - vv.height;
      const next = {
        height: vv.height,
        offsetTop: vv.offsetTop,
        keyboardOpen: gap > KEYBOARD_GAP_THRESHOLD,
      };
      setState((prev) =>
        prev.height === next.height && prev.offsetTop === next.offsetTop && prev.keyboardOpen === next.keyboardOpen
          ? prev
          : next,
      );
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    narrowMq.addEventListener("change", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      narrowMq.removeEventListener("change", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return state;
}

const MOBILE_VIEWPORT_VARS = [
  "--mobile-visual-height",
  "--mobile-visual-offset-top",
  "--mobile-nav-band",
  "--mobile-bottom-inset",
  "--mobile-bottom-inset-raised",
] as const;

/** Publishes the shared bottom-inset variables the shell's fixed chrome
 *  (nav dock, podcast bar) and page padding consume, so no page recomputes
 *  its own magic number:
 *
 *  - `--mobile-visual-height` / `--mobile-visual-offset-top`: the visible
 *    viewport box (shrunken while the keyboard is open).
 *  - `--mobile-nav-band`: the resting nav dock's footprint; `0` while the
 *    keyboard is open, since the dock stands down to give the keyboard room.
 *  - `--mobile-bottom-inset[-raised]`: dock band (+ podcast clearance when
 *    raised) + the device safe area, for `padding-bottom` on page hosts.
 *
 *  Removed entirely on ≥lg viewports so Tailwind fallbacks win and desktop is
 *  untouched. */
export function MobileViewportCssVars(): null {
  const vp = useMobileVisualViewport();

  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      for (const name of MOBILE_VIEWPORT_VARS) root.style.removeProperty(name);
    };
    if (vp.height === null) {
      clear();
      return clear;
    }
    const smMq = window.matchMedia(SM_QUERY);
    // Same numbers the dock's own geometry uses: 40px resting button + 2×5px
    // breathing room on phones, 56px + 2×5px from `sm` up.
    const navBand = vp.keyboardOpen ? 0 : smMq.matches ? 66 : 50;
    root.style.setProperty("--mobile-visual-height", `${Math.round(vp.height)}px`);
    root.style.setProperty("--mobile-visual-offset-top", `${Math.round(vp.offsetTop)}px`);
    root.style.setProperty("--mobile-nav-band", `${navBand}px`);
    root.style.setProperty("--mobile-bottom-inset", `calc(${navBand}px + env(safe-area-inset-bottom))`);
    // + 4rem: the docked podcast player's 64px band.
    root.style.setProperty("--mobile-bottom-inset-raised", `calc(${navBand}px + 4rem + env(safe-area-inset-bottom))`);
    return clear;
  }, [vp.height, vp.offsetTop, vp.keyboardOpen]);

  return null;
}

/** `padding-bottom` for the shell's page host. Matches the old Tailwind
 *  calc classes on desktop-width compacts too — the vars are only *set* below
 *  `lg`, so the fallbacks are what tablets/desktop actually resolve to. */
export const MOBILE_PAGE_PB = "pb-[var(--mobile-bottom-inset,3.125rem)] sm:pb-[var(--mobile-bottom-inset,4.125rem)]";
export const MOBILE_PAGE_PB_RAISED = "pb-[var(--mobile-bottom-inset-raised,7.125rem)] sm:pb-[var(--mobile-bottom-inset-raised,8.125rem)]";

/** Inline style for a page root that must end exactly at the visible
 *  viewport's bottom edge (the chat page: composer above the keyboard). */
export function mobileVisualViewportStyle(vp: MobileVisualViewportState): CSSProperties | undefined {
  if (vp.height === null) return undefined;
  return {
    height: vp.height,
    position: "relative",
    // Pan down with the visual viewport so the composer's bottom edge tracks
    // the keyboard's top edge, not the layout viewport's.
    top: vp.offsetTop || undefined,
  };
}

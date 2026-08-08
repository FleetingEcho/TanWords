import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/hooks/useT";
import type { NavPage } from "@/store/navStore";

export interface DockNavItem {
  id: NavPage;
  label: string;
  icon: React.FC<{ className?: string }>;
}

const BUBBLE = 46;
/** Breathing room between neighbouring bubbles along the arc. */
const GAP = 12;
/** Arc geometry, per anchor. A centred fan opens as a dome; a corner fan sweeps
 *  from the screen edge up and inwards, which is the only quarter a thumb in
 *  that corner can actually reach.
 *
 *  Neither arc reaches the horizontal or (for the corner) the vertical: an
 *  entry sitting at exactly 180° or 90° is centred on the anchor's own row or
 *  column, so half of it lands past the screen edge. The few degrees of inset
 *  are what keep the first and last bubbles whole. */
const ARC = {
  center: { start: 170, span: 160 },
  right: { start: 175, span: 80 },
} as const;

/** Live viewport box. The fan's radius is derived from it, so a rotation or a
 *  resized window has to re-measure. */
function useViewport(): { w: number; h: number } {
  const [size, setSize] = useState(() =>
    typeof window === "undefined"
      ? { w: 400, h: 800 }
      : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** Navigation for phones and tablets: a single button that opens a radar fan of
 *  every page, instead of a bar pinned across the bottom edge.
 *
 *  A tab bar divides one fixed strip by however many pages exist, so each new
 *  page makes every existing one smaller — the layout gets worse as the app
 *  gets better. A fan gets *bigger* instead: the radius is computed from the
 *  number of entries, so the tenth page pushes the arc outwards rather than
 *  squeezing the other nine. At rest it costs one button, and the page keeps
 *  its full bleed with no permanent chrome band across the bottom.
 *
 *  Entries are icon-only, and the name of whatever is under the finger is read
 *  out over the button — labels ringing an arc collide with each other at the
 *  shallow angles, and a single readout stays legible however many there are.
 */
export function MobileNavDock({
  items,
  activeNav,
  onNavigate,
  align = "center",
  raised = false,
}: {
  items: DockNavItem[];
  activeNav: string;
  onNavigate: (id: string) => void;
  /** Phones fan from the middle; tablets from the thumb corner. */
  align?: "center" | "right";
  /** Lift clear of the podcast player when it is docked. */
  raised?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sweepKey, setSweepKey] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const { w: vw, h: vh } = useViewport();

  const active = items.find((i) => i.id === activeNav) ?? items[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!active) return null;

  const { start, span } = ARC[align];
  // Radius follows the head count. The arc has to be long enough for every gap
  // *between* neighbours to hold a bubble plus clearance — n-1 gaps, not n —
  // and that length is r·θ, so the radius grows with the list instead of the
  // entries shrinking to fit a fixed one. The cap is whatever the screen can
  // actually show, measured on both axes: a wide short window runs out of
  // height first, and half a bubble past the bottom edge is still lost.
  const gaps = Math.max(items.length - 1, 1);
  const needed = (gaps * (BUBBLE + GAP) * 180) / (span * Math.PI);
  const anchorBottom = raised ? 88 : 40; // matches the `bottom` style below
  const maxByHeight = vh - anchorBottom - BUBBLE / 2 - 16;
  const maxByWidth = align === "right" ? vw - 40 - BUBBLE / 2 - 16 : vw / 2 - BUBBLE / 2 - 8;
  const radius = Math.max(112, Math.min(needed, maxByWidth, maxByHeight));

  const readout = items.find((i) => i.id === focused)?.label ?? active.label;
  const ActiveIcon = active.icon;

  const openFan = () => {
    setSweepKey((k) => k + 1);
    setFocused(null);
    setOpen(true);
  };
  const go = (id: string) => {
    setOpen(false);
    setFocused(null);
    onNavigate(id);
  };

  return (
    <>
      {/* The page goes out of focus rather than under a black sheet. */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-background/70 backdrop-blur-md transition-opacity duration-300 motion-reduce:transition-none ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* A zero-size anchor. Everything below is placed by transform from this
        * one point, which is what lets the fan, the beam and the button share a
        * centre and stay in register at any radius. */}
      <div
        className={`fixed z-50 h-0 w-0 ${align === "right" ? "right-10" : "left-1/2"}`}
        style={{
          bottom: raised
            ? "calc(env(safe-area-inset-bottom) + 5.5rem)"
            : "calc(env(safe-area-inset-bottom) + 2.5rem)",
          transition: "bottom 200ms ease",
        }}
      >
        {/* Range rings — the fan reads as a scale rather than as scattered
          * buttons, and they give the beam something to travel over. */}
        {[radius * 0.62, radius].map((r, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`absolute rounded-full border border-dashed border-[hsl(var(--sidebar-border))] transition-all duration-500 ease-out motion-reduce:transition-none ${
              align === "right" ? "[clip-path:inset(0_0_35%_35%)]" : "[clip-path:inset(0_0_45%_0)]"
            } ${open ? "scale-100 opacity-60" : "scale-75 opacity-0"}`}
            style={{
              width: r * 2,
              height: r * 2,
              left: -r,
              top: -r,
              transitionDelay: open ? `${i * 60}ms` : "0ms",
            }}
          />
        ))}

        {open && (
          <span
            key={sweepKey}
            aria-hidden="true"
            className="animate-radar-sweep absolute left-0 top-0 h-[2px] origin-left rounded-full"
            style={{
              width: radius + 26,
              marginTop: -1,
              background: "linear-gradient(90deg, hsl(var(--primary) / 0.65), hsl(var(--primary) / 0))",
              ["--sweep-from" as string]: `${-start}deg`,
              ["--sweep-to" as string]: `${-(start - span)}deg`,
            }}
          />
        )}

        {items.map((item, i) => {
          const theta = items.length === 1 ? start - span / 2 : start - (span * i) / (items.length - 1);
          const rad = (theta * Math.PI) / 180;
          const x = Math.cos(rad) * radius;
          const y = -Math.sin(rad) * radius;
          const isActive = item.id === activeNav;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              onPointerEnter={() => setFocused(item.id)}
              onPointerDown={() => setFocused(item.id)}
              onPointerLeave={() => setFocused((f) => (f === item.id ? null : f))}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
              // Each entry surfaces a beat after the beam crosses it, so the
              // fan resolves in the direction of the sweep instead of popping
              // as a block. On close the delays go to zero and it collapses at
              // once, back into the button.
              style={{
                width: BUBBLE,
                height: BUBBLE,
                left: -BUBBLE / 2,
                top: -BUBBLE / 2,
                transform: open ? `translate(${x}px, ${y}px) scale(1)` : "translate(0px, 0px) scale(0.3)",
                transitionDelay: open ? `${120 + (i * 600) / Math.max(items.length - 1, 1)}ms` : "0ms",
              }}
              className={`absolute flex items-center justify-center rounded-full border backdrop-blur-xl transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] active:scale-95 motion-reduce:transition-none ${
                open ? "opacity-100" : "pointer-events-none opacity-0"
              } ${
                isActive
                  ? "border-primary/50 bg-primary/15 text-primary shadow-lg shadow-primary/20"
                  : "border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))]/90 text-[hsl(var(--sidebar-foreground))] shadow-lg shadow-black/30"
              }`}
            >
              <Icon className="h-[19px] w-[19px]" />
            </button>
          );
        })}

        {/* The readout: the name of whatever the finger is on, set as a
          * headword — the same treatment the app gives a word it has looked
          * up. It is the only text in the fan, so it can be the loud one. */}
        <span
          aria-live="polite"
          className={`pointer-events-none absolute bottom-[42px] whitespace-nowrap font-serif text-[15px] font-bold tracking-tight text-[hsl(var(--sidebar-foreground))] transition-all duration-200 motion-reduce:transition-none ${
            align === "right" ? "right-0 text-right" : "left-1/2 -translate-x-1/2"
          } ${open ? "opacity-100" : "translate-y-1 opacity-0"}`}
        >
          {readout}
          <span className="ml-1 font-serif text-[11px] italic text-primary/70">n.</span>
        </span>

        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openFan())}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={open ? t("common.close") : t("nav.workspace")}
          title={active.label}
          className={`absolute -left-7 -top-7 flex h-14 w-14 items-center justify-center rounded-full border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))]/90 shadow-xl shadow-black/40 backdrop-blur-xl transition-transform duration-300 ease-out active:scale-90 motion-reduce:transition-none ${
            open ? "rotate-90" : "rotate-0"
          }`}
        >
          {/* A ring in the accent, drawn at the button's edge: the resting state
            * still says "this is where you are", the way the active row in the
            * sidebar does, without spending a label on it. */}
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-full ring-2 ring-primary/40 transition-opacity duration-200 ${
              open ? "opacity-0" : "opacity-100"
            }`}
          />
          <span className={`transition-[opacity,transform] duration-200 ${open ? "scale-75 opacity-0" : "scale-100 opacity-100"}`}>
            <ActiveIcon className="h-[21px] w-[21px] text-primary" />
          </span>
          <span
            className={`absolute transition-[opacity,transform] duration-200 ${
              open ? "-rotate-90 scale-100 opacity-100" : "rotate-0 scale-75 opacity-0"
            }`}
          >
            <X className="h-5 w-5 text-[hsl(var(--sidebar-foreground))]" />
          </span>
        </button>
      </div>
    </>
  );
}

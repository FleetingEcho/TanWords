import React, { useRef, useState } from "react";

interface Props {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  ariaLabel: string;
  variant?: "card" | "glass";
}

/** Styled audio timeline with drag-preview and commit-on-release semantics. */
export function AudioSeekSlider({ position, duration, onSeek, ariaLabel, variant = "card" }: Props) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const glass = variant === "glass";
  const value = dragValue ?? Math.min(position, duration || position);
  const progress = duration > 0 ? Math.min(100, Math.max(0, (value / duration) * 100)) : 0;

  const preview = (next: number) => {
    pendingRef.current = next;
    setDragValue(next);
  };
  const commit = () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setDragValue(null);
    if (pending !== null) onSeek(pending);
  };

  return (
    <div className="group relative flex h-6 w-full items-center">
      <div
        className={`pointer-events-none absolute inset-x-0 h-1.5 overflow-hidden rounded-full transition-[height] duration-150 group-hover:h-2 ${
          glass ? "bg-white/20 shadow-inner" : "bg-muted shadow-inner"
        }`}
      >
        <div
          className={`h-full rounded-full ${dragValue === null ? "transition-[width] duration-75" : "transition-none"} ${
            glass
              ? "bg-gradient-to-r from-white/75 to-white shadow-[0_0_10px_rgba(255,255,255,.35)]"
              : "bg-gradient-to-r from-primary/70 to-primary shadow-[0_0_8px_hsl(var(--primary)/.25)]"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={0.01}
        value={value}
        onInput={(event) => preview(Number(event.currentTarget.value))}
        onChange={(event) => preview(Number(event.currentTarget.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
        disabled={!duration}
        aria-label={ariaLabel}
        className={`absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default
          [&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent
          [&::-webkit-slider-thumb]:mt-[4px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:shadow-md
          [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110
          [&::-moz-range-track]:h-full [&::-moz-range-track]:bg-transparent
          [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:shadow-md ${
            glass
              ? "[&::-webkit-slider-thumb]:border-white/70 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:border-white/70 [&::-moz-range-thumb]:bg-white"
              : "[&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-primary"
          }`}
      />
    </div>
  );
}

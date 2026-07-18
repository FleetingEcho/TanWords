import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SPEEDS = [0.75, 1, 1.25, 1.5];

interface Props {
  value: number;
  onChange: (speed: number) => void;
  variant?: "card" | "glass";
}

/** Shared playback-speed control built on the project's shadcn Select. */
export function PlaybackSpeedSelector({ value, onChange, variant = "card" }: Props) {
  const glass = variant === "glass";

  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger
        aria-label="Playback speed"
        className={`shrink-0 rounded-full border-0 text-xs font-semibold shadow-none focus:ring-1 focus:ring-offset-0 ${
          glass
            ? "h-10 w-[72px] bg-white/10 text-white hover:bg-white/15 focus:ring-white/40"
            : "h-8 w-[72px] bg-transparent px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        side="top"
        align="end"
        className={glass ? "border-white/15 bg-black/70 text-white backdrop-blur-md" : undefined}
      >
        {SPEEDS.map((speed) => (
          <SelectItem
            key={speed}
            value={String(speed)}
            className={glass ? "focus:bg-white/15 focus:text-white" : undefined}
          >
            {speed}x
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

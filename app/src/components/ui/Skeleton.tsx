import React from "react";
import { cn } from "@/lib/utils";

/** Pulsing placeholder block — compose into page-specific loading layouts. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} style={style} />;
}

/** Text-shaped placeholder: alternating 3/4- and 1/2-width lines. */
export function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2 py-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`h-3.5 bg-muted rounded ${i % 2 === 0 ? "w-3/4" : "w-1/2"}`} />
      ))}
    </div>
  );
}

import React from "react";
import { cn } from "@/lib/utils";

/** Pulsing placeholder block — compose into page-specific loading layouts. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} style={style} />;
}

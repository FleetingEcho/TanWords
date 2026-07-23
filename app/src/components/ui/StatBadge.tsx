import React from "react";

/** Compact icon+number pill for engagement stats (points, comments, participants). */
export function StatBadge({ icon, children, className = "" }: { icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${className}`}>
      {icon}
      {children}
    </span>
  );
}

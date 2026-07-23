import React from "react";

/** Pulse placeholders shown while the first DB read is in flight, so opening
 * the page never sits on a blank screen while feeds/entries load. */
export function EntrySkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-5 space-y-4 animate-fade-in">
      <div className="h-4 w-24 rounded bg-muted animate-pulse" />
      <div className="w-full aspect-[21/9] rounded-2xl bg-muted animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-border overflow-hidden">
            <div className="w-full aspect-[16/9] bg-muted animate-pulse" />
            <div className="p-3.5 space-y-2">
              <div className="h-3.5 w-3/4 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

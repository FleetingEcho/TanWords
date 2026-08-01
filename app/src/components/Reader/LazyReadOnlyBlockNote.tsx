import React, { lazy, Suspense } from "react";

const ReadOnlyBlockNote = lazy(() =>
  import("./ReadOnlyBlockNote").then((m) => ({ default: m.ReadOnlyBlockNote }))
);

export function LazyReadOnlyBlockNote(props: React.ComponentProps<typeof ReadOnlyBlockNote>) {
  return (
    <Suspense fallback={<div className="py-10 text-center text-xs text-muted-foreground">Loading…</div>}>
      <ReadOnlyBlockNote {...props} />
    </Suspense>
  );
}

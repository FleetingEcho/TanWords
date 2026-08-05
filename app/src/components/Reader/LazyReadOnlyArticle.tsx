import React, { lazy, Suspense } from "react";

const ReadOnlyArticle = lazy(() =>
  import("./ReadOnlyArticle").then((m) => ({ default: m.ReadOnlyArticle }))
);

export function LazyReadOnlyArticle(props: React.ComponentProps<typeof ReadOnlyArticle>) {
  return (
    <Suspense fallback={<div className="py-10 text-center text-xs text-muted-foreground">Loading…</div>}>
      <ReadOnlyArticle {...props} />
    </Suspense>
  );
}

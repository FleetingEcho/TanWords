import React, { lazy, Suspense } from "react";

// Same lazy-split treatment as LazyDocEditor.tsx — BlockNote must never be
// pulled into the main bundle.
const LocalDocEditor = lazy(() =>
  import("./LocalDocEditor").then((m) => ({ default: m.LocalDocEditor }))
);

type LocalDocEditorProps = React.ComponentProps<typeof LocalDocEditor>;

function EditorLoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export function LazyLocalDocEditor(props: LocalDocEditorProps) {
  return (
    <Suspense fallback={<EditorLoadingFallback />}>
      <LocalDocEditor {...props} />
    </Suspense>
  );
}

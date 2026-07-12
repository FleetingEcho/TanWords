import React, { lazy, Suspense } from "react";

// BlockNote (react + mantine + prosemirror internals) is the single
// heaviest dependency in the app — split into its own chunk so it only
// loads when a document is actually opened, not on initial app boot.
const DocEditor = lazy(() =>
  import("./DocEditor").then((m) => ({ default: m.DocEditor }))
);

type DocEditorProps = React.ComponentProps<typeof DocEditor>;

function EditorLoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export function LazyDocEditor(props: DocEditorProps) {
  return (
    <Suspense fallback={<EditorLoadingFallback />}>
      <DocEditor {...props} />
    </Suspense>
  );
}

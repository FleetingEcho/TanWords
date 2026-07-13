import React, { lazy, Suspense } from "react";

// BlockNote is the heaviest dependency in the app — WordChatPanel is mounted
// as soon as any word detail view opens, so this must stay lazy the same way
// Documents/LazyDocEditor.tsx does, or it gets pulled into the main bundle.
const WordNotesEditor = lazy(() =>
  import("./WordNotesEditor").then((m) => ({ default: m.WordNotesEditor }))
);

type WordNotesEditorProps = React.ComponentProps<typeof WordNotesEditor>;

function EditorLoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export function LazyWordNotesEditor(props: WordNotesEditorProps) {
  return (
    <Suspense fallback={<EditorLoadingFallback />}>
      <WordNotesEditor {...props} />
    </Suspense>
  );
}

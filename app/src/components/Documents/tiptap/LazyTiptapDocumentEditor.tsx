/**
 * Lazy boundary for the Tiptap editor.
 *
 * The schema pulls in shiki (through `codeBlockShiki`) and the mermaid block,
 * neither of which belongs in the main chunk — the same reason `editorSchema`
 * carries its "import only from lazily-loaded components" warning.
 */
import { Suspense, lazy } from "react";
import type { TiptapDocumentEditorProps } from "./TiptapDocumentEditor";

const TiptapDocumentEditor = lazy(() =>
  import("./TiptapDocumentEditor").then((module) => ({ default: module.TiptapDocumentEditor })),
);

/**
 * Reserves the editor's space while its chunk loads, and shows nothing.
 *
 * Every caller already renders its own loading overlay (`richLoading` in the
 * document editors, `parsing` in the reader), so a second spinner here was
 * redundant — and because it was a small padded box, the article collapsed to
 * ~80px and then sprang back when the chunk arrived. That is the flash.
 */
function EditorFallback() {
  return <div className="min-h-[40vh]" aria-hidden="true" />;
}

export function LazyTiptapDocumentEditor(props: TiptapDocumentEditorProps) {
  return (
    <Suspense fallback={<EditorFallback />}>
      <TiptapDocumentEditor {...props} />
    </Suspense>
  );
}

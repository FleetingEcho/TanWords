import type { Block } from "./tiptap/blocks";

/** Above this size, creating thousands of ProseMirror DOM nodes can monopolize
 * the renderer long enough that a click on another document cannot even be
 * dispatched. CodeMirror virtualizes its viewport, so large sources open there
 * first; users can still explicitly switch to rich mode afterwards. */
export const LARGE_DOCUMENT_CHAR_THRESHOLD = 150_000;
export const LARGE_DOCUMENT_LINE_THRESHOLD = 4_000;
export const LARGE_DOCUMENT_BLOCK_THRESHOLD = 2_000;

export function isLargeDocumentText(text: string): boolean {
  if (text.length >= LARGE_DOCUMENT_CHAR_THRESHOLD) return true;
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10 && ++lines >= LARGE_DOCUMENT_LINE_THRESHOLD) return true;
  }
  return false;
}

export function isLargeDocumentBlocks(blocks: readonly Block[]): boolean {
  let count = 0;
  const visit = (items: readonly Block[]): boolean => {
    for (const block of items) {
      count += 1;
      if (count >= LARGE_DOCUMENT_BLOCK_THRESHOLD) return true;
      if (block.children?.length && visit(block.children)) return true;
    }
    return false;
  };
  return visit(blocks);
}

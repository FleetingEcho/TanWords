type EditorBlock = {
  type?: string;
  content?: unknown;
  children?: unknown[];
};

export function isEmptyParagraph(block: EditorBlock | undefined): boolean {
  if (!block || block.type !== "paragraph" || block.children?.length) return false;
  return block.content == null
    || block.content === ""
    || (Array.isArray(block.content) && block.content.length === 0);
}

export function withTrailingEditorParagraph<T extends EditorBlock>(
  blocks: readonly T[],
): Array<T | { type: "paragraph" }> {
  const result: Array<T | { type: "paragraph" }> = [...blocks];
  if (!isEmptyParagraph(result[result.length - 1])) result.push({ type: "paragraph" });
  return result.length ? result : [{ type: "paragraph" }];
}

/** The final empty block is an editing affordance, not document content. */
export function withoutTrailingEditorParagraph<T extends EditorBlock>(
  blocks: readonly T[],
): T[] {
  return isEmptyParagraph(blocks[blocks.length - 1]) ? blocks.slice(0, -1) : [...blocks];
}

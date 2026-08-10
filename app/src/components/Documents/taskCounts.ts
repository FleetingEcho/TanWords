import type { Block } from "./tiptap/blocks";

/** Count checklist blocks (and their done count) in serialized block JSON —
 *  the client-side twin of `core/src/db/documents/tasks.rs`. Used purely for
 *  the optimistic `docs-item-updated` patch; the Rust side remains the source
 *  of truth on reload. The format is a flat array with nesting via `children`. */
export function countTaskBlocks(content: string): { total: number; done: number } {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    return { total: 0, done: 0 };
  }
  const blocks = Array.isArray(root)
    ? (root as Block[])
    : (root as { children?: Block[] } | null)?.children ?? [];
  return walk(blocks);
}

function walk(blocks: Block[]): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const block of blocks) {
    if (block?.type === "checkListItem") {
      total += 1;
      if (block.props?.checked === true) done += 1;
    }
    if (Array.isArray(block?.children)) {
      const nested = walk(block.children as Block[]);
      total += nested.total;
      done += nested.done;
    }
  }
  return { total, done };
}

/**
 * What the block menu can do to the block under the drag handle.
 *
 * Kept free of React so each action is unit-testable against a real editor —
 * the menu itself renders through floating-ui, which jsdom cannot position.
 *
 * Every action takes the block's document position rather than relying on the
 * cursor: the handle acts on the block you are *pointing at*, which is often
 * not the one holding the caret.
 */
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

export interface BlockTarget {
  node: PmNode | null;
  pos: number;
}

function isValid(editor: Editor, target: BlockTarget): target is { node: PmNode; pos: number } {
  // Range alone is not enough: a transaction while the block menu is open can
  // shift positions so that the captured `pos` points at a *different* node
  // that happens to be in range. Re-validate by identity — the captured node
  // must still be the one sitting at the captured position.
  return Boolean(target.node)
    && target.pos >= 0
    && target.pos < editor.state.doc.content.size
    && editor.state.doc.nodeAt(target.pos) === target.node;
}

/** Selects the block, so commands that act on a selection hit the right one. */
function selectBlock(editor: Editor, target: BlockTarget): boolean {
  if (!isValid(editor, target)) return false;
  return editor.chain().setNodeSelection(target.pos).run();
}

/** The block types "Turn into" offers, in menu order. */
export const TURN_INTO_OPTIONS = [
  { id: "paragraph", labelKey: "doc.slashParagraph", apply: (editor: Editor) => editor.chain().focus().setNode("paragraph").run() },
  { id: "heading1", labelKey: "doc.slashHeading1", apply: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 1 }).run() },
  { id: "heading2", labelKey: "doc.slashHeading2", apply: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 2 }).run() },
  { id: "heading3", labelKey: "doc.slashHeading3", apply: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 3 }).run() },
  { id: "bulletList", labelKey: "doc.slashBulletList", apply: (editor: Editor) => editor.chain().focus().toggleBulletList().run() },
  { id: "orderedList", labelKey: "doc.slashOrderedList", apply: (editor: Editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: "taskList", labelKey: "doc.slashTaskList", apply: (editor: Editor) => editor.chain().focus().toggleTaskList().run() },
  { id: "quote", labelKey: "doc.slashQuote", apply: (editor: Editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: "codeBlock", labelKey: "doc.slashCodeBlock", apply: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run() },
] as const;

/** Insertable equivalents, for targets the cursor-based `apply` cannot touch
 *  (see `turnInto`). Kept beside the options so the two stay in sync. */
const TURN_INTO_SPECS: Record<string, Record<string, unknown>> = {
  paragraph: { type: "paragraph" },
  heading1: { type: "heading", attrs: { level: 1 } },
  heading2: { type: "heading", attrs: { level: 2 } },
  heading3: { type: "heading", attrs: { level: 3 } },
  bulletList: { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
  orderedList: { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
  taskList: { type: "taskList", content: [{ type: "taskItem", content: [{ type: "paragraph" }] }] },
  quote: { type: "blockquote", content: [{ type: "paragraph" }] },
  codeBlock: { type: "codeBlock" },
};

/** Converts the target block to another type. */
export function turnInto(editor: Editor, target: BlockTarget, optionId: string): void {
  if (!isValid(editor, target)) return;
  const option = TURN_INTO_OPTIONS.find((candidate) => candidate.id === optionId);
  if (!option) return;
  const { node, pos } = target;
  // Atoms (image/video/audio/file/mermaid/youtube/divider) hold no textblock,
  // so `setNode`/`toggle*` find nothing to re-type and silently do nothing —
  // yet those are exactly the blocks a user wants to turn back into text.
  // Replace the atom with the option's insertable spec at the same position.
  const spec = TURN_INTO_SPECS[optionId];
  if (node.isAtom && spec) {
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, spec as never)
      .run();
    return;
  }
  // Put the cursor inside the block first: setNode/toggle* act on the selected
  // text block, and a NodeSelection on an atom is not one.
  editor.chain().focus().setTextSelection(pos + 1).run();
  option.apply(editor);
}

/** Inserts a copy directly below. */
export function duplicateBlock(editor: Editor, target: BlockTarget): void {
  if (!isValid(editor, target)) return;
  const { node, pos } = target;
  // Strip the id: `insertContentAt` is not passed through UniqueID's
  // paste transform, and UniqueID only mints ids for nodes whose id is
  // null — keeping the original's id leaves two blocks sharing one, and
  // every id-based lookup (updateBlock, removeBlocks, outline scroll)
  // then acts on the original instead of the copy. Only touched when the
  // node's type actually declares the attr — writing `id` onto a type
  // without it fails schema validation on insert.
  const json = node.toJSON();
  if (json.attrs && "id" in json.attrs) json.attrs.id = null;
  editor.chain().focus().insertContentAt(pos + node.nodeSize, json).run();
}

/** Copies the block as plain text. Returns what was copied, for testability —
 *  `navigator.clipboard` is unavailable in some desktop WebViews. */
export function copyBlockText(editor: Editor, target: BlockTarget): string | null {
  if (!isValid(editor, target)) return null;
  return target.node.textContent;
}

/** Strips inline marks, leaving the text and the block type alone. */
export function resetFormatting(editor: Editor, target: BlockTarget): void {
  if (!isValid(editor, target)) return;
  const { node, pos } = target;
  editor
    .chain()
    .focus()
    .setTextSelection({ from: pos, to: pos + node.nodeSize })
    .unsetAllMarks()
    .run();
}

/** Removes the block. */
export function deleteBlock(editor: Editor, target: BlockTarget): void {
  if (!isValid(editor, target)) return;
  const { node, pos } = target;
  editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
}

/** The block's text, for sending to AI Chat. */
export function blockTextForAi(editor: Editor, target: BlockTarget): string {
  return isValid(editor, target) ? target.node.textContent.trim() : "";
}

export { selectBlock };

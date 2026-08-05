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
  return Boolean(target.node) && target.pos >= 0 && target.pos < editor.state.doc.content.size;
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

/** Converts the target block to another type. */
export function turnInto(editor: Editor, target: BlockTarget, optionId: string): void {
  if (!isValid(editor, target)) return;
  const option = TURN_INTO_OPTIONS.find((candidate) => candidate.id === optionId);
  if (!option) return;
  // Put the cursor inside the block first: setNode/toggle* act on the selected
  // text block, and a NodeSelection on an atom is not one.
  editor.chain().focus().setTextSelection(target.pos + 1).run();
  option.apply(editor);
}

/** Inserts a copy directly below. */
export function duplicateBlock(editor: Editor, target: BlockTarget): void {
  if (!isValid(editor, target)) return;
  const { node, pos } = target;
  editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
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

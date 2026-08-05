/**
 * `DocEditorApi` implemented over a Tiptap editor.
 *
 * Everything here translates between block-space (what the app speaks) and
 * ProseMirror positions (what the editor speaks), so no caller outside this
 * file needs to know a position exists.
 */
import type { Editor } from "@tiptap/core";
import { DOMSerializer, type Node as PmNode } from "@tiptap/pm/model";
import { blocksToPmDoc, pmDocToBlocks } from "./blockAdapter";
import { inlineText, inlineToPm } from "./inlineAdapter";
import type { Block, InlineContent } from "./blocks";
import type { CursorPosition, DocEditorApi } from "./DocEditorApi";
import { resolveDocumentAssetUrl } from "@/lib/documentAssets";

/** Top-level nodes with their document positions, in order. */
function topLevelNodes(editor: Editor): { node: PmNode; pos: number }[] {
  const out: { node: PmNode; pos: number }[] = [];
  editor.state.doc.forEach((node, offset) => out.push({ node, pos: offset }));
  return out;
}

/** Finds a node anywhere in the document by its `id` attr. */
function findById(editor: Editor, id: string): { node: PmNode; pos: number } | null {
  let found: { node: PmNode; pos: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs?.id === id) found = { node, pos };
    return !found;
  });
  return found;
}

/** The index, among flattened blocks, the cursor currently sits in. */
function cursorBlockIndex(editor: Editor, blocks: Block[]): number {
  const { $from } = editor.state.selection;
  // depth 1 is the top-level node; list items live deeper, so walk up to the
  // nearest node carrying an id and match on that.
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const id = $from.node(depth).attrs?.id;
    if (!id) continue;
    const index = blocks.findIndex((block) => block.id === id);
    if (index >= 0) return index;
  }
  // No id yet (a freshly typed block): fall back to top-level ordering.
  const topIndex = editor.state.doc.resolve($from.before(1)).index();
  return Math.min(topIndex, blocks.length - 1);
}

/** Blocks as one flat sequence, so "next block" means what the app expects
 *  even when the cursor is inside a nested list. */
function flatten(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    out.push(block);
    if (block.children?.length) out.push(...flatten(block.children));
  }
  return out;
}

export function createDocEditorApi(editor: Editor): DocEditorApi {
  const api = {
    replaceBlocks(target, blocks) {
      const whole = target === api.document || target.length === 0;
      const doc = blocksToPmDoc(blocks);
      if (whole || target.length === editor.state.doc.childCount) {
        // `emitUpdate: false` — loading content is not a user edit, and
        // treating it as one would mark a freshly opened document dirty and
        // schedule a save that rewrites the file it just read.
        editor.commands.setContent(doc as never, { emitUpdate: false });
        return;
      }
      const first = target[0]?.id ? findById(editor, target[0].id!) : null;
      const last = target[target.length - 1]?.id
        ? findById(editor, target[target.length - 1].id!)
        : null;
      if (!first || !last) {
        editor.commands.setContent(doc as never, { emitUpdate: false });
        return;
      }
      editor
        .chain()
        .deleteRange({ from: first.pos, to: last.pos + last.node.nodeSize })
        .insertContentAt(first.pos, (doc.content ?? []) as never)
        .run();
    },

    insertBlocks(blocks, reference, placement) {
      const found = reference.id ? findById(editor, reference.id) : null;
      const target = found
        ? placement === "after"
          ? found.pos + found.node.nodeSize
          : found.pos
        : editor.state.doc.content.size;
      const content = (blocksToPmDoc(blocks).content ?? []) as never;
      editor.commands.insertContentAt(target, content);
    },

    removeBlocks(ids) {
      // Positions shift as nodes go, so delete from the end backwards.
      const targets = ids
        .map((id) => findById(editor, id))
        .filter((found): found is { node: PmNode; pos: number } => found !== null)
        .sort((a, b) => b.pos - a.pos);
      for (const { node, pos } of targets) {
        editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize });
      }
    },

    updateBlock(target, update) {
      const id = typeof target === "string" ? target : target.id;
      const found = id ? findById(editor, id) : null;
      if (!found || !update.props) return;
      editor.commands.command(({ tr, dispatch }) => {
        if (dispatch) {
          tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, ...update.props });
        }
        return true;
      });
    },

    getTextCursorPosition(): CursorPosition {
      const blocks = flatten(api.document);
      const index = cursorBlockIndex(editor, blocks);
      return {
        block: blocks[index] ?? blocks[blocks.length - 1] ?? { type: "paragraph" },
        prevBlock: index > 0 ? blocks[index - 1] : null,
        nextBlock: index >= 0 && index < blocks.length - 1 ? blocks[index + 1] : null,
      };
    },

    setTextCursorPosition(blockId, placement = "start") {
      const found = findById(editor, blockId);
      if (!found) return;
      const inside = found.pos + 1;
      editor.commands.setTextSelection(
        placement === "start" ? inside : inside + Math.max(0, found.node.content.size),
      );
    },

    insertInlineContent(content) {
      editor.commands.insertContent(inlineToPm(content as InlineContent[]) as never);
    },

    getSelection() {
      const { from, to } = editor.state.selection;
      if (from === to) return undefined;
      const blocks: Block[] = [];
      const all = api.document;
      topLevelNodes(editor).forEach(({ node, pos }, index) => {
        if (pos + node.nodeSize > from && pos < to && all[index]) blocks.push(all[index]);
      });
      return { blocks };
    },

    getSelectedText() {
      const { from, to } = editor.state.selection;
      return from === to ? "" : editor.state.doc.textBetween(from, to, "\n");
    },

    focus() {
      editor.commands.focus();
    },

    resolveFileUrl: resolveDocumentAssetUrl,

    blocksToHTMLLossy(blocks) {
      if (!blocks) return editor.getHTML();
      // Serialize arbitrary blocks without disturbing the live document: build
      // a detached node from the same schema and render that.
      const node = editor.schema.nodeFromJSON(blocksToPmDoc(blocks));
      const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(node.content);
      const holder = document.createElement("div");
      holder.appendChild(fragment);
      return holder.innerHTML;
    },

    getViewDom(): HTMLElement | null {
      // `editor.view` is not a plain property: before the view is mounted
      // Tiptap returns a Proxy that throws on any access, so `editor.view?.dom`
      // does not guard anything — the `.view` read is already the throw.
      if (editor.isDestroyed) return null;
      try {
        return (editor.view.dom as HTMLElement) ?? null;
      } catch {
        return null;
      }
    },
  } as DocEditorApi;

  /**
   * `document` is a getter for ergonomics — callers read `editor.document`
   * like a field — but it is deliberately NOT enumerable.
   *
   * The API object lives in component state, and React's dev-mode render
   * logging diffs state by walking `Object.keys` and reading each one. An
   * enumerable getter here would re-serialize the entire document on every
   * render in development, which is invisible until a document is large.
   */
  Object.defineProperty(api, "document", {
    get: () => pmDocToBlocks(editor.getJSON() as never),
    enumerable: false,
    configurable: true,
  });

  return api;
}

/** Plain text of a block, for callers that only want the words. */
export function blockText(block: Block): string {
  if (block.type === "mermaid") return String(block.props?.code ?? "");
  return Array.isArray(block.content) ? inlineText(block.content as InlineContent[]) : "";
}

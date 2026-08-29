/**
 * `DocEditorApi` implemented over a Tiptap editor.
 *
 * Everything here translates between block-space (what the app speaks) and
 * ProseMirror positions (what the editor speaks), so no caller outside this
 * file needs to know a position exists.
 */
import type { Editor } from "@tiptap/core";
import { DOMSerializer, type Node as PmNode } from "@tiptap/pm/model";
import { blocksToPmDoc, pmDocToBlocks, pmNodeToBlock } from "./blockAdapter";
import { inlineText, inlineToPm } from "./inlineAdapter";
import type { Block, InlineContent } from "./blocks";
import type { CursorPosition, DocEditorApi } from "./DocEditorApi";
import { resolveDocumentAssetUrl } from "@/lib/documentAssets";

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

// ── Cursor → block, in O(cursor neighbourhood) ──────────────────────────────
//
// The per-keystroke path. The naive route — serialize the whole document to
// storage format, flatten it and find the cursor's index — costs a full
// `getJSON()` plus a block-array rebuild per keystroke, which IS the render
// budget once a document is large. Everything below works directly on the
// live ProseMirror tree: locate, convert only the cursor's own block, and
// find the previous/next block in the flattened storage order (a pre-order
// walk where a block's nested list items follow it) by position arithmetic.
//
// Block-space ↔ node-space: a block is either a non-list child of `doc`, or
// the item child of a list wrapper (`bulletList`/`orderedList`/`taskList`).
// Everything nested elsewhere (paragraphs inside table cells, the paragraph
// inside a blockquote) is folded into its parent block, not a block itself.

const LIST_WRAPPERS = new Set(["bulletList", "orderedList", "taskList"]);
const LIST_ITEMS = new Set(["listItem", "taskItem"]);

interface BlockTarget {
  node: PmNode;
  /** Position directly before the node. */
  pos: number;
  /** Parent's type name — `"doc"` or a list wrapper; `pmNodeToBlock` needs it
   *  to map wrapper items back to their storage type (`bulletListItem`…). */
  parentType: string;
}

/** The node the cursor's block is made of, plus where it sits. */
function cursorBlockTarget(editor: Editor): BlockTarget | null {
  const { $from } = editor.state.selection;

  // Nearest ancestor that maps to a stored block: a non-list child of `doc`,
  // or the item of a list wrapper (walking past the paragraphs inside cells
  // and quotes, which are part of their parent block).
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const parentType = $from.node(depth - 1).type.name;
    const isBlock = parentType === "doc"
      ? !LIST_WRAPPERS.has(node.type.name)
      : LIST_WRAPPERS.has(parentType);
    if (isBlock) return { node, pos: $from.before(depth), parentType };
  }

  // Only a selection that does not sit inside any node lands here — a
  // top-level NodeSelection on an atom (an image being repositioned, say).
  // Report the node the selection sits on; an empty document keeps none.
  if ($from.nodeAfter) {
    const node = $from.nodeAfter;
    if (LIST_WRAPPERS.has(node.type.name)) {
      const item = node.firstChild;
      return item ? { node: item, pos: $from.pos + 1, parentType: node.type.name } : null;
    }
    return { node, pos: $from.pos, parentType: "doc" };
  }
  if ($from.nodeBefore) {
    const node = $from.nodeBefore;
    if (LIST_WRAPPERS.has(node.type.name)) {
      const item = node.lastChild;
      if (!item) return null;
      return { node: item, pos: $from.pos - item.nodeSize, parentType: node.type.name };
    }
    return { node, pos: $from.pos - node.nodeSize, parentType: "doc" };
  }
  return null;
}

/** The last child matching `filter` (or any), with its position. Index loop,
 *  not `forEach`: the found-value accumulates across iterations, which
 *  TypeScript's flow analysis refuses to see through a closure — and the
 *  hottest callsite walks this on every keystroke. */
function lastChildMatching(
  node: PmNode,
  pos: number,
  filter?: (typeName: string) => boolean,
): { node: PmNode; pos: number } | null {
  let found: { node: PmNode; pos: number } | null = null;
  let offset = 0;
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (!filter || filter(child.type.name)) found = { node: child, pos: pos + 1 + offset };
    offset += child.nodeSize;
  }
  return found;
}

/** The first child matching `filter`, with its position. */
function firstChildMatching(
  node: PmNode,
  pos: number,
  filter: (typeName: string) => boolean,
): { node: PmNode; pos: number } | null {
  let offset = 0;
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (filter(child.type.name)) return { node: child, pos: pos + 1 + offset };
    offset += child.nodeSize;
  }
  return null;
}

/**
 * The final block of a subtree in flattened (pre-order) storage order: for a
 * list wrapper its last item, for an item its deepest last nested item, and
 * for anything else the node itself. An empty wrapper holds no blocks at all.
 */
function deepestLastBlock(node: PmNode, pos: number, parentType: string): BlockTarget | null {
  let current: BlockTarget = { node, pos, parentType };
  for (;;) {
    const name = current.node.type.name;
    if (LIST_WRAPPERS.has(name)) {
      const child = lastChildMatching(current.node, current.pos);
      if (!child) return null;
      current = { node: child.node, pos: child.pos, parentType: name };
      continue;
    }
    if (LIST_ITEMS.has(name)) {
      // An item's block-space children are the items of its nested lists;
      // the deepest one in the last nested wrapper closes the subtree.
      const wrapper = lastChildMatching(current.node, current.pos, (n) => LIST_WRAPPERS.has(n));
      if (!wrapper) return current;
      const child = lastChildMatching(wrapper.node, wrapper.pos);
      if (!child) return current;
      current = { node: child.node, pos: child.pos, parentType: wrapper.node.type.name };
      continue;
    }
    return current;
  }
}

/**
 * The block following `target` in flattened storage order, or null at the
 * document's end. Walks: first nested item (a block's own children come
 * first), then the next sibling, climbing out of completed lists as needed —
 * all by position arithmetic at each block boundary, never by scanning.
 */
function nextBlockTarget(editor: Editor, target: BlockTarget): BlockTarget | null {
  const { doc } = editor.state;

  if (LIST_ITEMS.has(target.node.type.name)) {
    const wrapper = firstChildMatching(target.node, target.pos, (n) => LIST_WRAPPERS.has(n));
    const item = wrapper?.node.firstChild;
    if (wrapper && item) {
      return { node: item, pos: wrapper.pos + 1, parentType: wrapper.node.type.name };
    }
  }

  // The position directly after this subtree. Each re-resolve at a boundary
  // answers "what starts here?"; at a content tail, "what's past the
  // parent?" — the loop climbs until either has an answer.
  let boundary = target.pos + target.node.nodeSize;
  for (;;) {
    const $end = doc.resolve(boundary);
    const after = $end.nodeAfter;
    if (after) {
      if (LIST_WRAPPERS.has(after.type.name)) {
        const item = after.firstChild;
        if (item) return { node: item, pos: boundary + 1, parentType: after.type.name };
        // An empty wrapper contributes no blocks — step over it.
        boundary += after.nodeSize;
        continue;
      }
      return { node: after, pos: boundary, parentType: $end.node($end.depth).type.name };
    }
    if ($end.depth === 0) return null;
    boundary = $end.after($end.depth);
  }
}

/** The block before `target` in flattened storage order, or null at the top.
 *
 *  The flat order is a pre-order walk — block, then the items of its nested
 *  lists — so "previous" means: the deepest last nested item of whatever
 *  precedes us; and when nothing precedes us inside the current list, the
 *  list's own parent item (its items are that item's block-space children),
 *  or the thing before a top-level list. */
function prevBlockTarget(editor: Editor, target: BlockTarget): BlockTarget | null {
  const { doc } = editor.state;
  let boundary = target.pos;
  // Loop invariant: `boundary` sits directly before a node whose subtree is
  // fully behind us; we want the last block strictly before it.
  for (;;) {
    const $pos = doc.resolve(boundary);
    const parent = $pos.node($pos.depth);
    const parentType = parent.type.name;
    const before = $pos.nodeBefore;
    if (before) {
      const beforePos = boundary - before.nodeSize;
      if (LIST_WRAPPERS.has(before.type.name)) {
        const found = deepestLastBlock(before, beforePos, parentType);
        if (found) return found;
        boundary = beforePos; // an empty wrapper holds no blocks — look past it
        continue;
      }
      if (parentType === "doc" || LIST_WRAPPERS.has(parentType)) {
        // `before` is a block — but in flat order its nested items close the
        // subtree, so the answer is its own deepest trailing descendant.
        // (A childless block immediately returns itself.)
        const found = deepestLastBlock(before, beforePos, parentType);
        if (found) return found;
        boundary = beforePos;
        continue;
      }
      if (LIST_ITEMS.has(parentType)) {
        // The thing before us is a non-block child of an item (its paragraph):
        // the block it belongs to is the item itself.
        const itemPos = $pos.before($pos.depth);
        const $item = doc.resolve(itemPos);
        return { node: parent, pos: itemPos, parentType: $item.node($item.depth).type.name };
      }
      return null;
    }
    if ($pos.depth === 0) return null;
    // First in its parent. Climbing out of a nested list lands on the item
    // the list hangs off (an earlier nested list beside it winning if one
    // exists); a top-level list simply hands the search one level up.
    const parentPos = $pos.before($pos.depth);
    if (LIST_WRAPPERS.has(parentType)) {
      const $parent = doc.resolve(parentPos);
      if ($parent.depth === 0) {
        boundary = parentPos;
        continue;
      }
      const beforeWrap = $parent.nodeBefore;
      if (beforeWrap && LIST_WRAPPERS.has(beforeWrap.type.name)) {
        const wrapPos = parentPos - beforeWrap.nodeSize;
        const found = deepestLastBlock(beforeWrap, wrapPos, parentType);
        if (found) return found;
        boundary = wrapPos;
        continue;
      }
      const itemPos = $parent.before($parent.depth);
      const $item = doc.resolve(itemPos);
      return {
        node: $parent.node($parent.depth),
        pos: itemPos,
        parentType: $item.node($item.depth).type.name,
      };
    }
    // A non-list parent can only be the document's own middle structure;
    // nothing block-wise precedes a first-of-kind child here.
    return null;
  }
}

function targetToBlock(target: BlockTarget): Block {
  return pmNodeToBlock(target.node, target.parentType);
}

export function createDocEditorApi(editor: Editor): DocEditorApi {
  const api = {
    replaceBlocks(target, blocks) {
      const doc = blocksToPmDoc(blocks);
      // "Whole document" is decided in the flat-block space. `target` and
      // the live document both count one entry per list item, while
      // `doc.childCount` counts a whole list wrapper as one top-level node —
      // the old `target.length === childCount` comparison crossed those two
      // index spaces, so on any list-bearing document it either fired for a
      // single-block target (a YouTube promotion wiped the list's other
      // items) or failed to fire for a genuine whole-document replace,
      // pushing it through the range path, which left empty list wrappers
      // behind in the saved file. Equal flat counts means every block goes.
      const whole = target.length === 0
        || target.length === (api.document as Block[]).length;
      if (whole) {
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
      // BlockNote's insertBlocks kept the current text selection. Tiptap's
      // insertContentAt defaults to moving it after the inserted content,
      // which is disastrous for the automatic trailing paragraph: typing the
      // first character at the end appended a paragraph and moved the caret
      // there, so every following character created another line.
      editor.commands.insertContentAt(target, content, { updateSelection: false });
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
      // Positional lookup — see the note by `cursorBlockTarget`. This used to
      // serialize the whole document per call and is on the keystroke path.
      const target = cursorBlockTarget(editor);
      const fallback = { type: "paragraph" } as Block;
      if (!target) return { block: fallback, prevBlock: null, nextBlock: null };
      const prev = prevBlockTarget(editor, target);
      const next = nextBlockTarget(editor, target);
      return {
        block: targetToBlock(target),
        prevBlock: prev ? targetToBlock(prev) : null,
        nextBlock: next ? targetToBlock(next) : null,
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
      // Select by which *flat block* the range touches, not by top-level
      // index: `api.document` counts one entry per list item while
      // `topLevelNodes` counts a whole list wrapper as one, so the old
      // index-pairing read the wrong block for every selection after the
      // first list — the attachment privacy gating keyed off `props.url` of
      // a block that was not even selected.
      const blocks: Block[] = [];
      for (const block of api.document as Block[]) {
        if (!block.id) continue;
        const found = findById(editor, block.id);
        if (found && found.pos < to && found.pos + found.node.nodeSize > from) {
          blocks.push(block);
        }
      }
      return { blocks };
    },

    getSelectedText() {
      const { from, to } = editor.state.selection;
      return from === to ? "" : editor.state.doc.textBetween(from, to, "\n");
    },

    focus() {
      editor.commands.focus();
    },

    undo() {
      editor.commands.focus();
      return (editor.commands as typeof editor.commands & { undo(): boolean }).undo();
    },

    redo() {
      editor.commands.focus();
      return (editor.commands as typeof editor.commands & { redo(): boolean }).redo();
    },

    canUndo() {
      if (editor.isDestroyed) return false;
      return (editor.can() as ReturnType<Editor["can"]> & { undo(): boolean }).undo();
    },

    canRedo() {
      if (editor.isDestroyed) return false;
      return (editor.can() as ReturnType<Editor["can"]> & { redo(): boolean }).redo();
    },

    onHistoryChange(listener) {
      if (editor.isDestroyed) return () => {};
      editor.on("transaction", listener);
      return () => editor.off("transaction", listener);
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

    getOutlineHeadings() {
      // Heading walk in the editor's own document: O(headings), for the
      // per-change outline refresh — the storage round trip
      // (`api.document`) this replaces rebuilt every block to read three.
      const items: { id: string; level: number; text: string }[] = [];
      if (editor.isDestroyed) return items;
      editor.state.doc.descendants((node) => {
        if (node.type.name !== "heading") return true;
        items.push({
          id: node.attrs?.id ? String(node.attrs.id) : "",
          level: Number(node.attrs?.level) || 1,
          text: node.textContent.trim() || "Untitled heading",
        });
        return false;
      });
      return items;
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

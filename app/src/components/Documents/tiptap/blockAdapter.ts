/**
 * Block array ⇄ ProseMirror document.
 *
 * The single translation point between the app's storage format (see
 * `blocks.ts`) and the editor's own document. Everything else in the app —
 * transforms, worker, FTS, outline, templates, export — stays on the block
 * side of this boundary, which is what keeps the Tiptap migration contained
 * (plan.md §2).
 *
 * Round-trip fidelity is the contract: `pmDocToBlocks(blocksToPmDoc(x))` must
 * equal `x` for every block the schema knows. `blockAdapter.test.ts` holds
 * that to real documents, not hand-written fixtures.
 */
import {
  ATOM_BLOCKS,
  LIST_BLOCKS,
  isListBlock,
  withStyleDefaults,
  type Block,
  type InlineContent,
  type TableContent,
} from "./blocks";
import { inlineToPm, pmToInline, type PmInline } from "./inlineAdapter";

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[] | PmInline[];
}

// ── ids ─────────────────────────────────────────────────────────────────────

/**
 * Every node entering the editor gets an id here.
 *
 * The UniqueID extension only assigns ids from a transaction, so content
 * handed to `setContent` (which is how every document loads) would arrive with
 * `id: null` and stay that way until the block was edited. `DocumentOutline`
 * scrolls to a heading by id, and `DocEditorApi` locates blocks by id, so
 * neither would work on a freshly opened document.
 *
 * Stored ids are reused, which is what keeps them stable across a save/load
 * cycle rather than renumbering the document every time it is opened.
 */
function newBlockId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `block-${Math.random().toString(36).slice(2, 11)}`;
}

function idAttr(block: Block): { id: string } {
  return { id: block.id ?? newBlockId() };
}

// ── props ⇄ attrs ───────────────────────────────────────────────────────────

/** Shared block props travel as attrs. `textAlignment` is renamed to match
 *  Tiptap's TextAlign extension, which owns that attribute name. */
function propsToAttrs(props: Record<string, unknown> = {}): Record<string, unknown> {
  const { textAlignment, ...rest } = props;
  return { ...rest, ...(textAlignment ? { textAlign: textAlignment } : {}) };
}

/**
 * Attrs back to props — dropping `id`.
 *
 * `id` is a block-level field in the storage format (`block.id`), not a prop,
 * but the UniqueID extension models it as a node attr. Without this it would
 * land in `props.id` on every block, changing the serialized content of every
 * document the editor touches.
 *
 * `uploadId` is editor-transient (see `pendingUploads`). Stripping it here is
 * what guarantees an autosave firing mid-upload cannot write it to storage.
 *
 * `colwidth`/`align` are prosemirror-tables' own cell geometry — the storage
 * format spells unset attrs as *absent*, so they are dropped along with every
 * other null-valued attr (tiptap's "unset") rather than leaking into props.
 */
function attrsToProps(attrs: Record<string, unknown> = {}): Record<string, unknown> {
  const { textAlign, id: _id, uploadId: _uploadId, ...rest } = attrs;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === null || key === "colwidth" || key === "align") continue;
    out[key] = value;
  }
  return { ...out, ...(textAlign ? { textAlignment: textAlign } : {}) };
}

/** Style props the storage format never defined for a type, even though the
 *  editor's schema declares them (with defaults) — `BLOCK_STYLE_PROPS` in
 *  `blocks.ts` is the authority. Stripping them keeps schema defaults from
 *  leaking into stored content on every save. */
const FOREIGN_STYLE_PROPS: Record<string, readonly string[]> = {
  image: ["textColor"],
  table: ["backgroundColor"],
};

function withoutForeignStyleProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const foreign = FOREIGN_STYLE_PROPS[type];
  if (!foreign) return props;
  const out = { ...props };
  for (const key of foreign) delete out[key];
  return out;
}

/** The block-level id, when the editor has assigned one. */
function attrsToId(attrs: Record<string, unknown> = {}): { id?: string } {
  return attrs.id ? { id: String(attrs.id) } : {};
}

/** Table geometry lives in the block's `content`, not its `props`. It rides
 *  along as node attrs because ProseMirror has nowhere else to put it. */
const TABLE_GEOMETRY_ATTRS = ["columnWidths", "headerRows", "headerCols"] as const;

function withoutTableGeometry(attrs: Record<string, unknown>): Record<string, unknown> {
  const out = { ...attrs };
  for (const key of TABLE_GEOMETRY_ATTRS) delete out[key];
  return out;
}

// ── blocks → ProseMirror ────────────────────────────────────────────────────

function tableToPm(content: TableContent, attrs: Record<string, unknown>): PmNode {
  const headerRows = content.headerRows ?? 0;
  return {
    type: "table",
    attrs: {
      ...attrs,
      columnWidths: content.columnWidths ?? [],
      ...(content.headerCols === undefined ? {} : { headerCols: content.headerCols }),
    },
    content: (content.rows ?? []).map((row, rowIndex) => ({
      type: "tableRow",
      content: (row.cells ?? []).map((cell) => ({
        type: rowIndex < headerRows ? "tableHeader" : "tableCell",
        attrs: propsToAttrs(cell.props as Record<string, unknown>),
        // Cells hold block content in ProseMirror, not bare inline content.
        content: [{ type: "paragraph", content: inlineToPm(cell.content) }],
      })),
    })),
  };
}

/** A block's inline content, accepting the plain-string shorthand. */
function blockInline(block: Block): InlineContent[] | string | undefined {
  return Array.isArray(block.content) || typeof block.content === "string"
    ? (block.content as InlineContent[] | string)
    : undefined;
}

function blockToPm(block: Block): PmNode {
  // The stored id rides back into the node so a save/load cycle does not
  // renumber every block — DocumentOutline scrolls to headings by id.
  const attrs = { ...propsToAttrs(block.props), ...idAttr(block) };
  const type = block.type;

  if (type === "table" && block.content && !Array.isArray(block.content)) {
    return tableToPm(block.content as TableContent, attrs);
  }
  if (type === "divider") return { type: "horizontalRule", attrs };
  if (ATOM_BLOCKS.has(type)) return { type, attrs };
  if (type === "quote") {
    // A blockquote wraps block content; our `quote` holds inline content
    // directly, so it gains and loses a paragraph across the boundary.
    return {
      type: "blockquote",
      attrs,
      content: [{ type: "paragraph", content: inlineToPm(blockInline(block)) }],
    };
  }
  if (type === "codeBlock") {
    return { type: "codeBlock", attrs, content: inlineToPm(blockInline(block)) };
  }
  return { type, attrs, content: inlineToPm(blockInline(block)) };
}

/** One flat list item, plus any nested list its children describe. */
function listItemToPm(block: Block, itemType: string): PmNode {
  const content: PmNode[] = [
    { type: "paragraph", content: inlineToPm(blockInline(block)) },
  ];
  content.push(...groupBlocks(block.children ?? []));
  return {
    type: itemType,
    attrs: { ...propsToAttrs(block.props), ...idAttr(block) },
    content,
  };
}

/** Walks a flat block array, wrapping runs of list items in their list node.
 *  Consecutive items of the *same* type share one wrapper; a change of type
 *  starts a new list, which is what makes `- a` then `1. b` two lists. */
function groupBlocks(blocks: readonly Block[]): PmNode[] {
  const out: PmNode[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (!isListBlock(block.type)) {
      out.push(blockToPm(block));
      index += 1;
      continue;
    }
    const { wrapper, item } = LIST_BLOCKS[block.type];
    const items: PmNode[] = [];
    while (index < blocks.length && blocks[index].type === block.type) {
      items.push(listItemToPm(blocks[index], item));
      index += 1;
    }
    out.push({ type: wrapper, content: items });
  }
  return out;
}

/** Block array → a ProseMirror `doc` node, ready for `setContent`. */
export function blocksToPmDoc(blocks: readonly Block[]): PmNode {
  const content = groupBlocks(blocks);
  // ProseMirror rejects an empty doc for a schema whose content is `block+`.
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ── ProseMirror → blocks ────────────────────────────────────────────────────

function pmTableToContent(node: PmNode): TableContent {
  const rows = (node.content ?? []) as PmNode[];
  // `headerRows` must be the LEADING run of all-header rows: tableToPm
  // restores header status by `rowIndex < headerRows`, so counting a
  // mid-table all-header row (reachable via per-cell header toggling)
  // moved the header to the top on the next load, rewriting the table.
  // The `length > 0` clause keeps a cell-less (schema-valid, vacuously
  // "all headers") row from counting.
  let headerRows = 0;
  while (
    headerRows < rows.length
    && ((rows[headerRows].content ?? []) as PmNode[]).length > 0
    && ((rows[headerRows].content ?? []) as PmNode[]).every((cell) => cell.type === "tableHeader")
  ) {
    headerRows += 1;
  }
  const built = rows.map((row) => {
    const cells = ((row.content ?? []) as PmNode[]).map((cell) => ({
      type: "tableCell" as const,
      content: pmToInline(blockInlineContent(cell)),
      props: attrsToProps(cell.attrs) as never,
    }));
    return { cells };
  });
  const headerCols = node.attrs?.headerCols;
  return {
    type: "tableContent",
    columnWidths: (node.attrs?.columnWidths as (number | null)[]) ?? [],
    ...(headerCols === undefined ? {} : { headerCols: headerCols as number }),
    headerRows,
    rows: built,
  };
}

/** Blockquotes and table cells hold *block* content in ProseMirror; the
 *  storage format keeps only flat inline content. This editor's Enter
 *  creates multi-paragraph quotes and cells, so every child paragraph's
 *  inline content is collected — keeping only the first paragraph's (what
 *  this replaced) silently deleted the rest on save and in export. The
 *  paragraphs are joined with no boundary, the same lossy shape the
 *  markdown importer already produces for multi-paragraph quotes. */
function blockInlineContent(node: PmNode): PmInline[] {
  const out: PmInline[] = [];
  for (const child of (node.content ?? []) as PmNode[]) {
    out.push(...((child.content ?? []) as PmInline[]));
  }
  return out;
}

/** The first child paragraph's inline content — list items only: everything
 *  after it is nested structure that `pmListItemToBlock` keeps as
 *  `children`, so joining here would duplicate it. */
function firstParagraphInline(node: PmNode): PmInline[] {
  const first = ((node.content ?? []) as PmNode[])[0];
  return (first?.content ?? []) as PmInline[];
}

function pmToBlock(node: PmNode): Block {
  const id = attrsToId(node.attrs);

  if (node.type === "table") {
    return {
      ...id,
      type: "table",
      props: withStyleDefaults(
        "table",
        withoutForeignStyleProps("table", withoutTableGeometry(attrsToProps(node.attrs))),
      ),
      content: pmTableToContent(node),
    };
  }
  if (node.type === "horizontalRule") return { ...id, type: "divider", props: {} };
  if (node.type === "blockquote") {
    return {
      ...id,
      type: "quote",
      props: withStyleDefaults("quote", attrsToProps(node.attrs)),
      content: pmToInline(blockInlineContent(node)),
    };
  }
  if (ATOM_BLOCKS.has(node.type)) {
    return {
      ...id,
      type: node.type,
      props: withStyleDefaults(node.type, withoutForeignStyleProps(node.type, attrsToProps(node.attrs))),
    };
  }
  return {
    ...id,
    type: node.type,
    props: withStyleDefaults(node.type, attrsToProps(node.attrs)),
    content: pmToInline((node.content ?? []) as PmInline[]),
  };
}

/** A ProseMirror list item back to one flat block, plus its nested children. */
function pmListItemToBlock(node: PmNode, blockType: string): Block {
  const children = (node.content ?? []) as PmNode[];
  return {
    ...attrsToId(node.attrs),
    type: blockType,
    props: withStyleDefaults(blockType, attrsToProps(node.attrs)),
    content: pmToInline(firstParagraphInline(node)),
    // Everything after the item's own paragraph is nested structure.
    children: ungroupNodes(children.slice(1)),
  };
}

const WRAPPER_TO_BLOCK: Record<string, string> = {
  bulletList: "bulletListItem",
  orderedList: "numberedListItem",
  taskList: "checkListItem",
};

/** Unwraps list nodes back into flat runs of list-item blocks. */
function ungroupNodes(nodes: readonly PmNode[]): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    const blockType = WRAPPER_TO_BLOCK[node.type];
    if (blockType) {
      for (const item of (node.content ?? []) as PmNode[]) {
        out.push(pmListItemToBlock(item, blockType));
      }
      continue;
    }
    out.push(pmToBlock(node));
  }
  return out;
}

/** ProseMirror `doc` node → block array, the app's storage format. */
export function pmDocToBlocks(doc: PmNode | null | undefined): Block[] {
  if (!doc?.content) return [];
  return ungroupNodes(doc.content as PmNode[]);
}

/**
 * One *live* ProseMirror node → its block, without touching anything else in
 * the document. The O(local) counterpart of `pmDocToBlocks`, used on the
 * per-keystroke path (`getTextCursorPosition`), where serializing a large
 * document just to find the block under the cursor would be the whole render
 * budget on its own.
 *
 * `parentType` is the live parent node's type name: it is the only place the
 * list wrapper → item-block mapping survives (`bulletList` → `bulletListItem`),
 * exactly as in `ungroupNodes`.
 */
export function pmNodeToBlock(
  node: { toJSON(): unknown; type: { name: string } },
  parentType: string,
): Block {
  const json = node.toJSON() as PmNode;
  const blockType = WRAPPER_TO_BLOCK[parentType];
  return blockType ? pmListItemToBlock(json, blockType) : pmToBlock(json);
}

/**
 * The app's document interchange format.
 *
 * This is the shape stored in `documents.content` and written to markdown
 * files' sidecar state — a flat array of blocks, nesting only through
 * `children`. It originated as BlockNote's block format, but it is NOT a
 * BlockNote implementation detail: `docFormat.blocksToText` (FTS + word
 * count), `mermaidTransforms`, `mediaTransforms`, `localFileBlocks`,
 * `trailingEditorParagraph`, `DocumentOutline`, `BlockTemplatesMenu` and the
 * document worker all speak it directly.
 *
 * Keeping it fixed is what makes the Tiptap migration a swap of the editor
 * rather than a rewrite of the app (see plan.md §2). ProseMirror's own nested
 * document is confined to the editor; `blockAdapter` is the only translation
 * point.
 */

/** Inline styles a text run can carry. Mirrors the mark set in `schema.ts`. */
export interface InlineStyles {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
}

export interface TextInline {
  type: "text";
  text: string;
  styles: InlineStyles;
}

export interface LinkInline {
  type: "link";
  href: string;
  content: TextInline[];
}

export type InlineContent = TextInline | LinkInline;

export interface TableCell {
  type: "tableCell";
  content: InlineContent[];
  props: {
    colspan: number;
    rowspan: number;
    backgroundColor: string;
    textColor: string;
    textAlignment: string;
  };
}

export interface TableContent {
  type: "tableContent";
  columnWidths: (number | null)[];
  headerRows?: number;
  headerCols?: number;
  rows: { cells: TableCell[] }[];
}

export interface Block {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[] | TableContent | string;
  children?: Block[];
}

/** The styling props a block carries, per type, with their defaults.
 *
 *  Deliberately per-type rather than one blanket set: a `quote` has no
 *  `textAlignment`, a `codeBlock` carries only its `language`, and a `table`
 *  only `textColor`. Applying all three everywhere invents props the parser
 *  never emits, and a round trip then no longer equals what was stored.
 *  Verified against the real parser in `blockAdapter.test.ts`. */
const STYLE_DEFAULTS = {
  backgroundColor: "default",
  textColor: "default",
  textAlignment: "left",
} as const;

type StyleProp = keyof typeof STYLE_DEFAULTS;

const ALL_STYLE_PROPS: StyleProp[] = ["backgroundColor", "textColor", "textAlignment"];

const BLOCK_STYLE_PROPS: Record<string, StyleProp[]> = {
  quote: ["backgroundColor", "textColor"],
  codeBlock: [],
  table: ["textColor"],
  image: ["backgroundColor", "textAlignment"],
  divider: [],
  video: [],
  audio: [],
  file: [],
  mermaid: [],
  youtube: [],
};

/** Restores the styling defaults for a block type, so a block that went
 *  through the editor is shaped like one straight from the parser. */
export function withStyleDefaults(
  type: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const prop of BLOCK_STYLE_PROPS[type] ?? ALL_STYLE_PROPS) {
    defaults[prop] = STYLE_DEFAULTS[prop];
  }
  return { ...defaults, ...props };
}

/** Flat list blocks, and the ProseMirror wrapper/item pair each expands into.
 *
 *  This is the one genuinely structural difference between the two models:
 *  our format (like BlockNote's) keeps list items flat and nests through
 *  `children`, while ProseMirror wraps runs of items in a list node. The
 *  adapter groups on the way in and ungroups on the way out. */
export const LIST_BLOCKS = {
  bulletListItem: { wrapper: "bulletList", item: "listItem" },
  numberedListItem: { wrapper: "orderedList", item: "listItem" },
  checkListItem: { wrapper: "taskList", item: "taskItem" },
} as const;

export type ListBlockType = keyof typeof LIST_BLOCKS;

export function isListBlock(type: string): type is ListBlockType {
  return type in LIST_BLOCKS;
}

/** Blocks with no editable inline content — they render from props alone.
 *  ProseMirror models these as atoms, so they never receive a text cursor. */
export const ATOM_BLOCKS = new Set([
  "image",
  "video",
  "audio",
  "file",
  "mermaid",
  "youtube",
  "divider",
]);

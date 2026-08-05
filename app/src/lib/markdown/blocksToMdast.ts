/**
 * The app's block format → markdown (as mdast).
 *
 * Replaces BlockNote's `blocksToMarkdownLossy`. "Lossy" is accurate and
 * deliberate: markdown has no syntax for a video or a YouTube player, which is
 * exactly why `mediaTransforms.lowerMedia` / `lowerYouTube` run *before* this
 * and encode those types into something markdown can carry.
 */
import type { Block, InlineContent, InlineStyles, TableContent } from "@/components/Documents/tiptap/blocks";

interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  spread?: boolean;
  checked?: boolean | null;
  lang?: string | null;
  url?: string;
  alt?: string | null;
  align?: (string | null)[];
  children?: MdNode[];
}

/** Wraps a text run in the mark nodes its styles call for. Order matters only
 *  for output aesthetics; nesting is what markdown requires. */
function styled(text: string, styles: InlineStyles | undefined): MdNode {
  if (styles?.code) return { type: "inlineCode", value: text };
  let node: MdNode = { type: "text", value: text };
  if (styles?.strike) node = { type: "delete", children: [node] };
  if (styles?.italic) node = { type: "emphasis", children: [node] };
  if (styles?.bold) node = { type: "strong", children: [node] };
  return node;
}

function inlineToMdast(content: InlineContent[] | undefined): MdNode[] {
  const out: MdNode[] = [];
  for (const part of content ?? []) {
    if (part.type === "link") {
      out.push({
        type: "link",
        url: part.href ?? "",
        children: inlineToMdast(part.content as InlineContent[]),
      });
      continue;
    }
    if (!part.text) continue;
    out.push(styled(part.text, part.styles));
  }
  return out;
}

function tableToMdast(content: TableContent): MdNode {
  const rows = content.rows ?? [];
  return {
    type: "table",
    align: (content.columnWidths ?? []).map(() => null),
    children: rows.map((row) => ({
      type: "tableRow",
      children: (row.cells ?? []).map((cell) => ({
        type: "tableCell",
        children: inlineToMdast(cell.content),
      })),
    })),
  };
}

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

function listItemToMdast(block: Block): MdNode {
  const children: MdNode[] = [
    { type: "paragraph", children: inlineToMdast(block.content as InlineContent[]) },
  ];
  children.push(...groupToMdast(block.children ?? []));
  return {
    type: "listItem",
    spread: false,
    checked: block.type === "checkListItem" ? Boolean(block.props?.checked) : null,
    children,
  };
}

function blockToMdast(block: Block): MdNode | null {
  switch (block.type) {
    case "heading":
      return {
        type: "heading",
        depth: Number(block.props?.level) || 1,
        children: inlineToMdast(block.content as InlineContent[]),
      };
    case "paragraph":
      return { type: "paragraph", children: inlineToMdast(block.content as InlineContent[]) };
    case "quote":
      return {
        type: "blockquote",
        children: [{ type: "paragraph", children: inlineToMdast(block.content as InlineContent[]) }],
      };
    case "codeBlock":
      return {
        type: "code",
        lang: (block.props?.language as string) || null,
        value: (block.content as InlineContent[] | undefined)
          ?.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "",
      };
    case "divider":
      return { type: "thematicBreak" };
    case "table":
      return block.content ? tableToMdast(block.content as TableContent) : null;
    case "image":
    case "video":
    case "audio":
    case "file":
      // Only `image` has real markdown syntax. The others reach here already
      // rewritten by `lowerMedia`, which tags the URL so the type survives.
      return {
        type: "paragraph",
        children: [{
          type: "image",
          url: String(block.props?.url ?? ""),
          alt: String(block.props?.caption || block.props?.name || ""),
        }],
      };
    default:
      // Unknown block: keep whatever text it has rather than dropping it.
      return Array.isArray(block.content)
        ? { type: "paragraph", children: inlineToMdast(block.content as InlineContent[]) }
        : null;
  }
}

/** Wraps runs of flat list items into mdast list nodes. */
function groupToMdast(blocks: readonly Block[]): MdNode[] {
  const out: MdNode[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (!LIST_TYPES.has(block.type)) {
      const node = blockToMdast(block);
      if (node) out.push(node);
      index += 1;
      continue;
    }
    const items: MdNode[] = [];
    while (index < blocks.length && blocks[index].type === block.type) {
      items.push(listItemToMdast(blocks[index]));
      index += 1;
    }
    out.push({
      type: "list",
      ordered: block.type === "numberedListItem",
      spread: false,
      children: items,
    });
  }
  return out;
}

/** Blocks → an mdast root, ready for remark-stringify. */
export function blocksToMdast(blocks: readonly Block[]): { type: "root"; children: MdNode[] } {
  return { type: "root", children: groupToMdast(blocks) };
}

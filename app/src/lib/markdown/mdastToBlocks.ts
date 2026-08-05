/**
 * Markdown (as mdast) → the app's block format.
 *
 * Replaces BlockNote's `tryParseMarkdownToBlocks`. Working on mdast directly
 * means no editor instance is needed, so this runs in the document worker with
 * no DOM — which the previous headless-BlockNote approach only managed because
 * BlockNote happened to support it, and Tiptap does not.
 *
 * The output must match what BlockNote produced, block for block, because
 * `mediaTransforms` / `mermaidTransforms` / `localFileBlocks` all pattern-match
 * on those exact shapes. `mediaTransforms.markdown.test.ts` is the contract.
 */
import type { Block, InlineContent, InlineStyles, TableContent } from "@/components/Documents/tiptap/blocks";

interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  checked?: boolean | null;
  lang?: string | null;
  url?: string;
  alt?: string | null;
  title?: string | null;
  align?: (string | null)[];
  children?: MdNode[];
}

const STYLE_FOR_NODE: Record<string, keyof InlineStyles> = {
  strong: "bold",
  emphasis: "italic",
  delete: "strike",
};

/** Inline mdast → inline content, carrying styles down through nesting. */
function inlineFrom(nodes: MdNode[] | undefined, styles: InlineStyles = {}): InlineContent[] {
  const out: InlineContent[] = [];
  for (const node of nodes ?? []) {
    const style = STYLE_FOR_NODE[node.type];
    if (style) {
      out.push(...inlineFrom(node.children, { ...styles, [style]: true }));
      continue;
    }
    switch (node.type) {
      case "text":
        if (node.value) out.push({ type: "text", text: node.value, styles: { ...styles } });
        break;
      case "inlineCode":
        // BlockNote treats inline code as exclusive of other styles.
        if (node.value) out.push({ type: "text", text: node.value, styles: { code: true } });
        break;
      case "link":
        out.push({
          type: "link",
          href: node.url ?? "",
          content: inlineFrom(node.children, styles) as never,
        });
        break;
      case "break":
        out.push({ type: "text", text: "\n", styles: { ...styles } });
        break;
      case "image":
        // An image inside a paragraph with other content stays inline text —
        // only a standalone one becomes an image block (see blockFrom).
        out.push({ type: "text", text: node.alt || node.url || "", styles: { ...styles } });
        break;
      case "html":
        if (node.value) out.push({ type: "text", text: node.value, styles: { ...styles } });
        break;
      default:
        if (node.children) out.push(...inlineFrom(node.children, styles));
        else if (node.value) out.push({ type: "text", text: node.value, styles: { ...styles } });
    }
  }
  return out;
}

const STYLE_PROPS = { backgroundColor: "default", textColor: "default", textAlignment: "left" };

/** A paragraph that is nothing but one image becomes an image block — the same
 *  promotion BlockNote performs, and what `liftYouTube` relies on for the
 *  `![title](url)` shape. */
function loneImage(node: MdNode): MdNode | null {
  const children = (node.children ?? []).filter(
    (child) => !(child.type === "text" && !child.value?.trim()),
  );
  return children.length === 1 && children[0].type === "image" ? children[0] : null;
}

function imageBlock(node: MdNode): Block {
  return {
    type: "image",
    props: {
      textAlignment: "left",
      backgroundColor: "default",
      name: node.alt || "",
      url: node.url ?? "",
      caption: "",
      showPreview: true,
    },
  };
}

function tableFrom(node: MdNode): TableContent {
  const rows = (node.children ?? []).map((row) => ({
    cells: (row.children ?? []).map((cell) => ({
      type: "tableCell" as const,
      content: inlineFrom(cell.children),
      props: { colspan: 1, rowspan: 1, ...STYLE_PROPS },
    })),
  }));
  return {
    type: "tableContent",
    columnWidths: (rows[0]?.cells ?? []).map(() => null),
    headerRows: 1,
    rows,
  };
}

/** List items are flattened: our format keeps them at top level and nests
 *  through `children`, which is the shape every downstream transform expects. */
function listItems(node: MdNode): Block[] {
  const out: Block[] = [];
  for (const item of node.children ?? []) {
    const checked = item.checked;
    const type = checked === null || checked === undefined
      ? (node.ordered ? "numberedListItem" : "bulletListItem")
      : "checkListItem";

    const inlineChildren = (item.children ?? []).filter((child) => child.type === "paragraph");
    const nested = (item.children ?? []).filter((child) => child.type === "list");
    const other = (item.children ?? []).filter(
      (child) => child.type !== "paragraph" && child.type !== "list",
    );

    const children = [
      ...nested.flatMap(listItems),
      ...other.flatMap((child) => blockFrom(child)),
      // A list item holding several paragraphs keeps the first as its own text
      // and the rest as nested paragraphs, which is how BlockNote rendered it.
      ...inlineChildren.slice(1).flatMap((child) => blockFrom(child)),
    ];

    out.push({
      type,
      props: { ...STYLE_PROPS, ...(type === "checkListItem" ? { checked: Boolean(checked) } : {}) },
      content: inlineFrom(inlineChildren[0]?.children),
      ...(children.length ? { children } : {}),
    });
  }
  return out;
}

function blockFrom(node: MdNode): Block[] {
  switch (node.type) {
    case "heading":
      return [{
        type: "heading",
        props: { ...STYLE_PROPS, level: node.depth ?? 1, isToggleable: false },
        content: inlineFrom(node.children),
      }];
    case "paragraph": {
      const image = loneImage(node);
      if (image) return [imageBlock(image)];
      return [{ type: "paragraph", props: { ...STYLE_PROPS }, content: inlineFrom(node.children) }];
    }
    case "blockquote":
      // Our `quote` holds inline content directly, so a multi-paragraph quote
      // collapses to its text — the same lossy shape BlockNote produced.
      return [{
        type: "quote",
        props: { backgroundColor: "default", textColor: "default" },
        content: (node.children ?? []).flatMap((child) => inlineFrom(child.children)),
      }];
    case "code":
      return [{
        type: "codeBlock",
        props: { language: node.lang || "text" },
        content: node.value ? [{ type: "text", text: node.value, styles: {} }] : [],
      }];
    case "list":
      return listItems(node);
    case "table":
      return [{ type: "table", props: { textColor: "default" }, content: tableFrom(node) }];
    case "thematicBreak":
      return [{ type: "divider", props: {} }];
    case "image":
      return [imageBlock(node)];
    case "html":
      return [{
        type: "paragraph",
        props: { ...STYLE_PROPS },
        content: node.value ? [{ type: "text", text: node.value, styles: {} }] : [],
      }];
    default:
      if (node.children?.length) {
        return [{ type: "paragraph", props: { ...STYLE_PROPS }, content: inlineFrom(node.children) }];
      }
      return [];
  }
}

/** mdast root → blocks. */
export function mdastToBlocks(root: { children?: MdNode[] }): Block[] {
  return (root.children ?? []).flatMap(blockFrom);
}

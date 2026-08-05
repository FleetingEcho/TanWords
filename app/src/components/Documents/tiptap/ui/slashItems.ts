/**
 * What the slash menu can insert.
 *
 * Kept free of React so the list can be unit-tested and reused by any other
 * insert affordance (the toolbar's block-templates menu inserts the same
 * shapes).
 */
import type { Editor } from "@tiptap/core";

export interface SlashItem {
  id: string;
  /** i18n key for the visible label. */
  titleKey: string;
  /** Extra words that should match this item when typed. */
  keywords: string[];
  run: (editor: Editor) => void;
}

/** Replaces the typed `/query` before inserting, so the slash text does not
 *  survive in the document. */
function replaceRange(editor: Editor, range: { from: number; to: number }) {
  return editor.chain().focus().deleteRange(range);
}

export function buildSlashItems(range: { from: number; to: number }): SlashItem[] {
  return [
    {
      id: "paragraph",
      titleKey: "doc.slashParagraph",
      keywords: ["text", "paragraph", "p"],
      run: (editor) => replaceRange(editor, range).setNode("paragraph").run(),
    },
    ...[1, 2, 3].map((level) => ({
      id: `heading${level}`,
      titleKey: `doc.slashHeading${level}`,
      keywords: ["heading", "title", `h${level}`],
      run: (editor: Editor) =>
        replaceRange(editor, range).setNode("heading", { level }).run(),
    })),
    {
      id: "bulletList",
      titleKey: "doc.slashBulletList",
      keywords: ["bullet", "list", "unordered", "ul"],
      run: (editor) => replaceRange(editor, range).toggleBulletList().run(),
    },
    {
      id: "orderedList",
      titleKey: "doc.slashOrderedList",
      keywords: ["numbered", "list", "ordered", "ol"],
      run: (editor) => replaceRange(editor, range).toggleOrderedList().run(),
    },
    {
      id: "taskList",
      titleKey: "doc.slashTaskList",
      keywords: ["todo", "task", "check", "checkbox"],
      run: (editor) => replaceRange(editor, range).toggleTaskList().run(),
    },
    {
      id: "quote",
      titleKey: "doc.slashQuote",
      keywords: ["quote", "blockquote", "callout"],
      run: (editor) => replaceRange(editor, range).toggleBlockquote().run(),
    },
    {
      id: "codeBlock",
      titleKey: "doc.slashCodeBlock",
      keywords: ["code", "snippet", "pre"],
      run: (editor) => replaceRange(editor, range).toggleCodeBlock().run(),
    },
    {
      id: "table",
      titleKey: "doc.slashTable",
      keywords: ["table", "grid"],
      run: (editor) =>
        replaceRange(editor, range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      id: "divider",
      titleKey: "doc.slashDivider",
      keywords: ["divider", "rule", "separator", "hr"],
      run: (editor) => replaceRange(editor, range).setHorizontalRule().run(),
    },
    {
      id: "mermaid",
      titleKey: "doc.slashMermaid",
      keywords: ["mermaid", "diagram", "chart", "graph"],
      run: (editor) =>
        replaceRange(editor, range)
          .insertContent({ type: "mermaid", attrs: { code: "" } })
          .run(),
    },
    {
      id: "youtube",
      titleKey: "doc.slashYouTube",
      keywords: ["youtube", "video", "embed"],
      run: (editor) =>
        replaceRange(editor, range)
          .insertContent({ type: "youtube", attrs: { url: "", caption: "" } })
          .run(),
    },
  ];
}

/** Case-insensitive match over the label and its keywords. */
export function filterSlashItems(
  items: SlashItem[],
  query: string,
  label: (key: string) => string,
): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    label(item.titleKey).toLowerCase().includes(needle)
    || item.keywords.some((keyword) => keyword.includes(needle)),
  );
}

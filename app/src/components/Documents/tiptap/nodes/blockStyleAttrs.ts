/**
 * `backgroundColor` / `textColor` as global attributes on block nodes.
 *
 * Without this the schema silently discards them: ProseMirror drops any attr a
 * node never declared, so a block with a non-default colour comes back from the
 * editor with its colour reset. The defaults hide the bug — only a *changed*
 * colour is lost, which makes it the kind of thing that ships.
 *
 * Kept as a global attribute rather than added to each node's
 * `addAttributes()` so the list of styled nodes lives in one place.
 */
import { Extension } from "@tiptap/core";

/** Nodes carrying the shared colour props. Mirrors `BLOCK_STYLE_PROPS` in
 *  `blocks.ts` — every type there with a colour entry appears here. */
const STYLED_NODES = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "table",
  "tableCell",
  "tableHeader",
  "image",
];

export const BlockStyleAttrs = Extension.create({
  name: "blockStyleAttrs",
  addGlobalAttributes() {
    return [
      {
        // Collapsible headings are a stored prop we do not yet expose in the
        // UI. Declared anyway: an attr the schema does not know is discarded
        // on load, which would silently rewrite existing documents.
        types: ["heading"],
        attributes: {
          isToggleable: {
            default: false,
            renderHTML: (attrs) =>
              attrs.isToggleable ? { "data-toggleable": "true" } : {},
            parseHTML: (element) => element.getAttribute("data-toggleable") === "true",
          },
        },
      },
      {
        types: STYLED_NODES,
        attributes: {
          backgroundColor: {
            default: "default",
            renderHTML: (attrs) =>
              attrs.backgroundColor && attrs.backgroundColor !== "default"
                ? { "data-background-color": attrs.backgroundColor }
                : {},
            parseHTML: (element) => element.getAttribute("data-background-color") ?? "default",
          },
          textColor: {
            default: "default",
            renderHTML: (attrs) =>
              attrs.textColor && attrs.textColor !== "default"
                ? { "data-text-color": attrs.textColor }
                : {},
            parseHTML: (element) => element.getAttribute("data-text-color") ?? "default",
          },
        },
      },
    ];
  },
});

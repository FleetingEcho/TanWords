import fs from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.CSS = dom.window.CSS;
dom.window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

const { BlockNoteEditor } = await import("@blocknote/core");
const { editorSchema } = await import("./src/components/Documents/editorSchema.ts");
const { htmlToMarkdown } = await import("./src/lib/htmlToMarkdown.ts");

const html = fs.readFileSync("/tmp/tailscale.html", "utf8");
const a = html.indexOf("<main");
const b = html.indexOf("</main>", a);
const mainHtml = html.slice(a, b + 7);
const md = htmlToMarkdown(mainHtml);
console.log("md len", md.length);

const editor = BlockNoteEditor.create({ schema: editorSchema });
try {
  const blocks = editor.tryParseMarkdownToBlocks(md);
  console.log("MD PARSE OK", blocks.length, blocks.map((x) => x.type).slice(0, 20).join(","));
  editor.replaceBlocks(editor.document, blocks);
  console.log("REPLACE OK");
} catch (e) {
  console.log("MD PATH ERR", e?.message);
}

const editor2 = BlockNoteEditor.create({ schema: editorSchema });
try {
  const blocks = editor2.tryParseHTMLToBlocks(mainHtml);
  console.log("HTML PARSE OK", blocks.length);
} catch (e) {
  console.log("HTML PATH ERR", e?.message);
}

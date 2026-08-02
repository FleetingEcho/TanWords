import { parseFragment } from "parse5";

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  value?: string;
};

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "figure",
  "table", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "blockquote", "pre", "hr",
]);

function tagOf(node: HtmlNode): string {
  return (node.tagName ?? node.nodeName).toLowerCase();
}

function attr(node: HtmlNode, name: string): string {
  return node.attrs?.find((a) => a.name.toLowerCase() === name)?.value ?? "";
}

function textOf(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(textOf).join("");
}

function inlineHtml(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  const tag = tagOf(node);
  const children = (node.childNodes ?? []).map(inlineHtml).join("");
  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") {
    const inner = children.trim();
    return inner ? `**${inner}**` : "";
  }
  if (tag === "em" || tag === "i") {
    const inner = children.trim();
    return inner ? `*${inner}*` : "";
  }
  if (tag === "code") {
    const inner = textOf(node).trim();
    return inner ? `\`${inner}\`` : "";
  }
  if (tag === "a") {
    const inner = children.trim();
    const href = attr(node, "href");
    if (!inner) return "";
    return /^https?:\/\//i.test(href) && inner !== href ? `[${inner}](${href})` : inner || href;
  }
  if (tag === "img") {
    const alt = attr(node, "alt").trim();
    const src = attr(node, "src");
    return src ? `![${alt}](${src})` : alt;
  }
  return children;
}

function renderBlocks(nodes: HtmlNode[]): string {
  const parts: string[] = [];
  let inlineRun = "";
  const flush = () => {
    const text = inlineRun.replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
    inlineRun = "";
  };
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "iframe" || tag === "svg" || tag === "template") {
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      flush();
      const block = blockHtml(node);
      if (block) parts.push(block);
    } else {
      inlineRun += inlineHtml(node);
    }
  }
  flush();
  return parts.join("\n\n");
}

function blockHtml(node: HtmlNode): string {
  const tag = tagOf(node);
  const children = () => renderBlocks(node.childNodes ?? []);
  if (/^h[1-6]$/.test(tag)) {
    const text = inlineHtml(node).trim();
    return text ? `${"#".repeat(Number(tag[1]))} ${text}` : "";
  }
  if (tag === "p") {
    return inlineHtml(node).trim();
  }
  if (tag === "hr") return "---";
  if (tag === "pre") {
    const code = textOf(node).replace(/\n+$/, "");
    return code ? `\`\`\`\n${code}\n\`\`\`` : "";
  }
  if (tag === "blockquote") {
    return children().split("\n").map((line) => `> ${line}`).join("\n");
  }
  if (tag === "ul" || tag === "ol") return listHtml(node, 0);
  if (tag === "table") return tableHtml(node);
  return children();
}

function listHtml(list: HtmlNode, depth: number): string {
  const ordered = tagOf(list) === "ol";
  const items: string[] = [];
  let n = 1;
  for (const li of list.childNodes ?? []) {
    if (tagOf(li) !== "li") continue;
    const inline: string[] = [];
    const nested: string[] = [];
    for (const child of li.childNodes ?? []) {
      const childTag = tagOf(child);
      if (childTag === "ul" || childTag === "ol") nested.push(listHtml(child, depth + 1));
      else if (BLOCK_TAGS.has(childTag)) inline.push(blockHtml(child));
      else inline.push(inlineHtml(child));
    }
    const marker = ordered ? `${n++}.` : "-";
    const text = inline.join("").replace(/\s+/g, " ").trim();
    const indent = "  ".repeat(depth);
    items.push(`${indent}${marker} ${text}${nested.length ? "\n" + nested.join("\n") : ""}`);
  }
  return items.join("\n");
}

function tableHtml(table: HtmlNode): string {
  const rows: HtmlNode[] = [];
  for (const child of table.childNodes ?? []) {
    if (tagOf(child) === "tr") rows.push(child);
    else if (tagOf(child) === "tbody" || tagOf(child) === "thead") {
      rows.push(...(child.childNodes ?? []).filter((r) => tagOf(r) === "tr"));
    }
  }
  if (rows.length === 0) return "";
  const cells = (row: HtmlNode) => (row.childNodes ?? []).filter((c) => tagOf(c) === "th" || tagOf(c) === "td");
  const first = cells(rows[0]).map((c) => inlineHtml(c).trim());
  const lines = [`| ${first.join(" | ")} |`, `| ${first.map(() => "---").join(" | ")} |`];
  for (const row of rows.slice(1)) {
    const values = cells(row).map((c) => inlineHtml(c).trim());
    lines.push(`| ${values.join(" | ")} |`);
  }
  return lines.join("\n");
}

export function htmlToMarkdown(html: string): string {
  const fragment = parseFragment(html);
  return renderBlocks((fragment as unknown as { childNodes: HtmlNode[] }).childNodes)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

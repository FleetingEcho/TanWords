import React, { useState } from "react";

/**
 * Minimal markdown → React renderer for chat messages.
 * Builds React elements directly (no innerHTML), so untrusted model output
 * can never inject markup. Covers the subset models actually emit:
 * headings, paragraphs, hr, blockquote, fenced code, lists (2 levels),
 * pipe tables, and inline code/bold/italic/links.
 */

// ── Inline parsing ──────────────────────────────────────────────────────────

const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-[0.86em]">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    } else {
      const match = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        const [, label, url] = match;
        const safe = /^https?:\/\//i.test(url);
        nodes.push(
          safe ? (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {label}
            </a>
          ) : (
            label
          )
        );
      } else {
        nodes.push(tok);
      }
    }
    last = idx + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ── Code block with copy ────────────────────────────────────────────────────

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="relative group/code my-2 rounded-lg overflow-hidden border border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between px-3 py-1 bg-black/10 dark:bg-white/5 text-[10px] font-mono text-muted-foreground">
        <span>{lang || "code"}</span>
        <button onClick={copy} className="hover:text-foreground transition-colors">
          {copied ? "✓" : "copy"}
        </button>
      </div>
      <pre className="px-3 py-2 overflow-x-auto bg-black/5 dark:bg-black/30 text-[0.86em] font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── Block parsing ───────────────────────────────────────────────────────────

interface ListItem {
  text: string;
  indent: number;
}

function renderList(items: ListItem[], ordered: boolean, keyBase: string): React.ReactNode {
  // Two-level nesting: group consecutive indented items under the previous top-level item
  const Tag = ordered ? "ol" : "ul";
  const cls = ordered ? "list-decimal" : "list-disc";
  const roots: { text: string; children: string[] }[] = [];
  for (const it of items) {
    if (it.indent > 0 && roots.length > 0) roots[roots.length - 1].children.push(it.text);
    else roots.push({ text: it.text, children: [] });
  }
  return (
    <Tag key={keyBase} className={`${cls} pl-5 my-1.5 space-y-1`}>
      {roots.map((r, i) => (
        <li key={i}>
          {renderInline(r.text, `${keyBase}-${i}`)}
          {r.children.length > 0 && (
            <ul className="list-[circle] pl-4 mt-1 space-y-0.5">
              {r.children.map((c, j) => (
                <li key={j}>{renderInline(c, `${keyBase}-${i}-${j}`)}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </Tag>
  );
}

function renderTable(rows: string[][], keyBase: string): React.ReactNode {
  const [head, ...body] = rows;
  return (
    <div key={keyBase} className="my-2 overflow-x-auto">
      <table className="w-full text-[0.92em] border-collapse">
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} className="border border-border px-2 py-1 text-left font-semibold bg-black/5 dark:bg-white/5">
                {renderInline(c, `${keyBase}-h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j} className="border border-border px-2 py-1 align-top">
                  {renderInline(c, `${keyBase}-${i}-${j}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function splitTableRow(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}

const TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or EOF)
      out.push(<CodeBlock key={key++} lang={fence[1]} code={codeLines.join("\n")} />);
      continue;
    }

    // Blank line
    if (!line.trim()) { i++; continue; }

    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const level = h[1].length;
      const sizes = ["text-[1.15em]", "text-[1.08em]", "text-[1.02em]", "text-[1em]"];
      out.push(
        <p key={key++} className={`font-bold mt-3 mb-1 ${sizes[level - 1]}`}>
          {renderInline(h[2], `h${key}`)}
        </p>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      out.push(<hr key={key++} className="my-3 border-border" />);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ") || line === ">") {
      const quote: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
        quote.push(lines[i].replace(/^> ?/, ""));
        i++;
      }
      out.push(
        <blockquote key={key++} className="border-l-2 border-border pl-3 my-2 text-muted-foreground italic">
          {quote.map((q, j) => (
            <p key={j}>{renderInline(q, `q${key}-${j}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Table: header row + separator row
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1].trim())) {
      const rows: string[][] = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push(renderTable(rows, `t${key++}`));
      continue;
    }

    // Lists (ul/ol, 2 levels via leading spaces)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
        if (!m) break;
        items.push({ indent: m[1].length, text: m[3] });
        i++;
      }
      out.push(renderList(items, ordered, `l${key++}`));
      continue;
    }

    // Paragraph: merge consecutive plain lines
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !lines[i].startsWith("> ") &&
      !/^(\s*)([-*+]|\d+\.)\s/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]?.trim() ?? ""))
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      <p key={key++} className="my-1.5 first:mt-0 last:mb-0">
        {para.map((p, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(p, `p${key}-${j}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="markdown-body">{out}</div>;
}

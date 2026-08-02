import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ListOrdered, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";

const BLOCK_PREFIX_RE = /^(#{1,6}\s+)?((?:>\s*)+|(?:[-*+]\s+)?(?:\d+\.\s+)?(?:\[[ xX]\]\s+)?|-{3,}|\*{3,}|_{3,})/;
const INLINE_TOKEN_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(\[[^\]\n]+\]\([^)\s]+\))/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) out += escapeHtml(text.slice(last, index));
    const token = match[0];
    if (token.startsWith("`")) {
      out += `<span class="rm-code">${escapeHtml(token)}</span>`;
    } else if (token.startsWith("**")) {
      out += `<span class="rm-strong">${escapeHtml(token.slice(2, -2))}</span>`;
    } else if (token.startsWith("~~")) {
      out += `<span class="rm-strike">${escapeHtml(token.slice(2, -2))}</span>`;
    } else if (token.startsWith("*")) {
      out += `<span class="rm-em">${escapeHtml(token.slice(1, -1))}</span>`;
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        out += `<span class="rm-link-label">${escapeHtml(link[1])}</span><span class="rm-link">${escapeHtml(`(${link[2]})`)}</span>`;
      } else {
        out += escapeHtml(token);
      }
    }
    last = index + token.length;
  }
  return out + escapeHtml(text.slice(last));
}

function highlightMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const html: string[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence) {
      const trimmed = line.trim();
      if (trimmed.startsWith(fence) && /^`{3,}\s*$/.test(trimmed)) {
        html.push(`<span class="rm-fence">${escapeHtml(line)}</span>`);
        fence = null;
      } else {
        html.push(`<span class="rm-code-line">${escapeHtml(line)}</span>`);
      }
      continue;
    }

    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      fence = fenceMatch[1][0] === "~" ? "~~~" : "```";
      html.push(`<span class="rm-fence">${escapeHtml(line)}</span>`);
      continue;
    }

    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      html.push(`<span class="rm-hr">${escapeHtml(line)}</span>`);
      continue;
    }

    if (/^(#{1,6})\s/.test(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        html.push(`<span class="rm-heading">${escapeHtml(match[1])}</span> <span class="rm-heading-text">${renderInline(match[2])}</span>`);
        continue;
      }
    }

    const prefix = line.match(BLOCK_PREFIX_RE)?.[0] ?? "";
    if (prefix) {
      const rest = line.slice(prefix.length);
      const trimmedPrefix = prefix.trimEnd();
      html.push(`<span class="rm-block">${escapeHtml(trimmedPrefix)}</span>${rest ? `<span>${renderInline(rest)}</span>` : ""}`);
      continue;
    }

    html.push(renderInline(line));
  }

  if (fence) {
    html.push(`<span class="rm-fence">${escapeHtml("```")}</span>`);
  }
  return html.join("<br/>");
}

export function RawMarkdownEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preScrollRef = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState(
    () => localStorage.getItem("tanwords_raw_markdown_wrap") !== "0",
  );
  const [showLineNumbers, setShowLineNumbers] = useState(
    () => localStorage.getItem("tanwords_raw_markdown_lines") !== "0",
  );
  const [editorColumns, setEditorColumns] = useState(80);

  const lineNumbers = useMemo(() => value.split("\n").map((line, index) => {
    const expandedLength = line.replace(/\t/g, "  ").length;
    return {
      number: index + 1,
      visualRows: wrap ? Math.max(1, Math.ceil((expandedLength || 1) / editorColumns)) : 1,
    };
  }), [editorColumns, value, wrap]);

  const highlighted = useMemo(() => highlightMarkdown(value), [value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && preScrollRef.current) {
      preScrollRef.current.scrollTop = textarea.scrollTop;
      preScrollRef.current.scrollLeft = textarea.scrollLeft;
    }
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const updateColumns = () => {
      setEditorColumns(Math.max(12, Math.floor((textarea.clientWidth - 48) / 8.4)));
    };
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);

  const syncScroll = () => {
    const textarea = textareaRef.current;
    if (lineNumberRef.current) lineNumberRef.current.scrollTop = textarea?.scrollTop ?? 0;
    if (preScrollRef.current && textarea) {
      preScrollRef.current.scrollTop = textarea.scrollTop;
      preScrollRef.current.scrollLeft = textarea.scrollLeft;
    }
  };

  const toggleWrap = () => {
    setWrap((current) => {
      const next = !current;
      localStorage.setItem("tanwords_raw_markdown_wrap", next ? "1" : "0");
      return next;
    });
  };

  const toggleLines = () => {
    setShowLineNumbers((current) => {
      const next = !current;
      localStorage.setItem("tanwords_raw_markdown_lines", next ? "1" : "0");
      return next;
    });
  };

  const editorBaseClass = "border-0 bg-transparent px-6 py-5 font-mono text-[14px] leading-7 outline-hidden placeholder:text-muted-foreground/30 tab-size-2";
  const editorTextareaClass = `${editorBaseClass} block w-full min-h-0 resize-none overflow-y-scroll ${
    wrap ? "overflow-x-hidden whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
  }`;
  const editorPreClass = `${editorBaseClass} w-full min-w-full ${
    wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre w-max min-w-full"
  }`;

  return (
    <div className="raw-markdown-editor flex min-h-0 flex-1 flex-col px-6 pb-4 pt-2">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl bg-background">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="mx-auto flex min-h-0 w-full max-w-[960px] flex-1">
          {showLineNumbers && (
            <div
              ref={lineNumberRef}
              aria-hidden="true"
              className="rm-line-numbers w-11 shrink-0 overflow-hidden bg-muted/15 py-5 text-right font-mono text-[11px] leading-7 text-muted-foreground/30 select-none"
            >
              {lineNumbers.map((line) => (
                <div
                  key={line.number}
                  style={{ height: `${line.visualRows * 28}px` }}
                  className="pr-3"
                >
                  {line.number}
                </div>
              ))}
            </div>
          )}

          <div className="rm-scroll-surface relative min-h-0 flex-1 overflow-hidden">
            <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg bg-muted/70 p-0.5 backdrop-blur-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleLines}
                title="Toggle line numbers"
                className={`h-6 w-6 rounded-md ${showLineNumbers ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
              >
                <ListOrdered className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleWrap}
                title="Toggle word wrap"
                className={`h-6 w-6 rounded-md ${wrap ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
              >
                <WrapText className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div
              ref={preScrollRef}
              aria-hidden="true"
              className={`rm-sync-overlay pointer-events-none absolute inset-0 overflow-y-scroll ${wrap ? "overflow-x-hidden" : "overflow-x-auto"}`}
            >
              <pre
                className={`${editorPreClass} overflow-visible ${wrap ? "rm-wrap" : "rm-nowrap"}`}
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            </div>
            <textarea
              ref={textareaRef}
              autoFocus
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
              }}
              onScroll={syncScroll}
              spellCheck={false}
              aria-label={label}
              wrap={wrap ? "soft" : "off"}
              style={{
                tabSize: 2,
                color: "transparent",
                caretColor: "var(--document-text-color, hsl(var(--foreground)))",
              }}
              className={`${editorTextareaClass} rm-editor-input relative z-10`}
            />
          </div>
          </div>
        </div>

      </div>
    </div>
  );
}

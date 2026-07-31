import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, ListOrdered, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const [cursorLine, setCursorLine] = useState(1);
  const [wrap, setWrap] = useState(
    () => localStorage.getItem("tanwords_raw_markdown_wrap") !== "0",
  );
  const [showLineNumbers, setShowLineNumbers] = useState(
    () => localStorage.getItem("tanwords_raw_markdown_lines") !== "0",
  );
  const [editorColumns, setEditorColumns] = useState(80);

  const stats = useMemo(() => {
    const lines = value.split("\n").length;
    const words = value.trim() ? value.trim().split(/\s+/).length : 0;
    return { lines, words, characters: value.length };
  }, [value]);

  const lineNumbers = useMemo(() => value.split("\n").map((line, index) => {
    const expandedLength = line.replace(/\t/g, "  ").length;
    return {
      number: index + 1,
      visualRows: wrap ? Math.max(1, Math.ceil((expandedLength || 1) / editorColumns)) : 1,
    };
  }), [editorColumns, value, wrap]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const updateColumns = () => {
      // 14px monospace characters are ~8.4px wide; horizontal padding is 48px.
      setEditorColumns(Math.max(12, Math.floor((textarea.clientWidth - 48) / 8.4)));
    };
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);

  const updateCursorLine = (element: HTMLTextAreaElement) => {
    setCursorLine(value.slice(0, element.selectionStart).split("\n").length);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-4 pt-2">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_10px_35px_-28px_rgba(0,0,0,0.55)] focus-within:border-primary/25 focus-within:ring-1 focus-within:ring-primary/10">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 bg-muted/20 px-3">
          <FileCode2 className="h-3.5 w-3.5 text-primary/70" />
          <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground/50">Markdown</span>
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleLines}
              title="Toggle line numbers"
              className={`h-6 w-6 rounded-md ${showLineNumbers ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleWrap}
              title="Toggle word wrap"
              className={`h-6 w-6 rounded-md ${wrap ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            >
              <WrapText className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden bg-muted/[0.035]">
          {showLineNumbers && (
            <div
              ref={lineNumberRef}
              aria-hidden="true"
              className="w-11 shrink-0 overflow-hidden border-r border-border/35 bg-muted/15 py-5 text-right font-mono text-[11px] leading-7 text-muted-foreground/30 select-none"
            >
              {lineNumbers.map((line) => (
                <div key={line.number} style={{ height: `${line.visualRows * 28}px` }} className="pr-3">
                  {line.number}
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            autoFocus
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              updateCursorLine(event.currentTarget);
            }}
            onSelect={(event) => updateCursorLine(event.currentTarget)}
            onScroll={(event) => {
              if (lineNumberRef.current) lineNumberRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            spellCheck={false}
            aria-label={label}
            wrap={wrap ? "soft" : "off"}
            style={{
              tabSize: 2,
              color: "var(--document-text-color, hsl(var(--foreground)))",
            }}
            className={`min-h-0 flex-1 resize-none overflow-auto border-0 bg-transparent px-6 py-5 font-mono text-[14px] leading-7 outline-hidden placeholder:text-muted-foreground/30 ${
              wrap ? "whitespace-pre-wrap wrap-break-word" : "whitespace-pre"
            }`}
          />
        </div>

        <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border/40 bg-muted/15 px-3 font-mono text-[10px] tabular-nums text-muted-foreground/55">
          <span>Ln {cursorLine}</span>
          <span>{stats.lines} lines</span>
          <span>{stats.words} words</span>
          <span className="ml-auto">{stats.characters.toLocaleString()} chars</span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
}

import React, { useMemo, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";

export function RawMarkdownEditor({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const lineNumberRef = useRef<HTMLDivElement>(null);
  // One text node is dramatically cheaper than thousands of React elements
  // for book-sized Markdown files.
  const lineNumbers = useMemo(() => {
    const count = value.split("\n").length;
    return Array.from({ length: count }, (_, index) => String(index + 1)).join("\n");
  }, [value]);
  return (
    <div className="flex-1 min-h-0 px-12 py-4">
      <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-border/70 bg-muted/10 shadow-sm transition-colors focus-within:border-foreground/20">
        <div ref={lineNumberRef} aria-hidden="true" className="w-12 shrink-0 overflow-hidden border-r border-border/50 bg-muted/30 py-4 pr-3 text-right font-mono text-[12px] leading-6 text-muted-foreground/35 select-none whitespace-pre">{lineNumbers}</div>
        <Textarea
          autoFocus value={value} onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => { if (lineNumberRef.current) lineNumberRef.current.scrollTop = event.currentTarget.scrollTop; }}
          spellCheck={false} aria-label={label} wrap="off" style={{ tabSize: 2 }}
          className="h-full min-h-0 flex-1 resize-none overflow-auto whitespace-pre rounded-none border-0 bg-transparent p-4 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
    </div>
  );
}

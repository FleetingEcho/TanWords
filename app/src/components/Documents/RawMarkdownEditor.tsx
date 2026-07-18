import React, { useRef } from "react";
import { Textarea } from "@/components/ui/textarea";

export function RawMarkdownEditor({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const lineNumberRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex-1 min-h-0 px-12 py-4">
      <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-border/70 bg-muted/10 shadow-sm transition-colors focus-within:border-foreground/20">
        <div ref={lineNumberRef} aria-hidden="true" className="w-12 shrink-0 overflow-hidden border-r border-border/50 bg-muted/30 py-4 text-right font-mono text-[12px] leading-6 text-muted-foreground/35 select-none">
          {value.split("\n").map((_, index) => <div key={index} className="h-6 pr-3">{index + 1}</div>)}
        </div>
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

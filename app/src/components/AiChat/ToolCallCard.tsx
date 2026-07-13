import React, { useState } from "react";
import { BookIcon, SearchIcon, SparkIcon, ClipboardListIcon, DocIcon, SlidersIcon } from "@/components/ui/icons";
import { CogIcon, XCircleIcon, CheckCircleIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";

export interface ToolCallDisplay {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  is_error?: boolean;
  status: "pending" | "done" | "error";
}

const TOOL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  save_word:           BookIcon,
  search_vocabulary:   SearchIcon,
  extract_vocabulary:  SparkIcon,
  add_words_to_vocab:  BookIcon,
  list_documents:      ClipboardListIcon,
  insert_into_document: DocIcon,
};

const TOOL_LABELS: Record<string, string> = {
  save_word:           "Save word",
  search_vocabulary:   "Search vocabulary",
  extract_vocabulary:  "Extract vocabulary",
  add_words_to_vocab:  "Add words to vocabulary",
  list_documents:      "List documents",
  insert_into_document:"Insert into document",
};

function inputSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "save_word":           return `"${input.word}" → ${input.zh}`;
    case "search_vocabulary":   return `"${input.query}"`;
    case "extract_vocabulary":  return `${(input.items as unknown[])?.length ?? 0} items`;
    case "add_words_to_vocab":  return `${(input.words as unknown[])?.length ?? 0} words`;
    case "list_documents":      return "";
    case "insert_into_document":return `doc #${input.doc_id}`;
    default: return JSON.stringify(input).slice(0, 60);
  }
}

export function ToolCallCard({ calls }: { calls: ToolCallDisplay[] }) {
  const [expanded, setExpanded] = useState(false);
  const allDone = calls.every((c) => c.status !== "pending");
  const hasError = calls.some((c) => c.status === "error");

  return (
    <div className="my-1 mx-0">
      <Button
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        className={`h-auto w-full flex items-center justify-start gap-2 px-3 py-2 rounded-xl border text-left transition-colors ${
          hasError
            ? "border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/5"
            : allDone
            ? "border-border bg-muted/30 text-muted-foreground hover:bg-muted/30"
            : "border-primary/20 bg-primary/5 text-primary animate-pulse hover:bg-primary/5"
        }`}
      >
        {/* Status icon */}
        <span className="shrink-0">
          {!allDone ? (
            <CogIcon className="w-4 h-4 animate-spin" />
          ) : hasError ? (
            <XCircleIcon className="w-4 h-4" />
          ) : (
            <CheckCircleIcon className="w-4 h-4" />
          )}
        </span>

        {/* Summary */}
        <span className="flex-1 text-xs font-medium truncate">
          {calls.length === 1
            ? `${TOOL_LABELS[calls[0].name] ?? calls[0].name} ${inputSummary(calls[0].name, calls[0].input)}`
            : `${calls.length} tool calls`}
        </span>

        {/* Chevron */}
        <svg
          viewBox="0 0 12 12"
          className={`w-2.5 h-2.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </Button>

      {expanded && (
        <div className="mt-1 ml-2 space-y-2">
          {calls.map((c) => (
            <div key={c.id} className="border border-border rounded-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                {React.createElement(TOOL_ICONS[c.name] ?? SlidersIcon, {
                  className: "w-3.5 h-3.5 text-muted-foreground shrink-0",
                })}
                <span className="text-xs font-semibold text-foreground">{TOOL_LABELS[c.name] ?? c.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">{c.id.slice(-6)}</span>
              </div>

              {/* Input */}
              <div className="px-3 py-2 border-b border-border/50">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1">Input</p>
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all leading-snug">
                  {JSON.stringify(c.input, null, 2)}
                </pre>
              </div>

              {/* Result */}
              {c.result !== undefined && (
                <div className="px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1">Result</p>
                  <p className={`text-xs leading-snug whitespace-pre-wrap ${c.is_error ? "text-destructive" : "text-foreground"}`}>
                    {c.result}
                  </p>
                </div>
              )}

              {c.status === "pending" && (
                <div className="px-3 py-2 flex items-center gap-1.5">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-1 h-1 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

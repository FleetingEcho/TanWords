/**
 * Mermaid diagram block.
 *
 * Storage/markdown format stays a plain ```mermaid code fence — liftMermaid /
 * lowerMermaid convert between that and this block around load/save, so files
 * on disk remain portable. The mermaid library (~1.5 MB) is imported
 * dynamically so it only loads when a diagram is actually rendered.
 */
import React, { useEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { createMermaidConfig } from "./mermaidConfig";

let renderSeq = 0;

function MermaidView({ code, onChange }: { code: string; onChange: (code: string) => void }) {
  const t = useT();
  const isDark = useIsDark();
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!code.trim());
  const [draft, setDraft] = useState(code);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!code.trim()) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize(createMermaidConfig(isDark));
        const { svg } = await mermaid.render(`tanwords-mermaid-${++renderSeq}`, code);
        if (!cancelled) { setSvg(svg); setError(null); }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [code, isDark]);

  const commit = () => {
    setEditing(false);
    if (draft !== code) onChange(draft);
  };

  return (
    <div className="w-full my-1 rounded-lg border border-border bg-card/50 group/mermaid" contentEditable={false}>
      {editing ? (
        <div className="p-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(); }}
            rows={Math.max(4, draft.split("\n").length + 1)}
            spellCheck={false}
            placeholder="graph TD&#10;  A --> B"
            className="w-full text-xs font-mono bg-transparent border-none outline-none resize-y text-foreground placeholder:text-muted-foreground/40"
          />
        </div>
      ) : (
        <div className="relative px-3 py-2">
          {error ? (
            <div>
              <p className="text-xs text-red-500 mb-1">{t("doc.mermaidError")}</p>
              <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap">{code}</pre>
            </div>
          ) : (
            <div
              ref={containerRef}
              className="flex justify-center overflow-x-auto [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
          <button
            onClick={() => { setDraft(code); setEditing(true); }}
            className="absolute top-1.5 right-1.5 opacity-0 group-hover/mermaid:opacity-100 h-5 px-2 rounded text-[10px] font-medium bg-muted text-muted-foreground hover:text-foreground transition-opacity"
          >
            {t("doc.mermaidEdit")}
          </button>
        </div>
      )}
    </div>
  );
}

export const MermaidBlock = createReactBlockSpec(
  {
    type: "mermaid" as const,
    propSchema: { code: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }: any) => (
      <MermaidView
        code={block.props.code}
        onChange={(code) => editor.updateBlock(block, { props: { code } })}
      />
    ),
  }
);

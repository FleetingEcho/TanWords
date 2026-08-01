/**
 * Mermaid diagram block.
 *
 * Storage/markdown format stays a plain ```mermaid code fence — liftMermaid /
 * lowerMermaid convert between that and this block around load/save, so files
 * on disk remain portable. The mermaid library (~1.5 MB) is imported
 * dynamically so it only loads when a diagram is actually rendered.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { createReactBlockSpec } from "@blocknote/react";
import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { createMermaidConfig } from "./mermaidConfig";
import { Dialog, DialogTitle } from "@/components/ui/dialog";

let renderSeq = 0;
const MERMAID_CACHE_LIMIT = 50;
const mermaidSvgCache = new Map<string, string>();
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 0.25;

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 4) / 4));
}

function MermaidZoomCanvas({
  svg,
  scale,
  className,
  onWheel,
}: {
  svg: string;
  scale: number;
  className: string;
  onWheel?: (event: React.WheelEvent) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const naturalSize = useRef<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const svgEl = root?.querySelector("svg");
    if (!root || !svgEl) return;
    if (!naturalSize.current) {
      const width = Number(svgEl.getAttribute("width")) || svgEl.getBoundingClientRect().width;
      const height = Number(svgEl.getAttribute("height")) || svgEl.getBoundingClientRect().height;
      if (!width || !height) return;
      naturalSize.current = { width, height };
    }
    svgEl.style.width = `${naturalSize.current.width * scale}px`;
    svgEl.style.height = `${naturalSize.current.height * scale}px`;
  }, [svg, scale]);

  return (
    <div
      ref={rootRef}
      className={className}
      onWheel={onWheel}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function MermaidView({ code, onChange }: { code: string; onChange: (code: string) => void }) {
  const t = useT();
  const isDark = useIsDark();
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!code.trim());
  const [scale, setScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenMode, setFullscreenMode] = useState<"view" | "code">("view");
  const [fullDraft, setFullDraft] = useState(code);
  const [draft, setDraft] = useState(code);
  const themeColors = (() => {
    const styles = getComputedStyle(document.documentElement);
    const hsl = (name: string) => `hsl(${styles.getPropertyValue(name).trim()})`;
    return {
      background: hsl("--background"),
      card: hsl("--card"),
      foreground: styles.getPropertyValue("--document-text-color").trim() || hsl("--foreground"),
      border: hsl("--border"),
      primary: hsl("--primary"),
    };
  })();
  const themeKey = JSON.stringify(themeColors);
  const cacheKey = `${themeKey}|${code}`;

  useEffect(() => {
    setScale(1);
  }, [code]);

  const handleWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setScale((current) => clampScale(current + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)));
  };

  useEffect(() => {
    if (!code.trim()) return;
    let cancelled = false;
    const cached = mermaidSvgCache.get(cacheKey);
    if (cached) {
      setSvg(cached);
      setError(null);
      return;
    }
    setSvg("");
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize(createMermaidConfig(isDark, themeColors));
        const { svg } = await mermaid.render(`tanwords-mermaid-${++renderSeq}`, code);
        if (!cancelled) {
          mermaidSvgCache.set(cacheKey, svg);
          if (mermaidSvgCache.size > MERMAID_CACHE_LIMIT) {
            const oldest = mermaidSvgCache.keys().next().value;
            if (oldest !== undefined) mermaidSvgCache.delete(oldest);
          }
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [cacheKey, isDark]);

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
            className="w-full text-xs font-mono bg-transparent border-none outline-hidden resize-y text-foreground placeholder:text-muted-foreground/40"
          />
        </div>
      ) : (
        <div className="relative py-2">
          {error ? (
            <div className="px-3">
              <p className="text-xs text-red-500 mb-1">{t("doc.mermaidError")}</p>
              <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap">{code}</pre>
            </div>
          ) : (
            <MermaidZoomCanvas
              svg={svg}
              scale={scale}
              className="max-h-[70vh] overflow-auto text-center"
              onWheel={handleWheel}
            />
          )}
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-background/80 p-1 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/mermaid:opacity-100">
            <button
              type="button"
              onClick={() => setScale((current) => clampScale(current - ZOOM_STEP))}
              title={t("doc.mermaidZoomOut")}
              aria-label={t("doc.mermaidZoomOut")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-9 text-center text-[10px] font-mono tabular-nums text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((current) => clampScale(current + ZOOM_STEP))}
              title={t("doc.mermaidZoomIn")}
              aria-label={t("doc.mermaidZoomIn")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setScale(1)}
              title={t("doc.mermaidZoomReset")}
              aria-label={t("doc.mermaidZoomReset")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setFullDraft(code);
                setFullscreenMode("view");
                setFullscreen(true);
              }}
              title={t("doc.mermaidFullscreen")}
              aria-label={t("doc.mermaidFullscreen")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setDraft(code); setEditing(true); }}
              className="h-6 rounded-md px-2 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {t("doc.mermaidEdit")}
            </button>
          </div>
        </div>
      )}

      {fullscreen && (
        <Dialog open={fullscreen} onClose={() => setFullscreen(false)} maxWidth="max-w-[95vw]" className="h-[90vh] overflow-hidden">
          <DialogTitle className="sr-only">{t("doc.mermaidFullscreen")}</DialogTitle>
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2">
              <span className="text-xs font-semibold">{t("doc.mermaidFullscreen")}</span>
              <div className="ml-3 flex items-center gap-1 rounded-lg bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setFullscreenMode("view")}
                  className={`h-7 rounded-md px-2.5 text-[11px] font-medium ${
                    fullscreenMode === "view" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("doc.mermaidView")}
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreenMode("code")}
                  className={`h-7 rounded-md px-2.5 text-[11px] font-medium ${
                    fullscreenMode === "code" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("doc.mermaidEditCode")}
                </button>
              </div>
              {fullscreenMode === "view" && (
                <div className="ml-auto flex items-center gap-1">
                  <span className="min-w-9 text-center text-[10px] font-mono tabular-nums text-muted-foreground">
                    {Math.round(scale * 100)}%
                  </span>
                <button
                  type="button"
                  onClick={() => setScale((current) => clampScale(current - ZOOM_STEP))}
                  title={t("doc.mermaidZoomOut")}
                  aria-label={t("doc.mermaidZoomOut")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setScale((current) => clampScale(current + ZOOM_STEP))}
                  title={t("doc.mermaidZoomIn")}
                  aria-label={t("doc.mermaidZoomIn")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setScale(1)}
                  title={t("doc.mermaidZoomReset")}
                  aria-label={t("doc.mermaidZoomReset")}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                title={t("doc.mermaidCloseFullscreen")}
                aria-label={t("doc.mermaidCloseFullscreen")}
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              </div>
            {fullscreenMode === "view" ? (
              <MermaidZoomCanvas
                svg={svg}
                scale={scale}
                className="min-h-0 flex-1 overflow-auto p-6 text-center"
                onWheel={handleWheel}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <textarea
                  value={fullDraft}
                  onChange={(event) => setFullDraft(event.target.value)}
                  spellCheck={false}
                  className="min-h-0 flex-1 w-full resize-none rounded-lg border border-input bg-muted/20 p-4 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-primary/30"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setFullscreenMode("view")}
                    className="h-8 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(fullDraft);
                      setFullscreenMode("view");
                    }}
                    className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    {t("doc.mermaidApplyCode")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Dialog>
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
    toExternalHTML: ({ block }: any) => (
      <pre className="mermaid">{block.props.code ?? ""}</pre>
    ),
  }
);

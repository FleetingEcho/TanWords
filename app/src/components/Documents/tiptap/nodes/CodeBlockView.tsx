/**
 * Code block with a language picker and a copy button.
 *
 * The picker is not decoration: syntax highlighting is driven entirely by the
 * node's `language` attr (see `codeBlockShiki`), so without a way to set it
 * every block stays `text` and renders in one colour — which reads as
 * "highlighting is broken" rather than "no language selected". The copy
 * button is an action, so it reveals on hover (the Mermaid block's controls
 * do the same) while the picker stays visible.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, Copy, Maximize2, Minimize2, WrapText } from "lucide-react";
import { useT } from "@/hooks/useT";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES } from "./highlighter";

export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useT();
  const language = (node.attrs.language as string) || "text";
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lineCount = node.textContent.split("\n").length;
  const isLarge = lineCount > 16 || node.textContent.length > 1_200;
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const copyCode = () => {
    // Desktop WebViews do not all expose the async clipboard API. A failed or
    // missing API simply never swaps the icon — no throw inside the editor.
    void navigator.clipboard
      ?.writeText(node.textContent)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  // User-applied block tint (the sticky toolbar's code swatches). The inline
  // style on <pre> beats the theme class; `data-toned` turns shiki's
  // per-token colours off (see tiptap-editor.css) so the chosen text colour
  // paints the whole block, which is what the picker promises.
  const customPaint = (value: unknown): string | null =>
    typeof value === "string" && value.trim() && value !== "default" ? value : null;
  const backgroundColor = customPaint(node.attrs.backgroundColor);
  const textColor = customPaint(node.attrs.textColor);
  const preStyle: CSSProperties = {};
  if (backgroundColor) preStyle.backgroundColor = backgroundColor;
  if (textColor) preStyle.color = textColor;

  return (
    <NodeViewWrapper
      className="code-block-shell group/code relative"
      data-block-type="codeBlock"
      data-wrap={wrap || undefined}
      data-collapsible={isLarge || undefined}
      data-expanded={isLarge ? expanded : undefined}
    >
      {/* contentEditable={false}: ProseMirror otherwise treats the controls as
       *  document content and reconciles them away on the next transaction. */}
      <div contentEditable={false} className="code-block-toolbar flex items-center justify-end gap-1 px-2 py-1">
        <button
          type="button"
          onClick={() => setWrap((value) => !value)}
          title={wrap ? t("doc.noWrapCode") : t("doc.wrapCode")}
          aria-label={wrap ? t("doc.noWrapCode") : t("doc.wrapCode")}
          aria-pressed={wrap}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus:opacity-100"
        >
          <WrapText className="h-3.5 w-3.5" />
        </button>
        {isLarge && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? t("doc.collapseCode") : t("doc.expandCode")}
            aria-label={expanded ? t("doc.collapseCode") : t("doc.expandCode")}
            aria-expanded={expanded}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus:opacity-100"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={copyCode}
          title={t("doc.copyCode")}
          aria-label={t("doc.copyCode")}
          data-copied={copied || undefined}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus:opacity-100"
        >
          {copied
            ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            : <Copy className="h-3.5 w-3.5" />}
        </button>
        <Select
          value={language}
          disabled={!editor.isEditable}
          onValueChange={(value) => updateAttributes({ language: value })}
        >
          {/* Always visible, not hover-only: the language is what drives
              highlighting, so a block silently sitting on `text` is otherwise
              indistinguishable from highlighting being broken. */}
          <SelectTrigger
            aria-label={t("doc.codeLanguage")}
            title={t("doc.codeLanguage")}
            className="h-6 w-auto min-w-24 max-w-40 gap-1 rounded-md border-border bg-background/70 px-1.5 py-0 text-[10px] font-mono text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 focus:ring-1 focus:ring-ring focus:ring-offset-0 group-hover/code:opacity-100"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" className="font-mono">
            <SelectItem value="text" className="text-xs">{t("doc.codePlainText")}</SelectItem>
            {SUPPORTED_LANGUAGES.map((name) => (
              <SelectItem key={name} value={name} className="text-xs">{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <pre
        className="code-block-body"
        style={Object.keys(preStyle).length ? preStyle : undefined}
        data-toned={textColor ? "true" : undefined}
      >
        {/* `as="code"` keeps the <pre><code> shape the export pipeline and the
            shiki decorations both assume. */}
        <NodeViewContent
          as={"code" as "div"}
          className={`language-${language}`}
          spellCheck={false}
        />
      </pre>
    </NodeViewWrapper>
  );
}

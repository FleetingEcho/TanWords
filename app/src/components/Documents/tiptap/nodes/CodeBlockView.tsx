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
import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { useT } from "@/hooks/useT";
import { SUPPORTED_LANGUAGES } from "./highlighter";

export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useT();
  const language = (node.attrs.language as string) || "text";
  const [copied, setCopied] = useState(false);
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

  return (
    <NodeViewWrapper className="group/code relative" data-block-type="codeBlock">
      {/* contentEditable={false}: ProseMirror otherwise treats the controls as
       *  document content and reconciles them away on the next transaction. */}
      <div contentEditable={false} className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={copyCode}
          title={t("doc.copyCode")}
          aria-label={t("doc.copyCode")}
          data-copied={copied || undefined}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border bg-background/70 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/code:opacity-80"
        >
          {copied
            ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            : <Copy className="h-3.5 w-3.5" />}
        </button>
        <select
          value={language}
          disabled={!editor.isEditable}
          onChange={(event) => updateAttributes({ language: event.target.value })}
          aria-label={t("doc.codeLanguage")}
          title={t("doc.codeLanguage")}
          // Always visible, not hover-only: the language is what drives
          // highlighting, so a block silently sitting on `text` is otherwise
          // indistinguishable from highlighting being broken.
          className="h-6 cursor-pointer rounded-md border border-border bg-background/70 px-1.5 text-[10px] font-mono text-muted-foreground opacity-60 backdrop-blur transition-opacity hover:opacity-100 focus:opacity-100 group-hover/code:opacity-100"
        >
          <option value="text">{t("doc.codePlainText")}</option>
          {SUPPORTED_LANGUAGES.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <pre>
        {/* `as="code"` keeps the <pre><code> shape the export pipeline and the
            shiki decorations both assume. */}
        <NodeViewContent as={"code" as "div"} className={`language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
}

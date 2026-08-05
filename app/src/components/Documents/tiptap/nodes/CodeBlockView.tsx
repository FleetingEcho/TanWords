/**
 * Code block with a language picker.
 *
 * The picker is not decoration: syntax highlighting is driven entirely by the
 * node's `language` attr (see `codeBlockShiki`), so without a way to set it
 * every block stays `text` and renders in one colour — which reads as
 * "highlighting is broken" rather than "no language selected". The previous
 * editor shipped this control; the port dropped it.
 */
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useT } from "@/hooks/useT";
import { SUPPORTED_LANGUAGES } from "./highlighter";

export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useT();
  const language = (node.attrs.language as string) || "text";

  return (
    <NodeViewWrapper className="group/code relative" data-block-type="codeBlock">
      <select
        // contentEditable={false}: ProseMirror otherwise treats the control as
        // document content and reconciles it away on the next transaction.
        contentEditable={false}
        value={language}
        disabled={!editor.isEditable}
        onChange={(event) => updateAttributes({ language: event.target.value })}
        aria-label={t("doc.codeLanguage")}
        title={t("doc.codeLanguage")}
        // Always visible, not hover-only: the language is what drives
        // highlighting, so a block silently sitting on `text` is otherwise
        // indistinguishable from highlighting being broken.
        className="absolute right-2 top-2 z-10 h-6 cursor-pointer rounded-md border border-border bg-background/70 px-1.5 text-[10px] font-mono text-muted-foreground opacity-60 backdrop-blur transition-opacity hover:opacity-100 focus:opacity-100 group-hover/code:opacity-100"
      >
        <option value="text">{t("doc.codePlainText")}</option>
        {SUPPORTED_LANGUAGES.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
      <pre>
        {/* `as="code"` keeps the <pre><code> shape the export pipeline and the
            shiki decorations both assume. */}
        <NodeViewContent as={"code" as "div"} className={`language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
}

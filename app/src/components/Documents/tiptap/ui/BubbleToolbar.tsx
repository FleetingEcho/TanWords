/**
 * Selection formatting toolbar.
 *
 * Replaces BlockNote's `FormattingToolbarController` +
 * `getFormattingToolbarItems()`. Owning it turns the private-file password
 * gate from "filter BlockNote's items by key" (see `useDocEditorAttachments`)
 * into ordinary conditional rendering.
 */
import type { Editor } from "@tiptap/core";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Code, Italic,
  Link2, Strikethrough, Underline,
} from "lucide-react";
import { useT } from "@/hooks/useT";

interface ToolbarButtonProps {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ active, title, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      // onMouseDown, not onClick: the editor loses its selection on blur, and
      // by the time a click fires there is nothing left to format.
      onMouseDown={(event) => { event.preventDefault(); onClick(); }}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** Hoisted, not inline: `BubbleMenu` lists `options` in an effect dependency
 *  array, so a fresh object each render dispatches a redundant ProseMirror
 *  transaction every time the toolbar re-renders. */
const BUBBLE_OPTIONS = { placement: "top", offset: 8 } as const;

/**
 * When the toolbar is visible.
 *
 * Only while text is actually selected. Showing it on a collapsed cursor was
 * tried and reverted: it then appeared on every click and followed the caret
 * around the document, which is far more intrusive than having to select first.
 * Selection-only is also what the previous editor did.
 */
export function shouldShowToolbar({ editor, state, from, to }: {
  editor: Editor;
  state: EditorState;
  oldState?: EditorState;
  from: number;
  to: number;
}): boolean {
  if (!editor.isEditable || !editor.isFocused) return false;
  // Nothing selected — a bare cursor gets no toolbar.
  if (from === to) return false;
  // Atoms (image, mermaid, youtube) carry their own controls.
  if (state.selection instanceof NodeSelection) return false;
  // Inline marks do not apply inside code, and the toolbar would cover it.
  if (editor.isActive("codeBlock")) return false;
  return state.doc.textBetween(from, to).trim().length > 0;
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-border" />;
}

export interface BubbleToolbarProps {
  editor: Editor;
  /** Rendered after the built-in items — the AI and image-options buttons. */
  children?: React.ReactNode;
}

export function BubbleToolbar({ editor, children }: BubbleToolbarProps) {
  const t = useT();

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt(t("doc.linkUrl"), previous ?? "https://");
    if (href === null) return;
    if (href === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      options={BUBBLE_OPTIONS}
      shouldShow={shouldShowToolbar}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      <ToolbarButton title={t("doc.bold")} active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t("doc.italic")} active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t("doc.underline")} active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t("doc.strike")} active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t("doc.inlineCode")} active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton title={t("doc.link")} active={editor.isActive("link")} onClick={setLink}>
        <Link2 className="h-3.5 w-3.5" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton title={t("doc.alignLeft")} active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t("doc.alignCenter")} active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t("doc.alignRight")} active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight className="h-3.5 w-3.5" />
      </ToolbarButton>

      {children && <Divider />}
      {children}
    </BubbleMenu>
  );
}

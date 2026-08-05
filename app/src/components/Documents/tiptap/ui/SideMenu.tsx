/**
 * The left-gutter block menu: add a block, or drag one.
 *
 * BlockNote shipped this pair (`+` and the grip) as its side menu. Tiptap
 * supplies only the drag-handle plugin, so the `+` and the surrounding layout
 * are ours.
 *
 * The plugin appends its own wrapper to `editor.view.dom.parentElement` and
 * positions it absolutely, so the editor root must be a positioned ancestor —
 * see `.tanwords-tiptap { position: relative }` in TiptapDocumentEditor.
 */
import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { GripVertical, Plus } from "lucide-react";
import { useT } from "@/hooks/useT";
import { BlockMenu } from "./BlockMenu";

/**
 * Adds a block below `target` and opens the insert menu on it.
 *
 * The new paragraph is seeded with the `/` character rather than left empty:
 * the slash menu is driven by a Suggestion plugin that matches text before the
 * cursor, so writing the trigger *is* how it opens. An empty paragraph is what
 * made the `+` button look inert — it inserted a blank line and no menu.
 *
 * Position: the paragraph starts at `end`, its text at `end + 1`, so the cursor
 * goes after the `/` at `end + 2`.
 *
 * Exported for testing — the menu's own render path needs layout APIs jsdom
 * does not implement, so the assertable behaviour is the document state this
 * produces.
 */
export function insertBlockBelow(
  editor: Editor,
  target: { node: PmNode | null; pos: number },
): void {
  const { node, pos } = target;
  if (pos < 0 || !node) return;
  const end = pos + node.nodeSize;
  editor
    .chain()
    .insertContentAt(end, { type: "paragraph", content: [{ type: "text", text: "/" }] })
    .setTextSelection(end + 2)
    .focus()
    .run();
}

export function SideMenu({ editor }: { editor: Editor }) {
  const t = useT();

  /**
   * Which block the gutter is pointing at, in a ref rather than state.
   *
   * The plugin reports this on every pointer move, and `DragHandle` lists
   * `onNodeChange` in its effect dependencies — so a callback whose identity
   * changes re-registers the ProseMirror plugin, which resets the handle to
   * `visibility: hidden` before floating-ui repositions it. With `useState`
   * that is a loop: set state → re-render → new callback identity →
   * re-register → set state. The visible symptom is a permanently flashing
   * handle.
   *
   * Nothing rendered here depends on the target — only the click handler reads
   * it — so a ref is both the fix and the honest data model.
   */
  const target = useRef<{ node: PmNode | null; pos: number }>({ node: null, pos: -1 });
  /** The block the menu is open for, captured on click so a later hover cannot
   *  retarget an already-open menu. */
  const [menuTarget, setMenuTarget] = useState<{ node: PmNode | null; pos: number } | null>(null);

  // Stable identity, so the effect above never re-runs.
  const closeMenu = useCallback(() => setMenuTarget(null), []);

  const handleNodeChange = useCallback(
    ({ node, pos }: { node: PmNode | null; pos: number }) => {
      target.current = { node, pos };
    },
    [],
  );

  const addBlockBelow = () => insertBlockBelow(editor, target.current);

  return (
    <DragHandle
      editor={editor}
      onNodeChange={handleNodeChange}
    >
      <div className="relative flex items-center gap-0.5 pr-1">
        <button
          type="button"
          title={t("doc.addBlock")}
          aria-label={t("doc.addBlock")}
          // The gutter is `draggable`, and a mousedown that starts a drag never
          // becomes a click. Acting on mousedown keeps the button usable.
          onMouseDown={(event) => { event.preventDefault(); addBlockBelow(); }}
          className="flex h-6 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
        <span
          title={t("doc.blockActions")}
          aria-label={t("doc.blockActions")}
          role="button"
          data-block-menu-trigger=""
          // The grip both drags and opens the block menu. `click` rather than
          // `mousedown`, so starting a drag does not also open the menu — a
          // drag never produces a click.
          onClick={() => setMenuTarget(menuTarget ? null : { ...target.current })}
          className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        {menuTarget && (
          <div className="absolute left-full top-0 z-50 ml-1">
            <BlockMenu editor={editor} target={menuTarget} onClose={closeMenu} />
          </div>
        )}
      </div>
    </DragHandle>
  );
}

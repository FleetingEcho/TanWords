/**
 * The `/` trigger, built on Tiptap's Suggestion plugin.
 *
 * Keyboard navigation lives here rather than in React: the plugin must be able
 * to *consume* ArrowUp/ArrowDown/Enter before ProseMirror moves the cursor, and
 * only a `handleKeyDown` returning true can do that. React renders whatever
 * state this publishes.
 */
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { Editor } from "@tiptap/core";
import { buildSlashItems, filterSlashItems, type SlashItem } from "./slashItems";

export interface SlashMenuSnapshot {
  items: SlashItem[];
  selected: number;
  /** Editor-relative position to anchor the popover to. */
  rect: { left: number; top: number };
  query: string;
}

export interface SlashSuggestionOptions {
  /** Publishes menu state; `null` closes it. */
  onChange: ((snapshot: SlashMenuSnapshot | null) => void) | null;
  /** Resolves an item's visible label, for matching what the user typed. */
  label: ((key: string) => string) | null;
}

/** Caret position relative to the editor's offset parent, so the popover can
 *  be absolutely positioned inside the same scroll container. */
function caretRect(editor: Editor, from: number): { left: number; top: number } {
  const coords = editor.view.coordsAtPos(from);
  const container = editor.view.dom.offsetParent ?? editor.view.dom;
  const bounds = container.getBoundingClientRect();
  return {
    left: coords.left - bounds.left,
    top: coords.bottom - bounds.top + 4,
  };
}

export const SlashSuggestion = Extension.create<SlashSuggestionOptions>({
  name: "slashSuggestion",

  addOptions: () => ({ onChange: null, label: null }),

  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;

    // Mutable across the plugin's callbacks: `render()` is created once, but
    // selection and items change on every keystroke.
    let items: SlashItem[] = [];
    let selected = 0;
    let range = { from: 0, to: 0 };
    let query = "";

    const publish = (open: boolean) => {
      if (!open) {
        options.onChange?.(null);
        return;
      }
      options.onChange?.({ items, selected, rect: caretRect(editor, range.from), query });
    };

    const refresh = (props: { query: string; range: { from: number; to: number } }) => {
      range = props.range;
      query = props.query;
      items = filterSlashItems(
        buildSlashItems(props.range),
        props.query,
        options.label ?? ((key) => key),
      );
      selected = 0;
      publish(true);
    };

    return [
      Suggestion({
        editor,
        char: "/",
        // Only at the start of an empty-ish block, so a URL like `and/or`
        // mid-sentence does not open the menu.
        allowSpaces: false,
        startOfLine: true,
        command: ({ editor: current, range: commandRange, props }) => {
          (props as SlashItem)?.run?.(current);
          void commandRange;
        },
        items: () => [],
        render: () => ({
          onStart: refresh,
          onUpdate: refresh,
          onKeyDown: ({ event }) => {
            if (items.length === 0) return false;
            if (event.key === "ArrowDown") {
              selected = (selected + 1) % items.length;
              publish(true);
              return true;
            }
            if (event.key === "ArrowUp") {
              selected = (selected - 1 + items.length) % items.length;
              publish(true);
              return true;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              items[selected]?.run(editor);
              publish(false);
              return true;
            }
            if (event.key === "Escape") {
              publish(false);
              return true;
            }
            return false;
          },
          onExit: () => publish(false),
        }),
      }),
    ];
  },
});

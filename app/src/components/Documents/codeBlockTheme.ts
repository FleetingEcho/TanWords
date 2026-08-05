import { DecorationCache } from "prosemirror-highlight";

interface ThemeRefreshTransaction {
  setMeta(key: string, value: unknown): ThemeRefreshTransaction;
}

/** The ProseMirror-level editor. Under BlockNote this is reached through
 *  `_tiptapEditor`; under Tiptap the editor *is* this, so callers pass it
 *  directly and the indirection disappears. */
interface ThemeRefreshEditor {
  isDestroyed?: boolean;
  state: { tr: ThemeRefreshTransaction };
  view: { dispatch(transaction: ThemeRefreshTransaction): void };
}

/** Accepts either editor: BlockNote wraps the real one, Tiptap is the real one. */
type ThemeRefreshTarget = ThemeRefreshEditor | { _tiptapEditor: ThemeRefreshEditor };

function proseMirrorEditor(editor: ThemeRefreshTarget): ThemeRefreshEditor {
  return "_tiptapEditor" in editor ? editor._tiptapEditor : editor;
}

/**
 * prosemirror-highlight caches Shiki decorations by code-block node identity.
 * Theme changes do not alter those nodes, so explicitly request its supported
 * decoration-only refresh instead of recreating the editor.
 */
export function refreshCodeBlockTheme(editor: ThemeRefreshTarget): void {
  const tiptap = proseMirrorEditor(editor);
  if (tiptap.isDestroyed) return;

  // prosemirror-highlight only invalidates decoration cache entries for nodes
  // that changed in the transaction. Theme switching doesn't touch the code
  // block nodes, so the refresh meta alone leaves the old theme's decorations
  // in place. Reset the plugin's cache before dispatching the refresh so every
  // code block is re-tokenized with the current app theme.
  const state = tiptap.state as unknown as {
    plugins: Array<{ key: string; getState: (state: unknown) => { cache?: DecorationCache } | undefined }>;
  };
  const highlightPlugin = (state.plugins ?? []).find((plugin) =>
    String(plugin.key).startsWith("prosemirror-highlight"),
  );
  const highlightState = highlightPlugin?.getState(state);
  if (highlightState?.cache) {
    highlightState.cache = new DecorationCache();
  }

  tiptap.view.dispatch(
    tiptap.state.tr.setMeta("prosemirror-highlight-refresh", true),
  );
}

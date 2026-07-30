interface ThemeRefreshTransaction {
  setMeta(key: string, value: unknown): ThemeRefreshTransaction;
}

interface ThemeRefreshEditor {
  _tiptapEditor: {
    isDestroyed?: boolean;
    state: { tr: ThemeRefreshTransaction };
    view: { dispatch(transaction: ThemeRefreshTransaction): void };
  };
}

/**
 * prosemirror-highlight caches Shiki decorations by code-block node identity.
 * Theme changes do not alter those nodes, so explicitly request its supported
 * decoration-only refresh instead of recreating the BlockNote editor.
 */
export function refreshCodeBlockTheme(editor: ThemeRefreshEditor): void {
  const tiptap = editor._tiptapEditor;
  if (tiptap.isDestroyed) return;
  tiptap.view.dispatch(
    tiptap.state.tr.setMeta("prosemirror-highlight-refresh", true),
  );
}

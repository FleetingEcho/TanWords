/** Selects the rendered BlockNote document with a native DOM range.
 *
 * BlockNote's ProseMirror `selectAll` can fail to expose a usable selection
 * when the document has no trailing empty text block. A DOM range has no such
 * dependency and also gives copy/selection integrations the browser selection
 * they expect.
 */
export function selectRichEditorContents(container: Element): boolean {
  const editor = container.querySelector<HTMLElement>(".bn-editor");
  const selection = window.getSelection();
  if (!editor || !selection) return false;

  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * Range math for taking selection over from the browser on touch devices.
 *
 * On a phone the native flow is unusable for us: a long press hands the text
 * to the OS, which paints its own Copy/Translate/Share bar over ours and gives
 * the page no way to suppress it. So on touch the app turns native selection
 * off entirely (`user-select: none`, see `[data-touch-select]` in base.css)
 * and builds the ranges itself from caret hit-testing — tap picks a word,
 * long-press-drag grows it into a phrase. Nothing is ever handed to
 * `window.getSelection()`, which is precisely why the OS bar never appears;
 * the highlight is painted by us instead.
 */

/** What counts as inside a word when growing a caret outwards: letters,
 *  digits, and the punctuation English keeps *within* words. */
const WORD = /[\p{L}\p{N}'’-]/u;

/** Selecting inside these means editing or interacting, not looking up. */
export const NOT_SELECTABLE =
  'button, [role="button"], [role="tab"], [role="switch"], input, textarea, select, label, summary, [data-no-touch-select]';

/** Long-press-selectable, but a tap belongs to the element: following a link
 *  matters more in an article than tap-selecting the word it wraps. */
export const TAP_TO_FOLLOW = 'a, [role="link"]';

interface CaretPosition {
  offsetNode: Node;
  offset: number;
}

/** The caret nearest a viewport point. WebKit/Blink expose the range form,
 *  Firefox the position form; neither is in the shared standard yet. */
export function caretRangeAt(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null;
    caretPositionFromPoint?(x: number, y: number): CaretPosition | null;
  };
  if (typeof doc.caretRangeFromPoint === "function") return doc.caretRangeFromPoint(x, y);
  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

/** The whole word under a viewport point, or null if the point isn't on one. */
export function wordRangeAt(x: number, y: number): Range | null {
  const caret = caretRangeAt(x, y);
  const node = caret?.startContainer;
  if (!caret || !node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";

  let start = caret.startOffset;
  // A caret that landed just past the last letter still means that word —
  // tapping the right half of "the" puts the caret at offset 3.
  if (!WORD.test(text[start] ?? "") && WORD.test(text[start - 1] ?? "")) start -= 1;
  if (!WORD.test(text[start] ?? "")) return null;

  let end = start;
  while (start > 0 && WORD.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD.test(text[end])) end += 1;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

/** The span from the word the drag started on to the point it has reached —
 *  recomputed from the pivot on every move, so dragging back the other way
 *  shrinks the selection instead of leaving the far edge stranded. */
export function rangeBetween(pivot: Range, x: number, y: number): Range {
  const point = wordRangeAt(x, y) ?? caretRangeAt(x, y);
  if (!point) return pivot;
  try {
    const range = document.createRange();
    if (point.compareBoundaryPoints(Range.START_TO_START, pivot) < 0) {
      range.setStart(point.startContainer, point.startOffset);
      range.setEnd(pivot.endContainer, pivot.endOffset);
    } else {
      range.setStart(pivot.startContainer, pivot.startOffset);
      range.setEnd(point.endContainer, point.endOffset);
    }
    return range;
  } catch {
    // Ranges in different roots (the drag crossed out of the article into a
    // portal) can't be compared or joined — keep what we had.
    return pivot;
  }
}

export function sameRange(a: Range, b: Range): boolean {
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset
    && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

/** Touch-first hosts: phones and tablets, where the native selection UI is
 *  the OS bar we're replacing. A desktop trackpad reports a fine pointer and
 *  keeps its own, perfectly good, native selection. */
export function isTouchHost(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

/** Clipboard write with the pre-async-API fallback, because taking selection
 *  over also took away the OS "Copy" the user used to have. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Insecure origins and older WebViews have no async clipboard.
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.cssText = "position:fixed;top:-9999px;opacity:0;user-select:text;-webkit-user-select:text";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

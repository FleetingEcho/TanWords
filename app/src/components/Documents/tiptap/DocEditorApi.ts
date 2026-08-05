/**
 * The editor surface the app actually uses.
 *
 * Derived from the exact set of editor methods `app/src` actually calls,
 * counted rather than guessed (plan.md §3). Keeping it small and stated in the
 * app's own vocabulary is what let the editor be replaced without touching
 * autosave, export, the outline, or stored content.
 *
 * Deliberately expressed in the app's own vocabulary — blocks, not
 * ProseMirror nodes — so callers never learn which editor is underneath.
 */
import type { Block, InlineContent } from "./blocks";

export interface CursorPosition {
  block: Block;
  prevBlock: Block | null;
  nextBlock: Block | null;
}

export interface DocEditorApi {
  /** The whole document, in storage format. */
  readonly document: Block[];

  /** Replaces `target` with `blocks`. Passing `document` replaces everything. */
  replaceBlocks(target: readonly Block[], blocks: readonly Block[]): void;
  insertBlocks(blocks: readonly Block[], reference: Block, placement: "before" | "after"): void;
  removeBlocks(ids: readonly string[]): void;
  updateBlock(target: Block | string, update: { props?: Record<string, unknown> }): void;

  /**
   * The block holding the cursor, plus its neighbours.
   *
   * `nextBlock` is load-bearing: the trailing-paragraph affordance and the
   * pasted-YouTube-link promotion both key off "is this the last block?".
   * Getting it wrong is silent — links stop embedding, or the document grows
   * a paragraph per keystroke.
   *
   * Runs on every keystroke, so implementations must be O(the cursor's
   * neighbourhood), never O(the document) — see `createDocEditorApi`.
   */
  getTextCursorPosition(): CursorPosition;
  setTextCursorPosition(blockId: string, placement?: "start" | "end"): void;

  /** Inserts inline content at the cursor — used by the document-link picker. */
  insertInlineContent(content: readonly InlineContent[]): void;

  getSelection(): { blocks: Block[] } | undefined;
  getSelectedText(): string;
  focus(): void;

  /** Resolves an app asset URL for display. Never write the result back into
   *  a block — see `useResolvedAssetUrl`. */
  resolveFileUrl?(url: string): Promise<string>;

  /** HTML for export. Lossy by design — see `documentExport`, which then
   *  inlines assets, renders mermaid and highlights code. */
  blocksToHTMLLossy(blocks?: readonly Block[]): string;

  /**
   * Headings only, collected in the editor's own document rather than through
   * a storage-format round trip — the outline recomputes on document changes,
   * which for a large file made the old route (full `document` serialization)
   * a per-keystroke cost.
   *
   * Optional: editor implementations that cannot walk their document cheaply
   * simply omit it and the outline falls back to reading `document`.
   */
  getOutlineHeadings?(): { id: string; level: number; text: string }[];

  /**
   * The editor's rendered root, for the outline's scroll-into-view. Null
   * before the editor has mounted.
   *
   * A method, not a getter, on purpose: React DevTools enumerates the
   * properties of objects it renders, and a getter reaching into the editor
   * view would be *invoked* during commit — before the view exists, that threw
   * and took the render with it.
   */
  getViewDom(): HTMLElement | null;
}

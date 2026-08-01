import { describe, expect, it, vi } from "vitest";
import { refreshCodeBlockTheme } from "./codeBlockTheme";

describe("refreshCodeBlockTheme", () => {
  it("invalidates cached syntax-highlight decorations without changing the document", () => {
    const transaction = {
      setMeta: vi.fn().mockReturnThis(),
    };
    const dispatch = vi.fn();
    const editor = {
      _tiptapEditor: {
        isDestroyed: false,
        state: { tr: transaction },
        view: { dispatch },
      },
    };

    refreshCodeBlockTheme(editor);

    expect(transaction.setMeta).toHaveBeenCalledWith(
      "prosemirror-highlight-refresh",
      true,
    );
    expect(dispatch).toHaveBeenCalledWith(transaction);
  });

  it("does nothing after the editor has been destroyed", () => {
    const dispatch = vi.fn();
    refreshCodeBlockTheme({
      _tiptapEditor: {
        isDestroyed: true,
        state: { tr: { setMeta: vi.fn() } },
        view: { dispatch },
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("resets the highlight plugin cache so unchanged code blocks re-tokenize", () => {
    const transaction = {
      setMeta: vi.fn().mockReturnThis(),
    };
    const dispatch = vi.fn();
    const oldCache = { get: vi.fn(), set: vi.fn(), invalidate: vi.fn() };
    const pluginState = { cache: oldCache };
    const editor = {
      _tiptapEditor: {
        isDestroyed: false,
        state: {
          plugins: [{
            key: "prosemirror-highlight$",
            getState: () => pluginState,
          }],
          tr: transaction,
        },
        view: { dispatch },
      },
    };

    refreshCodeBlockTheme(editor);

    expect(pluginState.cache).not.toBe(oldCache);
    expect(transaction.setMeta).toHaveBeenCalledWith(
      "prosemirror-highlight-refresh",
      true,
    );
    expect(dispatch).toHaveBeenCalledWith(transaction);
  });
});

/**
 * Syntax highlighting actually reaching the document.
 *
 * The failure this guards against is silent: `createParser` calls shiki's
 * `codeToTokens` synchronously, and shiki throws for a language that has not
 * been *loaded* — being bundled is not enough. Every code block then renders as
 * unstyled plain text, which looks like "highlighting is off" rather than an
 * error.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis.window ?? globalThis, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
});

import { act, fireEvent, render, cleanup, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../schema";
import { blocksToPmDoc } from "../blockAdapter";
import { TiptapDocumentEditor } from "../TiptapDocumentEditor";
import { markdownToBlocks } from "@/lib/markdown";
import { useSettingsStore } from "@/store/settingsStore";
import type { Block } from "../blocks";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
  document.documentElement.classList.remove(
    "dark",
    "theme-catppuccin-latte",
    "theme-catppuccin-mocha",
    "theme-dracula",
    "theme-tokyo-night",
    "theme-tokyo-night-day",
    "theme-tokyo-night-storm",
    "theme-dim",
  );
  useSettingsStore.setState({ theme: "system" });
});

function mount(language: string, code: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const blocks: Block[] = [{
    type: "codeBlock",
    props: { language },
    content: [{ type: "text", text: code, styles: {} }],
  }];
  const editor = new Editor({
    element,
    extensions: buildExtensions(),
    content: blocksToPmDoc(blocks) as never,
  });
  editors.push(editor);
  return editor;
}

/** The plugin re-parses when its pending promises settle, so highlighting
 *  appears a tick or two after mount rather than synchronously. */
async function waitForTokens(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tokens = document.querySelectorAll(".shiki");
    if (tokens.length > 0) return tokens;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return document.querySelectorAll(".shiki");
}

/** Counts transactions: a parser that never settles makes prosemirror-highlight
 *  re-dispatch forever, which is CPU-bound and shows up as the whole app going
 *  slow rather than as an error. */
function countingEditor(language: string, code: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  let transactions = 0;
  const blocks: Block[] = [{
    type: "codeBlock",
    props: { language },
    content: [{ type: "text", text: code, styles: {} }],
  }];
  const editor = new Editor({
    element,
    extensions: buildExtensions(),
    content: blocksToPmDoc(blocks) as never,
    onTransaction: () => { transactions += 1; },
  });
  editors.push(editor);
  return { editor, count: () => transactions };
}

describe("does not spin", () => {
  it.each(["text", "", "plaintext"])(
    "settles for a code block with language %p",
    async (language) => {
      // The regression: `loadLanguage("text")` resolves but never appears in
      // getLoadedLanguages(), so "load → re-dispatch → load" ran forever. A
      // fenced block with no language defaults to `text`, i.e. most documents.
      const { count } = countingEditor(language, "hello world");
      await new Promise((resolve) => setTimeout(resolve, 600));
      const settled = count();
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(count()).toBe(settled);
      expect(settled).toBeLessThan(25);
    },
    15000,
  );

  it("settles for an unknown language instead of retrying it", async () => {
    const { count } = countingEditor("not-a-real-language", "some text");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const settled = count();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(count()).toBe(settled);
  }, 15000);

  it("settles for a real grammar once it has loaded", async () => {
    const { count } = countingEditor("rust", "let x = 1;");
    await new Promise((resolve) => setTimeout(resolve, 800));
    const settled = count();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(count()).toBe(settled);
  }, 15000);
});

/**
 * The path the app actually takes: the React editor, which fires
 * `refreshCodeBlockTheme` on mount.
 *
 * That extra dispatch lands *during* the grammar download and re-enters the
 * parser. The raw-Editor tests below never fire it, which is why they passed
 * while every code block in the running app rendered as plain text.
 */
describe("through the React editor", () => {
  afterEach(cleanup);

  async function mountReact(markdown: string) {
    render(
      <TiptapDocumentEditor
        initialBlocks={markdownToBlocks(markdown) as Block[]}
        isDark
      />,
    );
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (document.querySelectorAll(".shiki").length > 2) break;
    }
    const tokens = Array.from(document.querySelectorAll(".shiki"));
    return {
      tokens,
      colours: new Set(tokens.map((token) => token.getAttribute("style"))).size,
    };
  }

  it("highlights rust rather than falling back to plain text", async () => {
    const { tokens, colours } = await mountReact(
      "```rust\nuse bytemuck::{Pod, Zeroable};\nstruct MyType { a: u32 }\n```",
    );
    // Plain text yields one token per line and a single colour — the symptom.
    expect(tokens.length).toBeGreaterThan(3);
    expect(colours).toBeGreaterThan(1);
  }, 20000);

  it("shows the language the block is set to", async () => {
    await mountReact("```rust\nlet x = 1;\n```");
    expect(screen.getByRole("combobox", { name: "Code language" })).toHaveTextContent("rust");
  }, 20000);

  it("disables spellchecking on editable code", async () => {
    await mountReact("```javascript\nconst unlockPassword = true;\n```");
    expect(document.querySelector("pre code")).toHaveAttribute("spellcheck", "false");
  }, 20000);

  it("keeps controls above short code and can wrap long lines", async () => {
    await mountReact("```javascript\nconst value = 'one line';\n```");
    const shell = document.querySelector(".code-block-shell");
    const toolbar = shell?.querySelector(".code-block-toolbar");
    const body = shell?.querySelector("pre.code-block-body");
    expect(toolbar).toBeTruthy();
    expect(body).toBeTruthy();
    expect(toolbar?.nextElementSibling).toBe(body);

    fireEvent.click(screen.getByRole("button", { name: "Wrap code" }));
    expect(shell).toHaveAttribute("data-wrap", "true");
  }, 20000);

  it("constrains huge code blocks until the user expands them", async () => {
    const lines = Array.from({ length: 24 }, (_, index) => `const value${index} = ${index};`).join("\n");
    await mountReact(`\`\`\`javascript\n${lines}\n\`\`\``);
    const shell = document.querySelector(".code-block-shell");
    expect(shell).toHaveAttribute("data-collapsible", "true");
    expect(shell).toHaveAttribute("data-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Expand code block" }));
    expect(shell).toHaveAttribute("data-expanded", "true");
    expect(screen.getByRole("button", { name: "Collapse code block" })).toBeInTheDocument();
  }, 20000);

  it("styles inline code separately and disables spellchecking", async () => {
    render(
      <TiptapDocumentEditor
        initialBlocks={[{
          type: "paragraph",
          content: [
            { type: "text", text: "Run ", styles: {} },
            { type: "text", text: "unlockPassword", styles: { code: true } },
          ],
        }]}
        isDark={false}
      />,
    );
    await waitFor(() => expect(document.querySelector("code[data-inline-code='true']")).toBeTruthy());
    expect(document.querySelector("code[data-inline-code='true']"))
      .toHaveAttribute("spellcheck", "false");
  }, 20000);
});

describe("code block highlighting", () => {
  // These run through `TiptapDocumentEditor`, not a bare `new Editor()`: since
  // @tiptap/react 3.30, `ReactNodeViewRenderer` mounts node views through the
  // React editor's content portal (`editor.contentComponent`), which only
  // exists when the editor is created via `useEditor` — the exact environment
  // the app runs in. A bare Editor never mounts the node view at all, so its
  // code blocks render no content regardless of highlighting.

  it("highlights a language that is bundled but not preloaded", async () => {
    // `rust` is in the bundle; only `text` is loaded at startup. If on-demand
    // loading regresses, this comes back with zero tokens.
    render(
      <TiptapDocumentEditor
        initialBlocks={markdownToBlocks("```rust\nlet counter = Arc::new(Mutex::new(0_i32));\n```") as Block[]}
        isDark
      />,
    );
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
    const tokens = await waitForTokens();
    expect(tokens.length).toBeGreaterThan(0);
  }, 15000);

  it("colours the tokens it emits", async () => {
    render(
      <TiptapDocumentEditor
        initialBlocks={markdownToBlocks("```javascript\nconst answer = 42;\n```") as Block[]}
        isDark
      />,
    );
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
    const tokens = await waitForTokens();
    expect(tokens.length).toBeGreaterThan(0);
    const styled = Array.from(tokens).some((token) =>
      (token.getAttribute("style") ?? "").includes("color"),
    );
    expect(styled).toBe(true);
  }, 15000);

  it("keeps syntax colours for legacy blocks with default paint props", async () => {
    const blocks: Block[] = [{
      type: "codeBlock",
      props: {
        language: "javascript",
        backgroundColor: "default",
        textColor: "default",
      },
      content: [{
        type: "text",
        text: "const answer = async () => await Promise.resolve(42);",
        styles: {},
      }],
    }];
    render(<TiptapDocumentEditor initialBlocks={blocks} isDark />);

    await waitFor(() => expect(document.querySelectorAll(".shiki").length).toBeGreaterThan(0));
    expect(document.querySelector("pre")).not.toHaveAttribute("data-toned");
    const colours = new Set(
      Array.from(document.querySelectorAll(".shiki"))
        .map((token) => token.getAttribute("style")),
    );
    expect(colours.size).toBeGreaterThan(1);
  }, 15000);

  it("re-highlights a mounted code block when the app theme changes", async () => {
    document.documentElement.classList.add("dark");
    const blocks = markdownToBlocks(
      "```javascript\nconst answer = 42;\n```",
    ) as Block[];
    const view = render(
      <TiptapDocumentEditor initialBlocks={blocks} isDark />,
    );
    await waitFor(() => expect(document.querySelectorAll(".shiki").length).toBeGreaterThan(0));
    const darkStyles = Array.from(document.querySelectorAll(".shiki"))
      .map((token) => token.getAttribute("style"));

    document.documentElement.classList.remove("dark");
    view.rerender(
      <TiptapDocumentEditor initialBlocks={blocks} isDark={false} />,
    );

    await waitFor(() => {
      const lightStyles = Array.from(document.querySelectorAll(".shiki"))
        .map((token) => token.getAttribute("style"));
      expect(lightStyles).not.toEqual(darkStyles);
    });
  }, 15000);

  it("re-highlights when switching between two dark named themes", async () => {
    document.documentElement.classList.add("dark");
    useSettingsStore.setState({ theme: "dark" });
    const blocks = markdownToBlocks(
      "```javascript\nconst answer = 42;\n```",
    ) as Block[];
    render(<TiptapDocumentEditor initialBlocks={blocks} isDark />);
    await waitFor(() => expect(document.querySelectorAll(".shiki").length).toBeGreaterThan(0));
    const defaultDarkStyles = Array.from(document.querySelectorAll(".shiki"))
      .map((token) => token.getAttribute("style"));

    await act(async () => {
      document.documentElement.classList.add("theme-dracula");
      useSettingsStore.setState({ theme: "dracula" });
    });

    await waitFor(() => {
      const draculaStyles = Array.from(document.querySelectorAll(".shiki"))
        .map((token) => token.getAttribute("style"));
      expect(draculaStyles).not.toEqual(defaultDarkStyles);
    });
  }, 15000);

  it("falls back to plain text for an unknown language instead of livelocking", async () => {
    render(
      <TiptapDocumentEditor
        initialBlocks={markdownToBlocks("```not-a-real-language\nsome text\n```") as Block[]}
        isDark
      />,
    );
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
    // The parse must settle rather than retry forever; the assertion is simply
    // that the editor is still usable and the code survived.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(document.querySelector(".ProseMirror")?.textContent).toContain("some text");
  }, 15000);
});

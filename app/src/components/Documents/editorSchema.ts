/**
 * Editor schema with shiki syntax highlighting for code blocks.
 * Import ONLY from lazily-loaded editor components (DocEditor,
 * LocalDocEditor) — @blocknote/code-block bundles shiki and must stay out
 * of the main chunk.
 */
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import { MermaidBlock } from "./MermaidBlock";
import { YouTubeBlock } from "./YouTubeBlock";

/**
 * @blocknote/code-block's shiki highlighter loads both "github-dark" and
 * "github-light", but prosemirror-highlight (the plugin that actually tokenizes
 * code blocks) never passes a `theme` option — it always falls back to
 * `highlighter.getLoadedThemes()[0]`, which is "github-dark" since that's the
 * order @blocknote/code-block registers them in. That made every code block
 * render with github-dark's palette even in light app themes, where our CSS
 * (see index.css) pins the block's own background/foreground to whatever the
 * highlighter actually used — so light themes got a black code block instead
 * of one matching github-light.
 *
 * There's no supported way to pass a theme through that call site, so instead
 * we override `getLoadedThemes` to report just the theme matching the app's
 * current light/dark state (read live off the `dark` class `applyTheme` sets
 * on <html>), reordering nothing else. This is evaluated fresh on every parse,
 * so newly opened documents and freshly edited code blocks always pick up the
 * theme active at that moment. Code blocks already on screen when the user
 * flips the app theme keep their existing colors until re-parsed (edited or
 * the document is reopened) — prosemirror-highlight caches decorations by
 * node identity and only invalidates them on content changes, not on unrelated
 * app state.
 */
const themeAwareCodeBlockOptions = {
  ...codeBlockOptions,
  createHighlighter: async () => {
    const highlighter = await codeBlockOptions.createHighlighter();
    highlighter.getLoadedThemes = () =>
      document.documentElement.classList.contains("dark") ? ["github-dark"] : ["github-light"];
    return highlighter;
  },
};

export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec(themeAwareCodeBlockOptions),
    mermaid: MermaidBlock(),
    youtube: YouTubeBlock(),
  },
});

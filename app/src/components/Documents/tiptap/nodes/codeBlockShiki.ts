/**
 * Shiki syntax highlighting for code blocks, as a plain ProseMirror plugin.
 *
 * `prosemirror-highlight` does the highlighting and always did — BlockNote
 * only configured shiki for it, which `highlighter.ts` now does instead.
 *
 * Import ONLY from lazily-loaded editor components: this pulls in shiki, which
 * must stay out of the main chunk.
 */
import { Extension } from "@tiptap/core";
import type { Plugin } from "@tiptap/pm/state";
import { createHighlightPlugin } from "prosemirror-highlight";
import { createParser, type Parser } from "prosemirror-highlight/shiki";
import { createHighlighter } from "./highlighter";

/**
 * prosemirror-highlight never passes a `theme` option — it always falls back
 * to `highlighter.getLoadedThemes()[0]`. Both themes are loaded, so every code
 * block rendered with whichever happened to be first, giving light app themes
 * a dark code block.
 *
 * There is no supported way to pass a theme through that call site, so report
 * only the theme matching the app's current state, read live off the `dark`
 * class on <html>. Evaluated fresh on every parse, so newly opened documents
 * and freshly edited blocks pick up the current theme; blocks already on
 * screen are refreshed explicitly by `refreshCodeBlockTheme`.
 *
 * The bug is upstream in prosemirror-highlight, so this override outlives the
 * BlockNote migration that first needed it.
 */
async function createThemeAwareHighlighter() {
  const highlighter = await createHighlighter();
  highlighter.getLoadedThemes = () => {
    const root = document.documentElement;
    if (root.classList.contains("theme-tokyo-night")) return ["tokyo-night"];
    return root.classList.contains("dark") ? ["github-dark"] : ["github-light"];
  };
  return highlighter;
}

let highlighter: Awaited<ReturnType<typeof createThemeAwareHighlighter>> | null = null;
let highlighterLoading: Promise<void> | null = null;
let baseParser: Parser | null = null;

/**
 * Languages shiki tokenizes without a grammar.
 *
 * `codeToTokens` accepts these happily, but `loadLanguage` resolves *without*
 * adding them to `getLoadedLanguages()` — it stays empty. Gating them on "is it
 * loaded?" is therefore an infinite loop: load → resolve → still not listed →
 * load again, with prosemirror-highlight re-dispatching each round. A fenced
 * block with no language defaults to `text`, so that is most documents.
 */
const GRAMMARLESS_LANGUAGES = new Set(["", "text", "txt", "plain", "plaintext", "ansi"]);

/** Languages a load has already been started for. Recorded *before* awaiting,
 *  so a retry can never request the same grammar twice however the load
 *  resolves — termination does not depend on what shiki reports back. */
const attemptedLanguages = new Set<string>();
/** In-flight loads, so N blocks in one language share a single download. */
const loadingLanguages = new Map<string, Promise<void>>();
/** Not in the bundle. Rendered as plain text rather than retried. */
const unsupportedLanguages = new Set<string>();

/**
 * Parses a code block, loading its grammar first if it needs one.
 *
 * `createParser` calls `codeToTokens` synchronously and shiki throws for a
 * grammar that has not been loaded, so being *bundled* is not enough. Returning
 * a promise is prosemirror-highlight's documented "not ready" signal: it
 * collects them and re-runs the parse once they settle.
 */
const lazyParser: Parser = (options) => {
  if (!highlighter || !baseParser) {
    highlighterLoading ??= createThemeAwareHighlighter().then((created) => {
      highlighter = created;
      baseParser = createParser(created);
    });
    return highlighterLoading;
  }

  const language = (options.language || "text").toLowerCase();
  const asPlainText = () => baseParser!({ ...options, language: "text" });

  if (unsupportedLanguages.has(language)) return asPlainText();

  // Order matters. An in-flight load is checked FIRST, before the "already
  // attempted" guard: any transaction during the download re-enters here, and
  // skipping the wait would parse against a grammar shiki has not got yet —
  // which throws, marks the language unsupported for good, and leaves real code
  // rendering as plain text. `attempted` only prevents *starting* a second
  // load; it must never mean "do not wait".
  const inFlight = loadingLanguages.get(language);
  if (inFlight) return inFlight;

  const needsGrammar = !GRAMMARLESS_LANGUAGES.has(language)
    && !attemptedLanguages.has(language)
    && !highlighter.getLoadedLanguages().includes(language);

  if (needsGrammar) {
    attemptedLanguages.add(language);
    const pending = highlighter
      .loadLanguage(language as never)
      .then(() => undefined)
      .catch(() => { unsupportedLanguages.add(language); })
      .finally(() => loadingLanguages.delete(language));
    loadingLanguages.set(language, pending);
    return pending;
  }

  // Last line of defence: a throwing parse must degrade to plain text, never
  // repeat. Without this a grammar that loads but still fails to tokenize would
  // throw on every transaction.
  try {
    return baseParser(options);
  } catch {
    unsupportedLanguages.add(language);
    return asPlainText();
  }
};

/** Adds shiki decorations to `codeBlock` nodes. */
export const CodeBlockShiki = Extension.create({
  name: "codeBlockShiki",
  addProseMirrorPlugins(): Plugin[] {
    return [createHighlightPlugin({ parser: lazyParser, nodeTypes: ["codeBlock"] })];
  },
});

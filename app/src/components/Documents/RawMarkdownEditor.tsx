import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState, Compartment, Annotation } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, rectangularSelection, crosshairCursor, highlightSpecialChars, placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  indentUnit, bracketMatching, foldGutter, foldKeymap, codeFolding,
} from "@codemirror/language";
import {
  markdown, markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward,
} from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { toast } from "sonner";
import { ListOrdered, Search, SpellCheck, WandSparkles, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsDark } from "@/hooks/useIsDark";
import { formatMarkdown } from "@/lib/formatMarkdown";
import { markdownEditorTheme } from "./markdownEditorTheme";
import { MarkdownSearchBar } from "./MarkdownSearchBar";
import { clipboardImageFiles, clipboardImageFilesOrNative } from "./clipboardImages";

/** Marks a change this component made itself — loading a new document,
 *  formatting — so the update listener can tell it apart from typing. Without
 *  it every programmatic edit is reported back to the parent as user input,
 *  which marks the document dirty and schedules a save for something the user
 *  never did. */
const Programmatic = Annotation.define<boolean>();

/** Two spaces, matching `formatMarkdown`, so hand-indented and formatted text
 *  agree about what one level looks like. */
const INDENT = "  ";

/** How long the document has to sit still before the "format" button re-decides
 *  whether it has anything to do. `formatMarkdown` walks every line, and the
 *  answer only drives whether one button is greyed out — running it on the
 *  keystroke is a whole-document pass per character typed. */
const TIDY_DELAY = 200;

/** A selection longer than this is not what someone means to search for; it is
 *  a paragraph they happened to have highlighted. */
const MAX_SEED = 200;

/** What the find bar should open with. A new object — even with the same text —
 *  means "the user asked for the bar again": refocus and select the field, so a
 *  second ⌘F is not a keystroke that visibly does nothing. */
interface SearchRequest {
  seed: string;
  openReplace: boolean;
  nonce: number;
}

/** Raw Markdown source, edited in CodeMirror.
 *
 *  A `<textarea>` was the obvious thing and carried this screen a long way, but
 *  it cannot hold more than one selection — `selectionStart`/`selectionEnd` is
 *  a single range, so Ctrl+D multi-select is not a hard feature there, it is an
 *  impossible one. The same swap retires a pile of machinery that existed only
 *  to make a textarea behave like an editor: a highlighted layer painted behind
 *  transparent glyphs, its scroll-sync, hand-computed line numbers, and
 *  hand-rolled Tab indentation.
 *
 *  What comes with it, all standard bindings:
 *    Mod-d          select the next occurrence — repeat for more cursors
 *    Mod-Shift-l    select every occurrence at once
 *    Mod-f / Mod-g  find, find next; Mod-h opens it with replace showing
 *    Enter          continues the list or quote you are inside
 *    Tab            indent, Shift-Tab outdent, across every selected line
 *    Ctrl-Shift-[   fold the block under the cursor
 *
 *  Fenced blocks are parsed in their own language (see `codeLanguages`), and
 *  incrementally — a keystroke re-parses the region it touched rather than the
 *  whole document, which is what the previous highlighter had to do.
 */
export function RawMarkdownEditor({
  value,
  onChange,
  label,
  placeholderText,
  onUploadFile,
  readNativeImage,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholderText?: string;
  /** Stores a pasted or dropped file and returns its URL. Omitted, the editor
   *  lets the browser handle a paste as plain text. */
  onUploadFile?: (file: File) => Promise<string>;
  /** Desktop-WebView fallback: some of them never put a pasted screenshot in
   *  `DataTransfer`, so it has to be read from the native clipboard instead. */
  readNativeImage?: () => Promise<File | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isDark = useIsDark();

  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  // Mounting the bar needs a live view; a ref alone would not re-render.
  const [view, setView] = useState<EditorView | null>(null);
  const [focused, setFocused] = useState(false);
  const [wrap, setWrap] = useState(() => localStorage.getItem("tanwords_raw_markdown_wrap") !== "0");
  const [showLineNumbers, setShowLineNumbers] = useState(
    () => localStorage.getItem("tanwords_raw_markdown_lines") !== "0",
  );
  // Off by default: the document is Markdown source, and a spell checker
  // underlining every URL and fence marker is noise. It is a toggle rather than
  // a constant because the other 90% of the file is prose.
  const [spellcheck, setSpellcheck] = useState(
    () => localStorage.getItem("tanwords_raw_markdown_spell") === "1",
  );

  // Compartments let one setting be swapped in place. Rebuilding the editor
  // instead would drop the selection, the undo history and the scroll position
  // every time someone toggled word wrap.
  const compartments = useRef({
    theme: new Compartment(),
    wrapping: new Compartment(),
    gutter: new Compartment(),
    attributes: new Compartment(),
  });

  // `onChange` gets a new identity on every parent render; the editor is built
  // once, so it has to reach the current one rather than close over the first.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const uploadRef = useRef(onUploadFile);
  uploadRef.current = onUploadFile;
  const nativeImageRef = useRef(readNativeImage);
  nativeImageRef.current = readNativeImage;

  // The last string this component handed to `onChange`. The sync effect below
  // compares against it first, which is what keeps a keystroke from serialising
  // the whole rope back out just to discover the parent is echoing us.
  const lastEmitted = useRef(value);
  // Read inside a key binding built once, so it cannot close over the state.
  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchRequest !== null;

  /** Opens the find bar, seeded with the selection the way every other editor
   *  does. Called again while it is already open, it refocuses the field. */
  const openSearch = useCallback((withReplace: boolean) => {
    const selected = (() => {
      const current = viewRef.current;
      if (!current) return "";
      const range = current.state.selection.main;
      if (range.empty || range.to - range.from > MAX_SEED) return "";
      const text = current.state.sliceDoc(range.from, range.to);
      return text.includes("\n") ? "" : text;
    })();
    setSearchRequest((previous) => ({
      seed: selected || previous?.seed || "",
      openReplace: withReplace || (previous?.openReplace ?? false),
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);

  const closeSearch = useCallback(() => {
    setSearchRequest(null);
    viewRef.current?.focus();
  }, []);

  /** Uploads pasted or dropped files and writes a link to each at the cursor. */
  const insertFiles = useCallback(async (target: EditorView, files: File[]) => {
    const upload = uploadRef.current;
    if (!upload) return;
    for (const file of files) {
      try {
        const url = await upload(file);
        const name = file.name || "attachment";
        const snippet = file.type.startsWith("image/") ? `![${name}](${url})` : `[${name}](${url})`;
        // Re-read the selection each time: the awaits above mean the cursor may
        // have moved, and the previous file in this loop moved it itself.
        const at = target.state.selection.main;
        target.dispatch({
          changes: { from: at.from, to: at.to, insert: snippet },
          selection: { anchor: at.from + snippet.length },
        });
      } catch (error) {
        toast.error(String(error));
      }
    }
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { theme, wrapping, gutter, attributes } = compartments.current;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          gutter.of(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : []),
          wrapping.of(wrap ? EditorView.lineWrapping : []),
          theme.of(markdownEditorTheme(isDark)),
          attributes.of(EditorView.contentAttributes.of({
            "aria-label": label,
            spellcheck: spellcheck ? "true" : "false",
          })),
          // Without this the state collapses every selection down to one range
          // and Ctrl+D silently does nothing but move the cursor — the whole
          // reason for this editor.
          EditorState.allowMultipleSelections.of(true),
          history(),
          // Multiple carets are drawn by CodeMirror, not the browser: native
          // selection rendering can only show one.
          drawSelection(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          bracketMatching(),
          closeBrackets(),
          // Folding itself, always on, so the keymap works whether or not the
          // gutter is showing (`foldGutter` above carries its own copy).
          codeFolding(),
          // A zero-width space or a non-breaking space pasted out of a web
          // article is an invisible reason for a heading not to render. The
          // default set covers the zero-width and bidi characters; the two
          // added here are the ones a copied web paragraph actually carries.
          // The ideographic space (U+3000) is deliberately left out: it is
          // ordinary punctuation in Chinese text, not a paste artefact.
          highlightSpecialChars({ addSpecialChars: /[\u00a0\u202f]/g }),
          // The library's own panel is never opened — its markup is not ours to
          // style (see MarkdownSearchBar). The extension still has to be here:
          // it owns the query state and the match highlighting the bar drives.
          search(),
          indentUnit.of(INDENT),
          // Tab renders as wide as the indent it inserts. Left at the default
          // 4, a hand-typed tab and a two-space indent line up differently.
          EditorState.tabSize.of(2),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          placeholderText ? placeholder(placeholderText) : [],
          // Enter and Backspace, bound here rather than left to the copies
          // `markdown()` installs: `defaultKeymap` below wants both keys too,
          // and which one wins would otherwise rest on the order of this array.
          // Continuing a list on Enter is not a detail to leave to chance.
          keymap.of([
            { key: "Enter", run: insertNewlineContinueMarkup },
            { key: "Backspace", run: deleteMarkupBackward },
            // Ours, not `closeSearchPanel`: the library's Escape closes the
            // panel that is never opened, and would report the key handled.
            {
              key: "Escape",
              run: () => {
                if (!searchOpenRef.current) return false;
                closeSearch();
                return true;
              },
            },
            { key: "Mod-f", run: () => { openSearch(false); return true; }, scope: "editor" },
            { key: "Mod-h", run: () => { openSearch(true); return true; }, scope: "editor" },
            // searchKeymap before defaultKeymap: they both want Mod-d, and the
            // multi-cursor one is the point. Mod-f is dropped from it because
            // it is bound above.
            ...searchKeymap.filter((binding) => binding.key !== "Mod-f"),
            ...closeBracketsKeymap,
            ...foldKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.domEventHandlers({
            focus: () => { setFocused(true); },
            blur: () => { setFocused(false); },
            paste: (event, target) => {
              if (!uploadRef.current || !event.clipboardData) return false;
              const advertisesImage = Array.from(event.clipboardData.types)
                .some((type) => type.startsWith("image/"));
              if (clipboardImageFiles(event.clipboardData).length === 0 && !advertisesImage) return false;
              event.preventDefault();
              const readNative = nativeImageRef.current ?? (async () => null);
              void clipboardImageFilesOrNative(event.clipboardData, readNative)
                .then((images) => insertFiles(target, images));
              return true;
            },
            drop: (event, target) => {
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (!uploadRef.current || files.length === 0) return false;
              event.preventDefault();
              // Put the caret where it was dropped, so the link lands there
              // rather than wherever the cursor happened to be.
              const pos = target.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos !== null) target.dispatch({ selection: { anchor: pos } });
              void insertFiles(target, files);
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(Programmatic))) return;
            const next = update.state.doc.toString();
            lastEmitted.current = next;
            onChangeRef.current(next);
          }),
        ],
      }),
    });
    viewRef.current = view;
    setView(view);
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
      setView(null);
    };
    // Built once. Everything that can change is reconfigured through a
    // compartment below, and `value` is reconciled by its own effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edits from outside — switching in from rich mode, formatting, an undo
  // upstream. Guarded on the document actually differing, or every keystroke
  // would echo back through the parent and reset the cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // The common case by far: the parent is handing back the string we just
    // gave it. Caught on an identity check, before serialising the document.
    if (lastEmitted.current === value) return;
    if (view.state.doc.length === value.length && view.state.doc.toString() === value) {
      lastEmitted.current = value;
      return;
    }
    lastEmitted.current = value;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      // Clamp the caret into the new document rather than letting it fall back
      // to the top of the file.
      selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) },
      annotations: Programmatic.of(true),
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.theme.reconfigure(markdownEditorTheme(isDark)),
    });
  }, [isDark]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.wrapping.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.gutter.reconfigure(
        showLineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : [],
      ),
    });
  }, [showLineNumbers]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.attributes.reconfigure(EditorView.contentAttributes.of({
        "aria-label": label,
        spellcheck: spellcheck ? "true" : "false",
      })),
    });
  }, [label, spellcheck]);

  // Whether the document has anything to tidy, computed off the keystroke: the
  // answer only greys out one button, and `formatMarkdown` walks every line to
  // reach it. Seeded synchronously so the button is right on the first paint,
  // then re-run once typing pauses. Between those it holds its last answer
  // rather than flickering, and `format` recomputes from the live document
  // anyway, so a stale "enabled" costs nothing but a click that does nothing.
  const [tidied, setTidied] = useState(() => ({ source: value, formatted: formatMarkdown(value) }));
  useEffect(() => {
    if (tidied.source === value) return;
    const timer = setTimeout(
      () => setTidied({ source: value, formatted: formatMarkdown(value) }),
      TIDY_DELAY,
    );
    return () => clearTimeout(timer);
  }, [value, tidied.source]);

  const format = () => {
    const view = viewRef.current;
    if (!view) return;
    const source = view.state.doc.toString();
    const formatted = tidied.source === source ? tidied.formatted : formatMarkdown(source);
    if (formatted === source) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
      selection: { anchor: Math.min(view.state.selection.main.anchor, formatted.length) },
    });
    view.focus();
  };

  const persistToggle = (key: string, next: boolean) => {
    localStorage.setItem(key, next ? "1" : "0");
    return next;
  };

  return (
    <div className="raw-markdown-editor flex min-h-0 flex-1 flex-col px-6 pb-4 pt-2">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl bg-background">
        <div className="relative mx-auto flex min-h-0 w-full max-w-[960px] flex-1 overflow-hidden">
          {/* Floats over the text, so it steps out of the way while you write
            * and comes back on hover or focus. Without this it covers the ends
            * of the first line whenever word wrap is off. */}
          <div
            className={`absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg bg-muted/70 p-0.5 backdrop-blur-sm transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100 ${
              focused ? "opacity-25" : "opacity-100"
            }`}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={format}
              disabled={tidied.formatted === tidied.source}
              title="Format Markdown"
              aria-label="Format Markdown"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <WandSparkles className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => openSearch(false)}
              title="Find and replace (⌘F)"
              aria-label="Find and replace"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
            {/* Hairline, not a gap: the two on the left act on the document,
              * the three on the right only change how it is displayed. */}
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowLineNumbers((current) => persistToggle("tanwords_raw_markdown_lines", !current))}
              title="Toggle line numbers"
              aria-label="Toggle line numbers"
              aria-pressed={showLineNumbers}
              className={`h-6 w-6 rounded-md ${showLineNumbers ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setWrap((current) => persistToggle("tanwords_raw_markdown_wrap", !current))}
              title="Toggle word wrap"
              aria-label="Toggle word wrap"
              aria-pressed={wrap}
              className={`h-6 w-6 rounded-md ${wrap ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
            >
              <WrapText className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSpellcheck((current) => persistToggle("tanwords_raw_markdown_spell", !current))}
              title="Toggle spell check"
              aria-label="Toggle spell check"
              aria-pressed={spellcheck}
              className={`h-6 w-6 rounded-md ${spellcheck ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
            >
              <SpellCheck className="h-3.5 w-3.5" />
            </Button>
          </div>
          {searchRequest && view && (
            <MarkdownSearchBar
              view={view}
              seed={searchRequest.seed}
              openReplace={searchRequest.openReplace}
              focusNonce={searchRequest.nonce}
              onClose={closeSearch}
            />
          )}
          <div ref={hostRef} className="min-h-0 w-full flex-1 overflow-hidden" />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorState, Compartment, Annotation } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, rectangularSelection, crosshairCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { indentUnit, bracketMatching } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { ListOrdered, Search, WandSparkles, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsDark } from "@/hooks/useIsDark";
import { formatMarkdown } from "@/lib/formatMarkdown";
import { markdownEditorTheme } from "./markdownEditorTheme";
import { MarkdownSearchBar } from "./MarkdownSearchBar";

/** Marks a change this component made itself — loading a new document,
 *  formatting — so the update listener can tell it apart from typing. Without
 *  it every programmatic edit is reported back to the parent as user input,
 *  which marks the document dirty and schedules a save for something the user
 *  never did. */
const Programmatic = Annotation.define<boolean>();

/** Two spaces, matching `formatMarkdown`, so hand-indented and formatted text
 *  agree about what one level looks like. */
const INDENT = "  ";

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
 *    Mod-f / Mod-g  find, find next; the panel carries replace
 *    Tab            indent, Shift-Tab outdent, across every selected line
 *
 *  Fenced blocks are parsed in their own language (see `codeLanguages`), and
 *  incrementally — a keystroke re-parses the region it touched rather than the
 *  whole document, which is what the previous highlighter had to do.
 */
export function RawMarkdownEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isDark = useIsDark();

  const [searchOpen, setSearchOpen] = useState(false);
  // Mounting the bar needs a live view; a ref alone would not re-render.
  const [view, setView] = useState<EditorView | null>(null);
  const [wrap, setWrap] = useState(() => localStorage.getItem("tanwords_raw_markdown_wrap") !== "0");
  const [showLineNumbers, setShowLineNumbers] = useState(
    () => localStorage.getItem("tanwords_raw_markdown_lines") !== "0",
  );

  // Compartments let one setting be swapped in place. Rebuilding the editor
  // instead would drop the selection, the undo history and the scroll position
  // every time someone toggled word wrap.
  const compartments = useRef({
    theme: new Compartment(),
    wrapping: new Compartment(),
    gutter: new Compartment(),
  });

  // `onChange` gets a new identity on every parent render; the editor is built
  // once, so it has to reach the current one rather than close over the first.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { theme, wrapping, gutter } = compartments.current;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          gutter.of(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
          wrapping.of(wrap ? EditorView.lineWrapping : []),
          theme.of(markdownEditorTheme(isDark)),
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
          // The library's own panel is never opened — its markup is not ours to
          // style (see MarkdownSearchBar). The extension still has to be here:
          // it owns the query state and the match highlighting the bar drives.
          search(),
          indentUnit.of(INDENT),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          // searchKeymap first: it and defaultKeymap both want Mod-d, and the
          // multi-cursor one is the point.
          // Mod-f and Mod-h open our bar. The rest of searchKeymap — Mod-d,
          // Mod-Shift-l, Mod-g — is taken as-is, and must come before
          // defaultKeymap, which also wants Mod-d.
          keymap.of([
            { key: "Mod-f", run: () => { setSearchOpen(true); return true; }, scope: "editor" },
            { key: "Mod-h", run: () => { setSearchOpen(true); return true; }, scope: "editor" },
            ...searchKeymap.filter((binding) => binding.key !== "Mod-f"),
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(Programmatic))) return;
            onChangeRef.current(update.state.doc.toString());
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
    if (!view || view.state.doc.toString() === value) return;
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
        showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
      ),
    });
  }, [showLineNumbers]);

  // Computed rather than run on click, so the button can go quiet on a document
  // that is already tidy — pressing it and seeing nothing happen is
  // indistinguishable from a broken button.
  const formatted = useMemo(() => formatMarkdown(value), [value]);

  const format = () => {
    const view = viewRef.current;
    if (!view || formatted === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
      selection: { anchor: Math.min(view.state.selection.main.anchor, formatted.length) },
    });
    view.focus();
  };

  const toggleWrap = () => {
    setWrap((current) => {
      const next = !current;
      localStorage.setItem("tanwords_raw_markdown_wrap", next ? "1" : "0");
      return next;
    });
  };

  const toggleLines = () => {
    setShowLineNumbers((current) => {
      const next = !current;
      localStorage.setItem("tanwords_raw_markdown_lines", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="raw-markdown-editor flex min-h-0 flex-1 flex-col px-6 pb-4 pt-2">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-xl bg-background">
        <div className="relative mx-auto flex min-h-0 w-full max-w-[960px] flex-1 overflow-hidden">
          <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg bg-muted/70 p-0.5 backdrop-blur-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={format}
              disabled={formatted === value}
              title="Format Markdown"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <WandSparkles className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSearchOpen(true)}
              title="Find and replace (⌘F)"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
            {/* Hairline, not a gap: the two on the left act on the document,
              * the two on the right only change how it is displayed. */}
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleLines}
              title="Toggle line numbers"
              className={`h-6 w-6 rounded-md ${showLineNumbers ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleWrap}
              title="Toggle word wrap"
              className={`h-6 w-6 rounded-md ${wrap ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
            >
              <WrapText className="h-3.5 w-3.5" />
            </Button>
          </div>
          {searchOpen && view && (
            <MarkdownSearchBar
              view={view}
              onClose={() => { setSearchOpen(false); view.focus(); }}
            />
          )}
          <div ref={hostRef} className="min-h-0 w-full flex-1 overflow-hidden" />
        </div>
      </div>
    </div>
  );
}

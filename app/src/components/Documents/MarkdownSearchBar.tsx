import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  SearchQuery, RegExpCursor, SearchCursor,
  findNext, findPrevious, replaceAll, replaceNext, selectMatches, setSearchQuery,
} from "@codemirror/search";
import { ArrowDown, ArrowUp, CaseSensitive, ChevronRight, ListChecks, Regex, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Find and replace for the raw-Markdown editor, built from the app's own
 *  controls rather than CodeMirror's bundled panel.
 *
 *  The panel that ships with `@codemirror/search` works, but styling it means
 *  reaching into markup this project does not own — its inputs carry no `type`
 *  attribute, its two rows are separated by a bare `<br>`, and a selector that
 *  guesses wrong fails silently and leaves a system-white box on a dark panel.
 *  Only the *commands* are worth taking from the library; the surface is ours,
 *  and then it simply matches everything else in the app.
 */
/** How long typing has to pause before the match count is recounted, and before
 *  a document still being edited is counted against. Every command below
 *  flushes the live query first, so the delay never makes a button act on a
 *  stale search — it only keeps a keystroke from scanning the whole file. */
const SETTLE = 150;

export function MarkdownSearchBar({
  view,
  seed,
  openReplace,
  focusNonce,
  onClose,
}: {
  view: EditorView;
  /** Text to search for, taken from the selection when the bar was opened. */
  seed: string;
  /** Opened with ⌘H rather than ⌘F: show the replace row straight away. */
  openReplace: boolean;
  /** Bumped every time the bar is asked for again, including while it is
   *  already open — that is a request to refocus the field, not a no-op. */
  focusNonce: number;
  onClose: () => void;
}) {
  const [find, setFind] = useState(seed);
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(openReplace);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (seed) setFind(seed);
    if (openReplace) setShowReplace(true);
    findRef.current?.focus();
    findRef.current?.select();
    // Keyed on the nonce alone: a second ⌘F with the same selection still has
    // to bring the caret back to the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const query = useMemo(
    () => new SearchQuery({ search: find, replace, caseSensitive, regexp, wholeWord }),
    [find, replace, caseSensitive, regexp, wholeWord],
  );

  // The editor holds the query — it is what highlights matches and what the
  // commands below read. Pushing it on every change keeps the highlighting in
  // step with the box as you type.
  useEffect(() => {
    view.dispatch({ effects: setSearchQuery.of(query) });
  }, [view, query]);

  /** Runs a search command against the query as it stands *now*. The effect
   *  above lands in its own transaction, and React may not have flushed it by
   *  the time a button is clicked — typing "foo" and hitting replace-all
   *  immediately would otherwise run against the previous query. Dispatching it
   *  again first is idempotent and removes the ordering question. */
  const run = (command: (target: EditorView) => boolean) => {
    view.dispatch({ effects: setSearchQuery.of(query) });
    command(view);
  };

  // The counting below walks the document, so it runs against a snapshot that
  // settles rather than against every keystroke. `Text` is immutable — holding
  // last moment's is safe, it just means the number lags typing by `SETTLE`.
  const doc = view.state.doc;
  const [countedDoc, setCountedDoc] = useState(doc);
  const [countedQuery, setCountedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => { setCountedDoc(doc); setCountedQuery(query); }, SETTLE);
    return () => clearTimeout(timer);
  }, [doc, query]);

  /** How many matches there are. `@codemirror/search` highlights them but never
   *  says how many, and "no results" versus "many" is the first thing anyone
   *  looks for. Capped, so a single-character query in a long document cannot
   *  turn one keystroke into a full scan. */
  const matches = useMemo(() => {
    if (!countedQuery.valid) return 0;
    const text = countedDoc;
    try {
      const cursor = countedQuery.regexp
        ? new RegExpCursor(text, countedQuery.search, { ignoreCase: !countedQuery.caseSensitive })
        : new SearchCursor(text, countedQuery.search, 0, text.length, countedQuery.caseSensitive ? undefined : (s) => s.toLowerCase());
      let count = 0;
      while (!cursor.next().done && count < 1000) count += 1;
      return count;
    } catch {
      // An unfinished regular expression is a normal thing to have typed.
      return 0;
    }
  }, [countedQuery, countedDoc]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(findNext);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    // Shift+Enter is the universal "the other way" on a find field. It has to
    // be caught here: the submit event a form fires carries no modifier keys.
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      run(findPrevious);
    }
  };

  const FIELD =
    "h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-hidden placeholder:text-muted-foreground/70 focus:border-primary/70 focus:ring-2 focus:ring-primary/25";

  const toggle = (active: boolean, onClick: () => void, title: string, Icon: typeof Regex) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`h-6 w-6 shrink-0 rounded ${
        active ? "bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );

  const action = (onClick: () => void, title: string, Icon: typeof Regex, disabled = false) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="h-6 w-6 shrink-0 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );

  return (
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      className="absolute right-2 top-2 z-30 w-[min(30rem,calc(100%-1rem))] rounded-lg border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-1.5">
        {/* The disclosure sits outside both rows so it lines up with neither
          * field in particular — it belongs to the pair. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setShowReplace((open) => !open)}
          title={showReplace ? "Hide replace" : "Show replace"}
          aria-expanded={showReplace}
          className="mt-0.5 h-6 w-6 shrink-0 rounded text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showReplace ? "rotate-90" : ""}`} />
        </Button>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <input
                ref={findRef}
                value={find}
                onChange={(event) => setFind(event.target.value)}
                placeholder="Find"
                aria-label="Find"
                className={`${FIELD} pr-16`}
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground">
                {find ? (matches >= 1000 ? "999+" : `${matches}`) : ""}
              </span>
            </div>
            {toggle(caseSensitive, () => setCaseSensitive((v) => !v), "Match case", CaseSensitive)}
            {toggle(wholeWord, () => setWholeWord((v) => !v), "Match whole word", WholeWord)}
            {toggle(regexp, () => setRegexp((v) => !v), "Use regular expression", Regex)}
            {action(() => run(findPrevious), "Previous match", ArrowUp, !find)}
            {action(() => run(findNext), "Next match", ArrowDown, !find)}
            {action(() => run(selectMatches), "Put a cursor on every match", ListChecks, !find)}
          </div>

          {showReplace && (
            <div className="flex items-center gap-1.5">
              <input
                value={replace}
                onChange={(event) => setReplace(event.target.value)}
                placeholder="Replace"
                aria-label="Replace"
                className={`${FIELD} min-w-0 flex-1`}
              />
              {action(() => run(replaceNext), "Replace next", Replace, !find)}
              {action(() => run(replaceAll), "Replace all", ReplaceAll, !find)}
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
          className="mt-0.5 h-6 w-6 shrink-0 rounded text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </form>
  );
}

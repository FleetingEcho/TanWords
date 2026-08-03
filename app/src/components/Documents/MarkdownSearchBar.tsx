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
export function MarkdownSearchBar({ view, onClose }: { view: EditorView; onClose: () => void }) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => { findRef.current?.focus(); findRef.current?.select(); }, []);

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

  /** How many matches there are. `@codemirror/search` highlights them but never
   *  says how many, and "no results" versus "many" is the first thing anyone
   *  looks for. Counting is cheap next to the tokenising the editor already
   *  does, and capped so a single-character query in a long document cannot
   *  turn every keystroke into a full scan. */
  const matches = useMemo(() => {
    if (!query.valid) return 0;
    const text = view.state.doc;
    try {
      const cursor = query.regexp
        ? new RegExpCursor(text, query.search, { ignoreCase: !query.caseSensitive })
        : new SearchCursor(text, query.search, 0, text.length, query.caseSensitive ? undefined : (s) => s.toLowerCase());
      let count = 0;
      while (!cursor.next().done && count < 1000) count += 1;
      return count;
    } catch {
      // An unfinished regular expression is a normal thing to have typed.
      return 0;
    }
    // Recount when the document changes under a stable query, too.
  }, [query, view.state.doc]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    findNext(view);
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
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
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
            {action(() => findPrevious(view), "Previous match", ArrowUp, !find)}
            {action(() => findNext(view), "Next match", ArrowDown, !find)}
            {action(() => selectMatches(view), "Put a cursor on every match", ListChecks, !find || matches === 0)}
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
              {action(() => replaceNext(view), "Replace next", Replace, !find)}
              {action(() => replaceAll(view), "Replace all", ReplaceAll, !find)}
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

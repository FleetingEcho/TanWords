import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";
import { findTextMatches } from "./documentSearch";

const ALL_MATCHES = "tanwords-document-search";
const ACTIVE_MATCH = "tanwords-document-search-active";
// CSS Custom Highlight keeps every Range live. Common one-character queries in
// a large document can otherwise create tens of thousands of Range objects and
// make both applying and clearing the highlight noticeably block the webview.
const MAX_HIGHLIGHT_MATCHES = 1_000;

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
  clear(): void;
};

function highlightApi(): { registry: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | null {
  const css = (globalThis as typeof globalThis & {
    CSS?: typeof CSS & { highlights?: HighlightRegistry };
  }).CSS;
  const HighlightConstructor = (globalThis as typeof globalThis & {
    Highlight?: new (...ranges: Range[]) => unknown;
  }).Highlight;
  return css?.highlights && HighlightConstructor
    ? { registry: css.highlights, Highlight: HighlightConstructor }
    : null;
}

export function DocumentContentSearch({ rootRef }: {
  rootRef: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<Range[]>([]);
  const activeIndexRef = useRef(0);
  const appliedQueryRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  // Read by the MutationObserver below so a mutation that fires after the user
  // has already cleared/changed the query (e.g. an async image or mermaid
  // diagram finishing its render inside the document) re-highlights against
  // the *current* query instead of whatever query was active when that
  // observer instance's closure was created.
  const queryRef = useRef(query);
  queryRef.current = query;
  const [activeIndex, setActiveIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [matchesTruncated, setMatchesTruncated] = useState(false);

  const applyHighlights = useCallback((
    nextQuery: string,
    requestedIndex = 0,
    revealMatch = true,
  ) => {
    const api = highlightApi();
    const root = rootRef.current;
    // These are the only custom highlights registered by the app. Clearing the
    // registry in one operation also forces WebKitGTK to invalidate the painted
    // highlight layer; deleting the two entries separately can leave stale
    // pixels behind until another document paint.
    api?.registry.clear();
    appliedQueryRef.current = nextQuery;
    const matches = root
      ? findTextMatches(root, nextQuery, MAX_HIGHLIGHT_MATCHES + 1)
      : [];
    const truncated = matches.length > MAX_HIGHLIGHT_MATCHES;
    rangesRef.current = truncated ? matches.slice(0, MAX_HIGHLIGHT_MATCHES) : matches;
    const count = rangesRef.current.length;
    const nextIndex = count ? (requestedIndex + count) % count : 0;
    activeIndexRef.current = nextIndex;
    setMatchCount(count);
    setMatchesTruncated(truncated);
    setActiveIndex(nextIndex);
    if (!api || !count) return;
    api.registry.set(ALL_MATCHES, new api.Highlight(...rangesRef.current));
    api.registry.set(ACTIVE_MATCH, new api.Highlight(rangesRef.current[nextIndex]));
    if (revealMatch) {
      rangesRef.current[nextIndex].startContainer.parentElement?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }, [rootRef]);

  const updateQuery = useCallback((nextQuery: string) => {
    // Update before React commits so a queued MutationObserver callback cannot
    // re-apply the previous query in the gap between the input event and effect.
    queryRef.current = nextQuery;
    if (!nextQuery.trim()) applyHighlights("", 0, false);
    setQuery(nextQuery);
  }, [applyHighlights]);

  useEffect(() => {
    if (appliedQueryRef.current !== query) applyHighlights(query, 0);
  }, [applyHighlights, query]);

  // Set up once (not on every keystroke) so there's only ever one observer
  // instance to reason about; it always re-reads queryRef.current, so a
  // mutation it reacts to is never highlighted against a stale query.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new MutationObserver(() =>
      applyHighlights(queryRef.current, activeIndexRef.current, false)
    );
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [applyHighlights, rootRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const api = highlightApi();
      api?.registry.clear();
    };
  }, []);

  const move = (delta: number) => applyHighlights(query, activeIndex + delta);

  return (
    <div className="relative flex h-6 w-[30%] min-w-40 shrink-0 items-center rounded-md bg-background/75 shadow-xs ring-1 ring-border/70">
      <Search className="ml-1.5 h-3 w-3 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => updateQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            move(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape") {
            updateQuery("");
            inputRef.current?.blur();
          }
        }}
        placeholder={t("doc.searchContent")}
        aria-label={t("doc.searchContent")}
        className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[10px] outline-hidden placeholder:text-muted-foreground/60"
      />
      {query && (
        <>
          <span className="shrink-0 px-1 text-[9px] tabular-nums text-muted-foreground">
            {matchCount
              ? `${activeIndex + 1}/${matchCount}${matchesTruncated ? "+" : ""}`
              : t("doc.noSearchMatches")}
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={() => move(-1)}
            disabled={!matchCount} aria-label={t("doc.previousMatch")} className="h-5 w-5 rounded-sm p-0">
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => move(1)}
            disabled={!matchCount} aria-label={t("doc.nextMatch")} className="h-5 w-5 rounded-sm p-0">
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => updateQuery("")}
            aria-label={t("doc.clearSearch")} className="mr-0.5 h-5 w-5 rounded-sm p-0">
            <X className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
}

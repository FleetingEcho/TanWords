import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";
import { findTextMatches } from "./documentSearch";

const ALL_MATCHES = "tanwords-document-search";
const ACTIVE_MATCH = "tanwords-document-search-active";

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
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
  rootRef: React.RefObject<HTMLElement>;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<Range[]>([]);
  const activeIndexRef = useRef(0);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);

  const applyHighlights = useCallback((
    nextQuery: string,
    requestedIndex = 0,
    revealMatch = true,
  ) => {
    const api = highlightApi();
    const root = rootRef.current;
    api?.registry.delete(ALL_MATCHES);
    api?.registry.delete(ACTIVE_MATCH);
    rangesRef.current = root ? findTextMatches(root, nextQuery) : [];
    const count = rangesRef.current.length;
    const nextIndex = count ? (requestedIndex + count) % count : 0;
    activeIndexRef.current = nextIndex;
    setMatchCount(count);
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

  useEffect(() => {
    applyHighlights(query, 0);
    const root = rootRef.current;
    if (!root) return;
    const observer = new MutationObserver(() =>
      applyHighlights(query, activeIndexRef.current, false)
    );
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [applyHighlights, query, rootRef]);

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
      api?.registry.delete(ALL_MATCHES);
      api?.registry.delete(ACTIVE_MATCH);
    };
  }, []);

  const move = (delta: number) => applyHighlights(query, activeIndex + delta);

  return (
    <div className="relative flex h-6 items-center rounded-md bg-background/75 shadow-sm ring-1 ring-border/70">
      <Search className="ml-1.5 h-3 w-3 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            move(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape") {
            setQuery("");
            inputRef.current?.blur();
          }
        }}
        placeholder={t("doc.searchContent")}
        aria-label={t("doc.searchContent")}
        className="h-full w-28 bg-transparent px-1.5 text-[10px] outline-none placeholder:text-muted-foreground/60 focus:w-44"
      />
      {query && (
        <>
          <span className="shrink-0 px-1 text-[9px] tabular-nums text-muted-foreground">
            {matchCount ? `${activeIndex + 1}/${matchCount}` : t("doc.noSearchMatches")}
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={() => move(-1)}
            disabled={!matchCount} aria-label={t("doc.previousMatch")} className="h-5 w-5 rounded-sm p-0">
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => move(1)}
            disabled={!matchCount} aria-label={t("doc.nextMatch")} className="h-5 w-5 rounded-sm p-0">
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => setQuery("")}
            aria-label={t("doc.clearSearch")} className="mr-0.5 h-5 w-5 rounded-sm p-0">
            <X className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
}

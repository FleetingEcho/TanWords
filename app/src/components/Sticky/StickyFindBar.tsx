/** Sticky-window find & replace (tanNotes F22, plan §4.5).
 *
 *  Operates on the LIVE ProseMirror document: matches are computed from
 *  `doc.descendants` text nodes (case-insensitive), and each navigation /
 *  replacement maps straight back to PM positions — no decorations, no
 *  plugin state, just selection + `insertContentAt`. A match spanning two
 *  differently-styled runs is intentionally not found: matches live inside a
 *  single text node, which keeps replace-style-preserving and the code small.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";

interface Match {
  from: number;
  to: number;
}

/** All case-insensitive matches of `query` inside single text nodes. */
function findMatches(editor: Editor, query: string, caseSensitive: boolean): Match[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Match[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const haystack = caseSensitive ? node.text : node.text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      matches.push({ from: pos + index, to: pos + index + query.length });
      index = haystack.indexOf(needle, index + needle.length);
    }
  });
  return matches;
}

export function StickyFindBar({
  editor, onClose,
}: {
  editor: Editor | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => (editor ? findMatches(editor, query, caseSensitive) : []),
    // Recomputed on demand via `refresh`, not on every transaction —
    // `matchesRef.current` below is what the UI reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, query, caseSensitive],
  );

  // Keep a live ref so the key handlers below see fresh matches without
  // re-binding on every keystroke.
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const selectMatch = (index: number) => {
    if (!editor) return;
    const list = matchesRef.current;
    if (!list.length) return;
    const wrapped = ((index % list.length) + list.length) % list.length;
    setCursor(wrapped);
    const match = list[wrapped];
    editor.commands.setTextSelection({ from: match.from, to: match.to });
    // scrollIntoView rides the selection command chain.
    editor.commands.scrollIntoView();
  };

  const replaceCurrent = () => {
    if (!editor) return;
    const list = matchesRef.current;
    const match = list[cursorRef.current];
    if (!match) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: match.from, to: match.to }, replacement)
      .run();
    // Positions shifted; reselect the same ordinal in the fresh list.
    requestAnimationFrame(() => selectMatch(cursorRef.current));
  };

  const replaceAll = () => {
    if (!editor) return;
    const list = matchesRef.current;
    if (!list.length) return;
    // Back-to-front keeps every earlier range valid while replacing.
    const chain = editor.chain().focus();
    for (let i = list.length - 1; i >= 0; i -= 1) {
      chain.insertContentAt({ from: list[i].from, to: list[i].to }, replacement);
    }
    chain.run();
  };

  return (
    <div className="app-region-no-drag absolute top-12 right-2 z-50 w-72 rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              selectMatch(e.shiftKey ? cursorRef.current - 1 : cursorRef.current + 1);
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Find"
          className="min-w-0 flex-1 rounded-md border border-black/15 bg-white px-2 py-1 text-sm outline-none"
        />
        <button
          type="button"
          title="Match case"
          className={`rounded-md p-1 hover:bg-black/10 ${caseSensitive ? "bg-black/15" : ""}`}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          <CaseSensitive className="size-3.5" />
        </button>
        <span className="min-w-10 text-center text-[11px] text-neutral-500">
          {matches.length ? `${cursor + 1}/${matches.length}` : query ? "0/0" : ""}
        </span>
        <button type="button" title="Previous" className="rounded-md p-1 hover:bg-black/10" onClick={() => selectMatch(cursorRef.current - 1)}>
          <ChevronUp className="size-3.5" />
        </button>
        <button type="button" title="Next" className="rounded-md p-1 hover:bg-black/10" onClick={() => selectMatch(cursorRef.current + 1)}>
          <ChevronDown className="size-3.5" />
        </button>
        <button type="button" title="Close" className="rounded-md p-1 hover:bg-black/10" onClick={onClose}>
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="Replace with"
          className="min-w-0 flex-1 rounded-md border border-black/15 bg-white px-2 py-1 text-sm outline-none"
        />
        <button
          type="button"
          className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-neutral-100"
          onClick={replaceCurrent}
        >
          Replace
        </button>
        <button
          type="button"
          className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-neutral-100"
          onClick={replaceAll}
        >
          All
        </button>
      </div>
    </div>
  );
}

/**
 * The `/` insert menu — presentation only.
 *
 * BlockNote shipped one; Tiptap supplies just the Suggestion plugin, so the
 * list and its keyboard handling are ours. Navigation lives in
 * `slashSuggestion.ts` (it has to consume the key events); this renders the
 * snapshot that publishes.
 *
 * Positioned absolutely inside the editor's own scroll container, so it
 * travels with the text it belongs to rather than floating over the page.
 */
import { useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { useT } from "@/hooks/useT";
import type { SlashMenuSnapshot } from "./slashSuggestion";

export function SlashMenu({
  editor,
  snapshot,
}: {
  editor: Editor;
  snapshot: SlashMenuSnapshot | null;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const selected = snapshot?.selected ?? 0;

  // Keep the highlighted row visible when arrowing past the fold.
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!snapshot || snapshot.items.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("doc.slashMenu")}
      style={{ left: snapshot.rect.left, top: snapshot.rect.top }}
      className="absolute z-50 max-h-64 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      {snapshot.items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          data-index={index}
          role="option"
          aria-selected={index === selected}
          // onMouseDown, not onClick: a click would blur the editor first and
          // the insert would land nowhere.
          onMouseDown={(event) => { event.preventDefault(); item.run(editor); }}
          className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
            index === selected ? "bg-muted text-foreground" : "text-muted-foreground"
          }`}
        >
          {t(item.titleKey)}
        </button>
      ))}
    </div>
  );
}

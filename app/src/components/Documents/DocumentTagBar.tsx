import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { tagHue } from "./tagColor";
import { addTag, MAX_TAG_LENGTH, parseTags } from "./documentTags";

/** The document's tags, editable in place: the chips the list rows draw, an ×
 *  on each, and an add box that suggests from the tags already in the library.
 *
 *  Tags were readable everywhere (list chips, the filter, per-tag counts) and
 *  writable nowhere — every updateDocument call site passed `doc.tags` straight
 *  back through, so the only way one could exist was an MCP or AI write. This
 *  is the missing end of that feature. */
export function DocumentTagBar({ tags: raw, onChange, disabled = false }: {
  tags: string;
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const db = useDB();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [library, setLibrary] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const tags = useMemo(() => parseTags(raw), [raw]);

  // Suggestions come from the whole library, so a tag stays a shared vocabulary
  // instead of drifting into per-document near-duplicates. Fetched when the box
  // opens rather than on mount: this bar renders for every open document.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void db.getAllTags().then((all) => { if (!cancelled) setLibrary(all); });
    return () => { cancelled = true; };
  }, [open, db]);

  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    const taken = new Set(tags.map((tag) => tag.toLowerCase()));
    return library
      .filter((tag) => !taken.has(tag.toLowerCase()) && (!query || tag.toLowerCase().includes(query)))
      .slice(0, 8);
  }, [library, draft, tags]);

  const commit = (candidate: string) => {
    const next = addTag(tags, candidate);
    setDraft("");
    // Keep the box open: adding tags is a burst activity, and reopening the
    // popover between each one is most of the work.
    inputRef.current?.focus();
    if (next !== tags) onChange(next);
  };

  const remove = (tag: string) => onChange(tags.filter((item) => item !== tag));

  if (disabled && tags.length === 0) return null;

  return (
    <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5">
      {tags.map((tag) => {
        const hue = tagHue(tag);
        return (
          <span
            key={tag}
            className="group/tag flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4"
            style={{
              background: `color-mix(in oklab, hsl(${hue} 70% 50%) 14%, transparent)`,
              color: `hsl(${hue} 55% var(--tag-chip-l, 38%))`,
            }}
          >
            <span className="min-w-0 truncate">{tag}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(tag)}
                title={t("doc.removeTag", { tag })}
                aria-label={t("doc.removeTag", { tag })}
                // Always in the layout, only visible on hover/focus — a chip
                // that grows an × when you approach it shifts the whole row.
                className="shrink-0 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/tag:opacity-70"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}

      {!disabled && (
        <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setDraft(""); }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Plus className="h-3 w-3" /> {t("doc.addTag")}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1.5">
            <input
              ref={inputRef}
              autoFocus
              value={draft}
              maxLength={MAX_TAG_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Comma is the other habitual separator; treat it as Enter so
                // pasting "work, bug" does the obvious thing.
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  commit(draft);
                } else if (event.key === "Escape") {
                  setOpen(false);
                } else if (event.key === "Backspace" && !draft && tags.length > 0) {
                  remove(tags[tags.length - 1]);
                }
              }}
              placeholder={t("doc.addTagPlaceholder")}
              className="h-7 w-full rounded-md border border-input bg-background px-2 text-[12px] outline-hidden focus:ring-1 focus:ring-primary/30"
            />
            {suggestions.length > 0 && (
              <div className="mt-1 max-h-48 overflow-y-auto">
                {suggestions.map((tag) => {
                  const hue = tagHue(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => commit(tag)}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] hover:bg-muted"
                    >
                      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: `hsl(${hue} 55% var(--tag-chip-l, 38%))` }} />
                      <span className="min-w-0 truncate">{tag}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

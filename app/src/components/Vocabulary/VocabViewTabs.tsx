import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";

export type VocabView = "words" | "sentences" | "review";

const VIEWS: { value: VocabView; labelKey: string }[] = [
  { value: "words", labelKey: "vocab.tabWords" },
  { value: "sentences", labelKey: "vocab.tabSentences" },
  { value: "review", labelKey: "vocab.tabReview" },
];

/** Words / Sentences / Review, rendered as the list's own heading rather than
 *  as a bar above it.
 *
 *  These used to sit in a full-width bordered strip of their own, directly
 *  above a heading that read "Words" — the same word the selected tab already
 *  said, one row apart. A whole row of page chrome to repeat the next row.
 *  Made the heading, they cost nothing: the live tab *is* the title, and the
 *  other one is the way out of it.
 */
export function VocabViewTabs({
  view, onSelect, reviewCount = 0,
}: {
  view: VocabView;
  onSelect: (view: VocabView) => void;
  /** FSRS cards waiting right now — a pill on the Review tab. */
  reviewCount?: number;
}) {
  const t = useT();

  return (
    <div className="flex min-w-0 items-center gap-3">
      {VIEWS.map(({ value, labelKey }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          onClick={() => onSelect(value)}
          aria-pressed={view === value}
          // Sized like the heading it replaces, so the row keeps its weight —
          // this is the page's title, not a control sitting next to one. The
          // rule under the live tab does the work the filled pill used to.
          className={`relative h-auto shrink-0 rounded-none px-0 py-0.5 text-base font-bold transition-colors after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:transition-colors hover:bg-transparent ${
            view === value
              ? "text-foreground after:bg-primary hover:text-foreground"
              : "text-muted-foreground after:bg-transparent hover:text-foreground"
          }`}
        >
          {t(labelKey)}
          {value === "review" && reviewCount > 0 && (
            <span className="ml-1.5 rounded-full bg-rose-500/15 px-1.5 py-px align-middle text-[10px] font-bold text-rose-500">
              {reviewCount}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}

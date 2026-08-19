import { ChevronsLeft, ChevronsRight } from "lucide-react";

/** A drawer pull-tab flush against a collapsible list panel's border — the
 *  same shape language Calendar's event sidebar uses: rounded only on the
 *  outward corner, attached to the edge it controls rather than floating
 *  free of it or living inside the panel's own header. Render this as a
 *  sibling of the panel inside a shared `relative flex` wrapper — it stays
 *  visible whether or not the panel itself is currently rendered, which is
 *  what lets a fully-collapsed (width-0) panel still be reopened.
 *
 *  `edge` is which side of the panel the handle sits on: "leading" for a
 *  panel anchored to the page's left edge (Docs, AI Chat — handle on the
 *  panel's right/outward side), "trailing" for one anchored to the right
 *  edge (Calendar's event sidebar — handle on the panel's left/outward
 *  side). */
export function ListPanelEdgeHandle({
  edge, collapsed, onClick, label, top = "top-16",
}: {
  edge: "leading" | "trailing";
  collapsed: boolean;
  onClick: () => void;
  label: string;
  /** Vertical offset from the panel's top — a Tailwind class, e.g. "top-16". */
  top?: string;
}) {
  const leading = edge === "leading";
  // Points toward whichever direction actually reveals more of the panel —
  // a pull invites you to drag it that way, the same as a drawer handle.
  const Icon = collapsed === leading ? ChevronsRight : ChevronsLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`absolute ${top} z-10 flex h-9 w-5 items-center justify-center border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground ${
        leading ? "-right-5 rounded-r-md border-l-0" : "-left-5 rounded-l-md border-r-0"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

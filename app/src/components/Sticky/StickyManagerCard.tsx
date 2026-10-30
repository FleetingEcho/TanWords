/** One pastel note tile on the manager's wall ("便签墙"). Pure presentation
 *  — StickyManagerApp owns every wire call and hands the actions down as
 *  callbacks. Click opens the note (focus/open); the hover "⋯" button or a
 *  right-click surfaces the context menu, which the app renders at window
 *  level (fixed coordinates) so the scroll area's overflow never clips it.
 *  Cards single-activate: there is deliberately no double-click handler. */
import { Ellipsis, Loader2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { stickyColorHex, stickyDerivedTitle, type StickyListItem } from "./stickyShared";

export interface StickyManagerCardMenuPoint {
  /** Window-level coordinates (clientX/Y) for the menu's top-left corner. */
  x: number;
  y: number;
}

export function StickyManagerCard({
  item,
  viewMode,
  busy,
  onOpen,
  onMenu,
}: {
  item: StickyListItem;
  viewMode: "card" | "list";
  /** True while this note's open/focus/trash round trip is in flight. */
  busy: boolean;
  onOpen: (item: StickyListItem) => void;
  onMenu: (item: StickyListItem, at: StickyManagerCardMenuPoint) => void;
}) {
  const t = useT();
  // The core derives a title server-side; derive again from the preview so a
  // note whose title save hasn't landed yet never flashes "Untitled".
  const title = item.title || stickyDerivedTitle(item.preview) || t("sticky.untitled");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(item, { x: e.clientX, y: e.clientY });
      }}
      className={`group relative flex min-w-0 cursor-pointer flex-col rounded-xl p-2.5 text-neutral-900 transition-shadow hover:shadow-md ${viewMode === "card" ? "min-h-[88px]" : "min-h-[62px]"}`}
      style={{
        backgroundColor: stickyColorHex(item.color),
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
      }}
    >
      <div className="flex items-start gap-1">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{title}</span>
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-60" />
        ) : (
          <button
            type="button"
            title={t("sticky.more")}
            className="-mt-0.5 -mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-80 group-focus-within:opacity-80 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-700 hover:bg-black/10"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onMenu(item, { x: rect.right, y: rect.bottom + 4 });
            }}
          >
            <Ellipsis className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className={`mt-0.5 flex-1 whitespace-pre-wrap text-[10px] leading-relaxed opacity-60 ${viewMode === "card" ? "line-clamp-3" : "line-clamp-1"}`}>
        {item.preview}
      </p>
      <div className="mt-1 flex items-center">
        <span className="text-[9px] tabular-nums opacity-50">
          {t("sticky.words", { n: item.word_count })}
        </span>
        {item.is_open ? (
          <span
            title={t("sticky.openedTab")}
            className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500"
          />
        ) : null}
      </div>
    </div>
  );
}

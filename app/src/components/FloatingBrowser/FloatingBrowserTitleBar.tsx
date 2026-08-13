import { Dock, Minus, Smartphone, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

interface FloatingBrowserTitleBarProps {
  dragging: boolean;
  /** Popout-window mode: the OS drags the whole window via `app-drag-region`
   *  instead of the docked widget's custom pointer-tracked drag — there's no
   *  native content underneath to steal events from in that mode, so the
   *  native-view-interception problem this custom drag exists for doesn't
   *  apply, and native window dragging is strictly more robust. */
  nativeDrag?: boolean;
  /** Omit to hide the minimize button — the popout window has no docked
   *  toolbar icon to minimize back into. */
  onMinimize?: () => void;
  /** Present only in popout mode: re-embeds the widget back into the main
   *  window. */
  onDock?: () => void;
  onRequestClose: () => void;
  onTitlePointerDown?: (e: React.PointerEvent) => void;
  onTitlePointerMove?: (e: React.PointerEvent) => void;
  onTitlePointerUp?: () => void;
}

/** Drag handle strip along the top of the phone bezel. Minimize just hides
 *  (tabs stay alive in the background); close asks for confirmation before
 *  it does — see FloatingBrowserWidget's destroyAll. */
export function FloatingBrowserTitleBar({
  dragging,
  nativeDrag = false,
  onMinimize,
  onDock,
  onRequestClose,
  onTitlePointerDown,
  onTitlePointerMove,
  onTitlePointerUp,
}: FloatingBrowserTitleBarProps) {
  const t = useT();
  return (
    <div
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-t-[2rem] bg-neutral-900 px-3 text-neutral-400 select-none ${
        nativeDrag ? "app-drag-region cursor-grab" : dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onPointerDown={onTitlePointerDown}
      onPointerMove={onTitlePointerMove}
      onPointerUp={onTitlePointerUp}
      onPointerCancel={onTitlePointerUp}
    >
      <Smartphone className="h-3 w-3 shrink-0 pointer-events-none" />
      <span className="flex-1 truncate text-[10px] font-medium pointer-events-none">
        {t("floatingBrowser.toggleLabel")}
      </span>
      {onDock && (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => { e.stopPropagation(); onDock(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={t("floatingBrowser.dock")}
          aria-label={t("floatingBrowser.dock")}
          className="app-region-no-drag h-5 w-5 shrink-0 rounded-full text-neutral-400 hover:bg-white/10 hover:text-white"
        >
          <Dock className="h-3 w-3" />
        </Button>
      )}
      {onMinimize && (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => { e.stopPropagation(); onMinimize(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={t("floatingBrowser.minimize")}
          aria-label={t("floatingBrowser.minimize")}
          className="app-region-no-drag h-5 w-5 shrink-0 rounded-full text-neutral-400 hover:bg-white/10 hover:text-white"
        >
          <Minus className="h-3 w-3" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => { e.stopPropagation(); onRequestClose(); }}
        onPointerDown={(e) => e.stopPropagation()}
        title={t("floatingBrowser.close")}
        aria-label={t("floatingBrowser.close")}
        className="app-region-no-drag h-5 w-5 shrink-0 rounded-full text-neutral-400 hover:bg-white/10 hover:text-white"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

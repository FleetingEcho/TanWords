/**
 * The block context menu, opened by clicking the drag handle.
 *
 * The handle is not drag-only: clicking it should offer actions on the block it
 * points at (turn into, duplicate, copy, delete). That affordance existed in
 * the previous editor and was missing from the port — the grip dragged and
 * nothing else, so clicking it appeared to do nothing.
 */
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  ChevronRight, Copy, CopyPlus, Eraser, Sparkles, Trash2,
} from "lucide-react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { usePendingChatSelectionStore } from "@/store/pendingChatSelectionStore";
import {
  TURN_INTO_OPTIONS, blockTextForAi, copyBlockText, deleteBlock,
  duplicateBlock, resetFormatting, turnInto, type BlockTarget,
} from "./blockActions";

function Row({ icon: Icon, label, onSelect, danger, trailing }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => { event.preventDefault(); onSelect(); }}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
        danger ? "text-destructive" : "text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

export function BlockMenu({
  editor,
  target,
  onClose,
}: {
  editor: Editor;
  target: BlockTarget;
  onClose: () => void;
}) {
  const t = useT();
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Dismissal.
   *
   * The menu lives inside the drag handle's own portal, so nothing above it
   * closes it — without this it stays open forever, which is what shipped.
   *
   * Clicks on the trigger are ignored here so the grip's own toggle decides;
   * otherwise the two fight and the menu reopens on every close.
   */
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const clicked = event.target as Element | null;
      if (rootRef.current?.contains(clicked ?? null)) return;
      if (clicked?.closest("[data-block-menu-trigger]")) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Capture phase: the editor stops propagation on some pointer events, and a
    // bubbling listener would never see them.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // Typing or moving the caret means the user has moved on.
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const run = (action: () => void) => { action(); onClose(); };

  const askAi = () => {
    const text = blockTextForAi(editor, target);
    if (!text) return;
    usePendingChatSelectionStore.getState().setText(text);
    if (useNavStore.getState().currentPage() === "chat") {
      window.dispatchEvent(new CustomEvent("tanwords:ask-selection", { detail: { text } }));
    } else {
      useNavStore.getState().navigate("chat");
    }
  };

  const copy = () => {
    const text = copyBlockText(editor, target);
    if (text === null) return;
    // Desktop WebViews do not all expose the async clipboard API; failing
    // silently here is better than throwing inside a menu handler.
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      className="w-56 rounded-lg border border-border bg-popover p-1 shadow-lg"
      // Keep the editor's selection while the menu is open.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="relative">
        <Row
          icon={ChevronRight}
          label={t("doc.turnInto")}
          onSelect={() => setTurnIntoOpen((open) => !open)}
          trailing={<ChevronRight className="h-3 w-3 text-muted-foreground" />}
        />
        {turnIntoOpen && (
          <div className="mt-0.5 rounded-md bg-muted/40 p-1">
            {TURN_INTO_OPTIONS.map((option) => (
              <Row
                key={option.id}
                icon={ChevronRight}
                label={t(option.labelKey)}
                onSelect={() => run(() => turnInto(editor, target, option.id))}
              />
            ))}
          </div>
        )}
      </div>

      <div className="my-1 h-px bg-border" />

      <Row icon={Eraser} label={t("doc.resetFormatting")}
        onSelect={() => run(() => resetFormatting(editor, target))} />
      <Row icon={CopyPlus} label={t("doc.duplicateBlock")}
        onSelect={() => run(() => duplicateBlock(editor, target))} />
      <Row icon={Copy} label={t("doc.copyBlock")} onSelect={() => run(copy)} />
      <Row icon={Sparkles} label={t("doc.askAiSelection")} onSelect={() => run(askAi)} />

      <div className="my-1 h-px bg-border" />

      <Row icon={Trash2} label={t("common.delete")} danger
        onSelect={() => run(() => deleteBlock(editor, target))} />
    </div>
  );
}

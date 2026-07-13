import React, { useEffect } from "react";
import { cn } from "@/lib/utils";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Panel width — px number or any CSS width. */
  width?: number | string;
  /** Extra classes on the panel (e.g. "flex flex-col"). */
  panelClassName?: string;
  children: React.ReactNode;
}

/** Right-side slide-over shell: dimmed backdrop, Esc / backdrop-click to close.
 *  The panel is a plain container — bring your own header/body/footer. */
export function Drawer({ open, onClose, width = 560, panelClassName, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div
        className={cn("relative h-full max-w-full bg-background shadow-2xl", panelClassName)}
        style={{ width }}
      >
        {children}
      </div>
    </div>
  );
}

export function DrawerCloseButton({ onClose, title }: { onClose: () => void; title?: string }) {
  return (
    <button
      onClick={onClose}
      title={title}
      className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-lg"
    >
      ×
    </button>
  );
}

import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { BrowserPanelBlocker } from "@/store/browserPanelStore";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}

export const DialogTitle = DialogPrimitive.Title;

export function Dialog({ open, onClose, children, className, maxWidth = "max-w-2xl" }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            // Center with inset + auto margins rather than percentage transforms:
            // WebKitGTK renders text on fractional transformed pixels blurry.
            "fixed inset-0 z-[101] m-auto h-fit max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            maxWidth,
            className,
          )}
        >
          {/* Native browser panel is composited above all our HTML, so it has
            * to hide itself rather than lose a z-index fight — see
            * browserPanelStore. Inside Content, not Portal: Radix wraps each
            * Portal child in Presence+Slot, which needs a ref-able element. */}
          <BrowserPanelBlocker />
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

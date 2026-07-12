import React from "react";
import { Dialog } from "./dialog";
import { useT } from "@/hooks/useT";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: (e: React.MouseEvent) => void;
  onCancel: () => void;
}

/** Small confirm/cancel dialog for destructive actions — built on the shared `Dialog` primitive. */
export function ConfirmModal({
  open, title, message, confirmLabel, cancelLabel, danger = true, confirmDisabled, onConfirm, onCancel,
}: ConfirmModalProps) {
  const t = useT();

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="max-w-sm">
      <div className="p-5 space-y-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
        <button
          onClick={onCancel}
          className="h-8 px-4 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          {cancelLabel || t("common.cancel")}
        </button>
        <button
          onClick={onConfirm}
          disabled={confirmDisabled}
          className={`h-8 px-4 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
            danger
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          {confirmLabel || t("common.delete")}
        </button>
      </div>
    </Dialog>
  );
}

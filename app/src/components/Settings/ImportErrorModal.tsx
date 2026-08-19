import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { useT } from "@/hooks/useT";

/** A single-button alert for a failed import/export — shows the backend's
 *  actual error text (e.g. "This is not a TanWords database file") instead
 *  of leaving the reason to a transient toast the user may have missed. */
export function ImportErrorModal({
  open,
  title,
  message,
  onClose,
  t,
}: {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3 p-5">
        <DialogTitle className="text-sm font-semibold text-destructive">{title}</DialogTitle>
        <p className="max-h-[40vh] overflow-y-auto text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
          {message}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          onClick={onClose}
          className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t("common.close")}
        </Button>
      </div>
    </Dialog>
  );
}

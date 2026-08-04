import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";

export interface FolderNameRequest {
  title: string;
  /** Shown under the title — usually where the folder will end up. */
  hint?: string;
  initialValue?: string;
  confirmLabel?: string;
  onSubmit: (name: string) => void;
}

/** Asks for a single folder name. A folder is created or renamed often enough
 *  that routing it through the OS dialog (or a full form) would be heavier than
 *  the action deserves; a slash in the name is rejected here so the caller can
 *  treat the result as one path segment. */
export function FolderNameDialog({ request, onClose }: {
  request: FolderNameRequest | null;
  onClose: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!request) return;
    setValue(request.initialValue ?? "");
    // The dialog mounts its content in the same tick; focus after it lands.
    const timer = window.setTimeout(() => inputRef.current?.select(), 0);
    return () => window.clearTimeout(timer);
  }, [request]);

  const name = value.trim();
  const invalid = name.length === 0 || name.includes("/") || name.includes("\\") || name === "." || name === "..";

  const submit = () => {
    if (invalid || !request) return;
    request.onSubmit(name);
    onClose();
  };

  return (
    <Dialog open={request !== null} onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3 p-5">
        <DialogTitle className="text-sm font-semibold">{request?.title}</DialogTitle>
        {request?.hint && <p className="text-xs leading-relaxed text-muted-foreground">{request.hint}</p>}
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape") onClose();
          }}
          placeholder={t("doc.folderNamePlaceholder")}
          className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm outline-hidden focus:border-primary/50"
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          onClick={onClose}
          className="h-8 rounded-lg px-4 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          {t("common.cancel")}
        </Button>
        <Button
          variant="ghost"
          onClick={submit}
          disabled={invalid}
          className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {request?.confirmLabel || t("common.confirm")}
        </Button>
      </div>
    </Dialog>
  );
}
